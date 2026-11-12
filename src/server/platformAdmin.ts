import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { validateSubscriptionInput } from './subscriptionService.js';
import { settleSubscriptionInvoiceWithDb } from './subscriptionBillingService.js';
import { getRestaurantOwnership, getRestaurantOwnerUid } from './restaurantOwnership.ts';

const PERMISSIONS = [
  'menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'orders.serve',
  'orders.cancel', 'orders.clear_pending', 'payments.refund', 'tables.view', 'tables.manage', 'pos.access',
  'kitchen.access', 'bar.access', 'cash.view', 'cash.manage', 'reports.view', 'reports.cash.view',
  'customers.view', 'customers.manage', 'inventory.view', 'inventory.manage',
  'staff.view', 'staff.manage', 'settings.view', 'settings.manage'
] as const;

type Permission = typeof PERMISSIONS[number];
type RestaurantRole = 'owner' | 'manager' | 'cashier' | 'server' | 'kitchen';

const ROLE_PERMISSION_CEILINGS: Record<RestaurantRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'orders.serve',
    'tables.view', 'tables.manage', 'pos.access', 'kitchen.access', 'bar.access', 'cash.view',
    'cash.manage', 'orders.cancel', 'payments.refund', 'reports.view', 'customers.view', 'customers.manage',
    'inventory.view', 'inventory.manage', 'staff.view', 'staff.manage', 'settings.view'
  ],
  cashier: [
    'orders.view', 'tables.view', 'pos.access', 'cash.view', 'cash.manage',
    'orders.cancel', 'payments.refund', 'reports.cash.view'
  ],
  server: ['orders.view', 'tables.view', 'pos.access', 'orders.serve', 'orders.cancel'],
  kitchen: ['orders.view', 'kitchen.access', 'bar.access', 'orders.clear_pending']
};

const ROLE_BASE_PERMISSIONS: Record<RestaurantRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: ROLE_PERMISSION_CEILINGS.manager,
  cashier: ['orders.view', 'tables.view', 'pos.access', 'cash.view', 'cash.manage', 'reports.cash.view'],
  server: ROLE_PERMISSION_CEILINGS.server,
  kitchen: ['orders.view', 'kitchen.access', 'orders.clear_pending']
};

function parseRestaurantRole(value: unknown): Exclude<RestaurantRole, 'owner'> | null {
  return ['manager', 'cashier', 'server', 'kitchen'].includes(String(value))
    ? value as Exclude<RestaurantRole, 'owner'>
    : null;
}

export function resolveRolePermissions(role: RestaurantRole, requested: unknown, allowExtras = true): Permission[] | null {
  const ceiling = ROLE_PERMISSION_CEILINGS[role];
  if (requested !== undefined && !Array.isArray(requested)) return null;
  const extras = Array.isArray(requested)
    ? [...new Set(requested.filter((p): p is Permission => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)))]
    : [];
  if (Array.isArray(requested) && extras.length !== new Set(requested).size) return null;
  if (extras.some(permission => !ceiling.includes(permission))) return null;
  if (!allowExtras && extras.some(permission => !ROLE_BASE_PERMISSIONS[role].includes(permission))) return null;
  return [...new Set([...ROLE_BASE_PERMISSIONS[role], ...extras])];
}

export function resolveManagerPermissionUpdate(
  currentRoleValue: unknown,
  nextRole: Exclude<RestaurantRole, 'owner'>,
  currentPermissions: unknown
): Permission[] | null {
  const currentRole = parseRestaurantRole(currentRoleValue);
  const previousBase = currentRole ? ROLE_BASE_PERMISSIONS[currentRole] : [];
  const previousCeiling = currentRole ? ROLE_PERMISSION_CEILINGS[currentRole] : [];
  const currentExtras = Array.isArray(currentPermissions)
    ? [...new Set(currentPermissions.filter((permission): permission is Permission =>
        typeof permission === 'string' &&
        (currentRole
          ? previousCeiling.includes(permission as Permission) && !previousBase.includes(permission as Permission)
          : (PERMISSIONS as readonly string[]).includes(permission) && !ROLE_BASE_PERMISSIONS[nextRole].includes(permission as Permission))))]
    : [];
  const nextCeiling = ROLE_PERMISSION_CEILINGS[nextRole];
  if (currentExtras.some(permission => !nextCeiling.includes(permission))) return null;
  return [...ROLE_BASE_PERMISSIONS[nextRole], ...currentExtras];
}

function json(res: any, status: number, body: unknown) {
  return res.status(status).json(body);
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function configuredSuperAdmins() {
  return (process.env.RESTAUMAX_SUPER_ADMIN_EMAILS || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
}

async function authenticate(req: any): Promise<DecodedIdToken | null> {
  const header = req.headers?.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    return await getAuth().verifyIdToken(token, true);
  } catch {
    return null;
  }
}

export function isSuperAdmin(user: DecodedIdToken) {
  // Trust only the server-issued Firebase custom claim or the verified bootstrap allowlist.
  const hasTrustedSuperAdminClaim = user.role === 'super_admin';
  const verifiedAllowlistedEmail = user.email_verified === true &&
    typeof user.email === 'string' &&
    configuredSuperAdmins().includes(user.email.toLowerCase());
  if (!hasTrustedSuperAdminClaim && !verifiedAllowlistedEmail) return false;
  if (process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA === 'true') {
    const secondFactor = (user as any).firebase?.sign_in_second_factor;
    return typeof secondFactor === 'string' && secondFactor.length > 0;
  }
  return true;
}


type PlatformAdminRole = 'full' | 'billing' | 'support' | 'read_only';
const PLATFORM_ADMIN_ROLES: readonly PlatformAdminRole[] = ['full', 'billing', 'support', 'read_only'];
const PLATFORM_ADMIN_ROLE_PERMISSIONS: Record<PlatformAdminRole, readonly string[]> = {
  full: ['platform.*'],
  billing: ['platform.overview', 'billing.read', 'billing.manage', 'audit.read'],
  support: ['platform.overview', 'support.read', 'support.manage', 'accounts.read', 'health.read', 'audit.read'],
  read_only: ['platform.overview', 'support.read', 'health.read', 'audit.read']
};

function platformAdminMfaSatisfied(user: DecodedIdToken): boolean {
  if (process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA !== 'true') return true;
  const secondFactor = (user as any).firebase?.sign_in_second_factor;
  return typeof secondFactor === 'string' && secondFactor.length > 0;
}

export async function getPlatformAdminRole(db: any, user: DecodedIdToken): Promise<PlatformAdminRole | null> {
  if (isSuperAdmin(user)) return 'full';
  if (user.role !== 'platform_admin' || !platformAdminMfaSatisfied(user)) return null;
  const role = String((user as any).platformAdminRole || '');
  if (!PLATFORM_ADMIN_ROLES.includes(role as PlatformAdminRole) || role === 'full') return null;
  const snap = await db.collection('platform_admins').doc(user.uid).get();
  if (!snap.exists) return null;
  const record = snap.data() || {};
  const tokenVersion = Number((user as any).platformAdminSessionVersion || 0);
  if (record.active !== true || record.role !== role ||
      !Number.isSafeInteger(tokenVersion) || tokenVersion < 1 ||
      tokenVersion !== Number(record.sessionVersion || 0)) return null;
  return role as PlatformAdminRole;
}

export function canPlatformAdminPerform(role: PlatformAdminRole, action: string): boolean {
  if (role === 'full') return true;
  if (['overview', 'audit_list'].includes(action)) return true;
  if (role === 'billing') return ['billing_list', 'update_subscription', 'settle_subscription_invoice'].includes(action);
  if (role === 'support') return ['support_list', 'support_create', 'support_update', 'staff_list', 'health_details', 'announcement_list'].includes(action);
  if (role === 'read_only') return ['support_list', 'health_details', 'announcement_list'].includes(action);
  return false;
}

export function canManageStaffMember(actorRole: 'owner' | 'manager', targetRole: string): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return ['manager', 'cashier', 'server', 'kitchen', 'staff'].includes(targetRole);
  return ['cashier', 'server', 'kitchen', 'staff'].includes(targetRole);
}

async function requireOwner(db: any, user: DecodedIdToken, slug: string) {
  // A platform administrator can never inherit restaurant operations from a
  // stale owner membership or a shared email identity.
  if (user.role === 'super_admin' || user.role === 'admin') return null;
  const snap = await db.collection('restaurants').doc(slug).get();
  if (!snap.exists) return null;
  const restaurant = snap.data();
  if (restaurant.status !== 'active' || restaurant.deletedAt) return null;
  const membership = await db.collection('managers').doc(user.uid).get();
  const member = membership.exists ? membership.data() : null;
  const ownerUid = await getRestaurantOwnerUid(db, slug, undefined, restaurant);
  if (ownerUid !== user.uid || member?.role !== 'owner' || member?.restaurantSlug !== slug || member?.active !== true) return null;
  if (Number(user.sessionVersion || 0) !== Number(member?.sessionVersion || 0)) return null;
  return { role: 'owner', restaurant };
}

async function requireStaffAdministrator(db: any, user: DecodedIdToken, slug: string) {
  // Keep the platform and restaurant authorization domains mutually exclusive.
  if (user.role === 'super_admin' || user.role === 'admin') return null;
  const [restaurantSnap, membershipSnap] = await Promise.all([
    db.collection('restaurants').doc(slug).get(),
    db.collection('managers').doc(user.uid).get()
  ]);
  if (!restaurantSnap.exists || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt) return null;
  if (!membershipSnap.exists) return null;
  const member = membershipSnap.data();
  const restaurant = restaurantSnap.data();
  const ownerUid = await getRestaurantOwnerUid(db, slug, undefined, restaurant);
  if (member?.active !== true || member?.restaurantSlug !== slug ||
      Number(user.sessionVersion || 0) !== Number(member?.sessionVersion || 0)) return null;
  if (member.role === 'owner' && ownerUid === user.uid) {
    return { role: 'owner' as const, restaurant: restaurantSnap.data() };
  }
  if (member.role === 'manager' && Array.isArray(member.permissions) &&
      member.permissions.includes('staff.manage')) {
    return { role: 'manager' as const, restaurant: restaurantSnap.data() };
  }
  return null;
}


export async function handlePlatformAdmin(req: any, res: any, db: any) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST');
    return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
  }
  if (!db) return json(res, 503, { success: false, error: 'Service administratif indisponible.' });

  const user = await authenticate(req);
  if (!user) return json(res, 401, { success: false, error: 'Authentification requise.' });

  // One Firebase identity cannot simultaneously be a restaurant member
  // and a platform administrator. This check applies even to an already
  // promoted super-admin, so a stale/legacy tenant membership cannot coexist.
  const membershipRef = db.collection('managers').doc(user.uid);
  const membershipSnap = await membershipRef.get();
  const existingMembership = membershipSnap.exists ? (membershipSnap.data() || {}) : null;
  if (
    existingMembership?.active === true &&
    ['owner', 'manager', 'cashier', 'server', 'kitchen', 'staff'].includes(String(existingMembership.role || '')) &&
    typeof existingMembership.restaurantSlug === 'string' &&
    existingMembership.restaurantSlug.trim()
  ) {
    return json(res, 403, {
      success: false,
      error: 'Ce compte est déjà rattaché à un restaurant. Un compte super-administrateur distinct est requis.'
    });
  }

  // Promote only explicitly allowlisted identities that are not restaurant
  // members to a durable global custom claim.
  if (
    user.email_verified === true &&
    typeof user.email === 'string' &&
    configuredSuperAdmins().includes(user.email.toLowerCase()) &&
    user.role !== 'super_admin'
  ) {
    const auth = getAuth();
    const authUser = await auth.getUser(user.uid);
    let nextSessionVersion = Number(user.sessionVersion || 0);

    // Inactive legacy memberships still have every previously issued token
    // invalidated before the platform role is granted.
    if (membershipSnap.exists) {
      const member = existingMembership || {};
      const memberVersion = Number(member.sessionVersion || 0);
      const tokenVersion = Number(user.sessionVersion || 0);
      nextSessionVersion = Math.max(
        Number.isSafeInteger(memberVersion) && memberVersion >= 0 ? memberVersion : 0,
        Number.isSafeInteger(tokenVersion) && tokenVersion >= 0 ? tokenVersion : 0
      ) + 1;
      await membershipRef.update({
        sessionVersion: nextSessionVersion,
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    await auth.setCustomUserClaims(user.uid, {
      ...(authUser.customClaims || {}),
      role: 'super_admin',
      sessionVersion: nextSessionVersion
    });
  }

  const body = req.body || {};
  const action = req.method === 'GET' ? String(req.query?.action || 'overview') : String(body.action || '');

  try {
    // Global platform administration: allowlisted super-admin or trusted custom claim only.
    if (['overview', 'billing_list', 'audit_list', 'create_restaurant', 'set_restaurant_status', 'update_subscription', 'settle_subscription_invoice', 'delete_restaurant', 'platform_admin_list', 'platform_admin_create', 'platform_admin_update', 'platform_admin_status', 'support_list', 'support_create', 'support_update', 'config_read', 'config_update', 'announcement_list', 'announcement_save', 'announcement_publish', 'announcement_cancel', 'health_details'].includes(action)) {
      const platformRole = await getPlatformAdminRole(db, user);
      if (!platformRole || !canPlatformAdminPerform(platformRole, action)) return json(res, 403, { success: false, error: 'Cette action est réservée à un rôle super-administrateur autorisé.' });

      if (action === 'billing_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const subscriptionsSnap = await db.collection('restaurantSubscriptions').get();
        const invoices: any[] = [];
        for (const subscriptionDoc of subscriptionsSnap.docs) {
          if (invoices.length >= 100) break;
          const invoiceSnap = await subscriptionDoc.ref.collection('invoices').orderBy('issuedAt', 'desc').limit(30).get();
          for (const invoiceDoc of invoiceSnap.docs) {
            const invoice = invoiceDoc.data() || {};
            invoices.push({
              id: invoiceDoc.id,
              restaurantSlug: subscriptionDoc.id,
              planName: typeof invoice.planName === 'string' ? invoice.planName : '',
              amountFcfa: Number.isSafeInteger(invoice.amountFcfa) ? invoice.amountFcfa : 0,
              currency: 'FCFA',
              status: ['open', 'paid', 'void', 'overdue'].includes(String(invoice.status)) ? invoice.status : 'unknown',
              issuedAt: Number.isFinite(invoice.issuedAt) ? invoice.issuedAt : null,
              dueAt: Number.isFinite(invoice.dueAt) ? invoice.dueAt : null,
              paidAt: Number.isFinite(invoice.paidAt) ? invoice.paidAt : null,
              paymentReference: typeof invoice.paymentReference === 'string' ? invoice.paymentReference.slice(0, 80) : null
            });
            if (invoices.length >= 100) break;
          }
        }
        invoices.sort((a, b) => Number(b.issuedAt || 0) - Number(a.issuedAt || 0));
        return json(res, 200, { success: true, invoices, truncated: invoices.length >= 100 });
      }

      if (action === 'audit_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const auditSnap = await db.collection('admin_audit_logs').orderBy('createdAt', 'desc').limit(100).get();
        const logs = auditSnap.docs.map((doc: any) => {
          const raw = doc.data() || {};
          return {
            id: doc.id,
            action: typeof raw.action === 'string' ? raw.action : 'unknown',
            actorUid: typeof raw.actorUid === 'string' ? raw.actorUid : '',
            restaurantSlug: typeof raw.restaurantSlug === 'string' ? raw.restaurantSlug : '',
            targetRole: typeof raw.targetRole === 'string' ? raw.targetRole : '',
            invoiceId: typeof raw.invoiceId === 'string' ? raw.invoiceId : '',
            amountFcfa: Number.isSafeInteger(raw.amountFcfa) ? raw.amountFcfa : null,
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : null,
            preservedBusinessData: raw.preservedBusinessData === true || raw.businessHistoryPreserved === true
          };
        });
        return json(res, 200, { success: true, logs, readOnly: true });
      }

      if (action === 'overview') {
        const snap = await db.collection('restaurants').get();
        const restaurants = await Promise.all(snap.docs.map(async (d: any) => {
          const data = d.data() || {};
          // Dashboard reads are strictly read-only. Legacy metadata migration must
          // run as an explicit, backed-up maintenance operation, never on GET.
          const subscriptionSnap = await db.collection('restaurantSubscriptions').doc(d.id).get();
          const raw = subscriptionSnap.exists
            ? (subscriptionSnap.data() || {})
            : (data.subscription && typeof data.subscription === 'object' ? data.subscription : {});
          const subscription = {
            planName: typeof raw.planName === 'string' ? raw.planName : null,
            status: typeof raw.status === 'string' ? raw.status : 'unknown',
            billingCycle: typeof raw.billingCycle === 'string' ? raw.billingCycle : null,
            priceFcfa: Number.isSafeInteger(raw.priceFcfa) ? raw.priceFcfa : null,
            startsAt: Number.isFinite(raw.startsAt) ? raw.startsAt : null,
            endsAt: Number.isFinite(raw.endsAt) ? raw.endsAt : null,
            nextBillingAt: Number.isFinite(raw.nextBillingAt) ? raw.nextBillingAt : null,
            gracePeriodDays: Number.isSafeInteger(raw.gracePeriodDays) ? raw.gracePeriodDays : 7,
            autoRenew: raw.autoRenew !== false,
            currentInvoiceId: typeof raw.currentInvoiceId === 'string' ? raw.currentInvoiceId : null,
            currentInvoiceAmountFcfa: Number.isSafeInteger(raw.currentInvoiceAmountFcfa) ? raw.currentInvoiceAmountFcfa : null,
            pastDueAt: Number.isFinite(raw.pastDueAt) ? raw.pastDueAt : null
          };
          return {
            slug: d.id,
            name: typeof data.name === 'string' ? data.name : '',
            status: typeof data.status === 'string' ? data.status : 'unknown',
            isOpen: data.isOpen === true,
            createdAt: Number.isFinite(data.createdAt) ? data.createdAt : null,
            city: typeof data.city === 'string' ? data.city : '',
            country: typeof data.country === 'string' ? data.country : '',
            currency: typeof data.currency === 'string' ? data.currency : 'FCFA',
            subscription
          };
        }));
        const aggregationTime = Date.now();
        const monthlyRecurringRevenueFcfa = restaurants.reduce((sum: number, r: any) => {
          if (r.status !== 'active' || r.subscription.status !== 'active' ||
              (Number.isFinite(r.subscription.startsAt) && r.subscription.startsAt > aggregationTime) ||
              (Number.isFinite(r.subscription.endsAt) && r.subscription.endsAt < aggregationTime)) return sum;
          const amount = Number(r.subscription.priceFcfa || 0);
          if (r.subscription.billingCycle === 'monthly') return sum + amount;
          if (r.subscription.billingCycle === 'yearly') return sum + Math.round(amount / 12);
          return sum;
        }, 0);
        const summary = {
          totalRestaurants: restaurants.length,
          activeRestaurants: restaurants.filter((r: any) => r.status === 'active').length,
          suspendedRestaurants: restaurants.filter((r: any) => r.status === 'suspended').length,
          deletedRestaurants: restaurants.filter((r: any) => r.status === 'deleted').length,
          openRestaurants: restaurants.filter((r: any) => r.isOpen && r.status === 'active').length,
          subscriptionsByStatus: restaurants.reduce((acc: Record<string, number>, r: any) => {
            const key = r.subscription.status || 'unknown'; acc[key] = (acc[key] || 0) + 1; return acc;
          }, {}),
          subscriptionsByPlan: restaurants.reduce((acc: Record<string, number>, r: any) => {
            const key = r.subscription.planName || 'unassigned'; acc[key] = (acc[key] || 0) + 1; return acc;
          }, {}),
          monthlyRecurringRevenueFcfa,
          recurringRevenueFcfa: monthlyRecurringRevenueFcfa
        };
        return json(res, 200, { success: true, restaurants, total: restaurants.length, summary });
      }

      if (action === 'create_restaurant') {
        const name = String(body.name || '').trim();
        const slug = slugify(String(body.slug || name));
        const ownerName = String(body.ownerName || '').trim();
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        if (!name || name.length > 200 || !slug || !ownerName || !validEmail(ownerEmail)) {
          return json(res, 400, { success: false, error: 'Renseignez le restaurant, le propriétaire et une adresse e-mail valide.' });
        }
        const auth = getAuth();
        let existingOwner: any = null;
        try {
          existingOwner = await auth.getUserByEmail(ownerEmail);
        } catch (lookupError: any) {
          if (lookupError?.code !== 'auth/user-not-found') throw lookupError;
        }

        // Existing Firebase identities may be attached by a platform admin,
        // but never reassigned from another tenant or converted from platform admin.
        if (existingOwner) {
          const claims = existingOwner.customClaims || {};
          if (existingOwner.disabled) {
            return json(res, 409, { success: false, error: 'Le compte propriétaire existant est désactivé. Réactivez-le dans Firebase Authentication avant de continuer.' });
          }
          if (claims.role === 'super_admin' || claims.role === 'admin') {
            return json(res, 409, { success: false, error: 'Un compte administrateur plateforme ne peut pas devenir propriétaire d’un restaurant.' });
          }
          const [membershipSnap, staffSnap, ownershipSnap, legacyOwnershipSnap] = await Promise.all([
            db.collection('managers').doc(existingOwner.uid).get(),
            db.collectionGroup('staff').where('uid', '==', existingOwner.uid).limit(1).get(),
            db.collectionGroup('private').where('ownerUid', '==', existingOwner.uid).limit(1).get(),
            db.collection('restaurants').where('ownerUid', '==', existingOwner.uid).limit(1).get()
          ]);
          if (membershipSnap.exists || !staffSnap.empty || !ownershipSnap.empty || !legacyOwnershipSnap.empty ||
              (typeof claims.restaurantSlug === 'string' && claims.restaurantSlug.trim())) {
            return json(res, 409, { success: false, error: 'Ce compte Firebase est déjà rattaché à un restaurant ou possède une ancienne affectation. Vérification manuelle requise.' });
          }
        }

        const restaurantRef = db.collection('restaurants').doc(slug);
        let reservationCreated = false;
        try {
          await restaurantRef.create({ slug, name, status: 'provisioning', createdAt: Date.now() });
          reservationCreated = true;
        } catch (reservationError: any) {
          if (reservationError?.code === 6 || reservationError?.code === 'already-exists') {
            return json(res, 409, { success: false, error: 'Ce slug de restaurant existe déjà.' });
          }
          throw reservationError;
        }

        let ownerUser: any = existingOwner;
        let ownerCreated = false;
        let previousCustomClaims: Record<string, any> | null = null;
        let ownerClaimsChanged = false;
        try {
          if (!ownerUser) {
            ownerUser = await auth.createUser({
              email: ownerEmail, displayName: ownerName, disabled: false
            });
            ownerCreated = true;
          }
          previousCustomClaims = { ...(ownerUser.customClaims || {}) };
          await auth.setCustomUserClaims(ownerUser.uid, {
            ...previousCustomClaims, role: 'owner', restaurantSlug: slug
          });
          ownerClaimsChanged = true;

          const now = Date.now();
          const batch = db.batch();
          batch.set(restaurantRef, {
            slug, name, isOpen: false,
            status: 'active', createdAt: now,
            tagline: '', address: '', city: '', phone: '', bannerUrl: '', logoUrl: '',
            openingHours: '', currency: 'FCFA', country: "Côte d'Ivoire"
          });
          batch.set(restaurantRef.collection('private').doc('ownership'), {
            ownerUid: ownerUser.uid, ownerName, ownerEmail, createdBy: user.uid, createdAt: now
          });
          batch.set(db.collection('managers').doc(ownerUser.uid), {
            uid: ownerUser.uid, email: ownerEmail, displayName: ownerName,
            role: 'owner', restaurantSlug: slug, permissions: PERMISSIONS,
            active: true, createdAt: now, createdBy: user.uid
          });
          batch.set(restaurantRef.collection('staff').doc(ownerUser.uid), {
            uid: ownerUser.uid, email: ownerEmail, displayName: ownerName,
            role: 'owner', permissions: PERMISSIONS, active: true, createdAt: now
          });
          const auditRef = db.collection('admin_audit_logs').doc();
          batch.set(auditRef, {
            action: 'create_restaurant',
            restaurantSlug: slug,
            ownerUid: ownerUser.uid,
            ownerEmail,
            ownerAccountReused: !ownerCreated,
            actorUid: user.uid,
            createdAt: now
          });
          await batch.commit();
          return json(res, 201, {
            success: true,
            restaurant: { slug, name },
            owner: { uid: ownerUser.uid, email: ownerEmail, existingAccount: !ownerCreated }
          });
        } catch (error: any) {
          if (ownerUser?.uid && ownerClaimsChanged && previousCustomClaims) {
            await auth.setCustomUserClaims(ownerUser.uid, previousCustomClaims).catch(() => undefined);
          }
          if (ownerCreated && ownerUser?.uid) await auth.deleteUser(ownerUser.uid).catch(() => undefined);
          if (reservationCreated) await restaurantRef.delete().catch(() => undefined);
          throw error;
        }
      }

      if (action === 'set_restaurant_status') {
        const slug = String(body.slug || '').trim();
        if (!slug || !['active', 'suspended'].includes(body.status)) return json(res, 400, { success: false, error: 'Paramètres de statut invalides.' });
        const restaurantRef = db.collection('restaurants').doc(slug);
        const restaurantSnap = await restaurantRef.get();
        if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'deleted' || restaurantSnap.data()?.deletedAt) {
          return json(res, 404, { success: false, error: 'Restaurant introuvable ou déjà supprimé.' });
        }
        const now = Date.now();
        await restaurantRef.set({
          status: body.status,
          ...(body.status === 'suspended' ? {
            isOpen: false,
            isOpenBeforeSuspension: restaurantSnap.data()?.status === 'suspended'
              ? restaurantSnap.data()?.isOpenBeforeSuspension === true
              : restaurantSnap.data()?.isOpen === true,
            suspendedAt: now,
            // Session epoch invalidates every previously issued table session,
            // including sessions missed by a partial cleanup batch.
            tableSessionVersion: Number(restaurantSnap.data()?.tableSessionVersion || 0) + 1
          } : {
            // Restore the operational open/closed state that existed before suspension.
            isOpen: restaurantSnap.data()?.status === 'suspended'
              ? restaurantSnap.data()?.isOpenBeforeSuspension === true
              : restaurantSnap.data()?.isOpen === true,
            isOpenBeforeSuspension: null,
            suspendedAt: null,
            // Suspension actor identity is stored in the private audit log.
          }),
          updatedAt: now
        }, { merge: true });
        if (body.status === 'suspended') {
          const sessions = await restaurantRef.collection('table_sessions').where('status', '==', 'active').get();
          for (let offset = 0; offset < sessions.docs.length; offset += 400) {
            const batch = db.batch();
            sessions.docs.slice(offset, offset + 400).forEach((doc: any) => batch.update(doc.ref, { status: 'revoked', revokedAt: now, revokedReason: 'restaurant_suspended' }));
            await batch.commit();
          }
        }
        await db.collection('admin_audit_logs').add({ action: body.status === 'suspended' ? 'suspend_restaurant' : 'reactivate_restaurant', restaurantSlug: slug, actorUid: user.uid, createdAt: now });
        return json(res, 200, { success: true, status: body.status });
      }

      if (action === 'update_subscription') {
        const slug = String(body.slug || '').trim();
        const validation = validateSubscriptionInput(body.subscription);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) {
          return json(res, 400, { success: false, error: 'Identifiant de restaurant invalide.' });
        }
        if (!validation.success) return json(res, 400, { success: false, error: validation.error });
        const restaurantRef = db.collection('restaurants').doc(slug);
        const restaurantSnap = await restaurantRef.get();
        if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'deleted' || restaurantSnap.data()?.deletedAt) {
          return json(res, 404, { success: false, error: 'Restaurant introuvable ou supprimé.' });
        }
        const now = Date.now();
        const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
        const currentSubscriptionSnap = await subscriptionRef.get();
        const requestedNotes = typeof body.subscription?.notes === 'string'
          ? body.subscription.notes.trim().slice(0, 500) : '';
        const preservedNotes = requestedNotes || String(currentSubscriptionSnap.data()?.notes || '');
        const updatedSubscription = {
          ...validation.subscription, notes: preservedNotes, updatedAt: now, updatedBy: user.uid
        };
        await subscriptionRef.set(updatedSubscription, { merge: true });
        if (restaurantSnap.data()?.subscription !== undefined) {
          await restaurantRef.update({ subscription: FieldValue.delete() });
        }
        await db.collection('admin_audit_logs').add({
          action: 'update_restaurant_subscription', restaurantSlug: slug, actorUid: user.uid,
          planName: validation.subscription.planName,
          priceFcfa: validation.subscription.priceFcfa,
          billingCycle: validation.subscription.billingCycle,
          subscriptionStatus: validation.subscription.status,
          endsAt: validation.subscription.endsAt,
          createdAt: now
        });
        return json(res, 200, { success: true, subscription: updatedSubscription });
      }

      if (action === 'settle_subscription_invoice') {
        const slug = String(body.slug || '').trim();
        const result = await settleSubscriptionInvoiceWithDb(db, {
          restaurantSlug: slug,
          invoiceId: String(body.invoiceId || ''),
          amountFcfa: Number(body.amountFcfa),
          paymentReference: String(body.paymentReference || ''),
          actorUid: user.uid
        });
        return json(res, result.success ? 200 : result.conflict ? 409 : 400, result);
      }

      if (action === 'delete_restaurant') {
        const slug = String(body.slug || '').trim();
        const confirmation = String(body.confirmation || '');
        if (!slug || confirmation !== slug) return json(res, 400, { success: false, error: 'Confirmation du nom technique du restaurant requise.' });
        const restaurantRef = db.collection('restaurants').doc(slug);
        const restaurantSnap = await restaurantRef.get();
        if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
        const now = Date.now();
        // Tombstone first: all authorization paths must fail before cleanup begins.
        await restaurantRef.set({ status: 'deleted', isOpen: false, tableSessionVersion: Number(restaurantSnap.data()?.tableSessionVersion || 0) + 1, deletedAt: restaurantSnap.data()?.deletedAt || now, updatedAt: now }, { merge: true });

        const [staffSnap, sessionsSnap, qrSnap, tablesSnap] = await Promise.all([
          restaurantRef.collection('staff').get(),
          restaurantRef.collection('table_sessions').get(),
          restaurantRef.collection('table_qr_tokens').get(),
          restaurantRef.collection('tables').get()
        ]);
        const auth = getAuth();
        const cleanupErrors: string[] = [];
        for (const memberDoc of staffSnap.docs) {
          const uid = memberDoc.id;
          try {
            await auth.updateUser(uid, { disabled: true });
            await auth.revokeRefreshTokens(uid);
          } catch (error: any) {
            if (error?.code !== 'auth/user-not-found') cleanupErrors.push(uid);
          }
        }
        const docsToUpdate = [
          ...staffSnap.docs.map((doc: any) => ({ ref: doc.ref, data: { active: false, restaurantDeletedAt: now, updatedAt: now } })),
          ...staffSnap.docs.map((doc: any) => ({ ref: db.collection('managers').doc(doc.id), data: { active: false, restaurantDeletedAt: now, updatedAt: now } })),
          ...sessionsSnap.docs.map((doc: any) => ({ ref: doc.ref, data: { status: 'revoked', revokedAt: now, revokedReason: 'restaurant_deleted' } })),
          ...qrSnap.docs.map((doc: any) => ({ ref: doc.ref, data: { status: 'revoked', revokedAt: now, updatedAt: now } })),
          ...tablesSnap.docs.map((doc: any) => ({ ref: doc.ref, data: { isActive: false, qrVersion: Number(doc.data()?.qrVersion || 0) + 1, qrRevokedAt: now } }))
        ];
        for (let offset = 0; offset < docsToUpdate.length; offset += 400) {
          const batch = db.batch();
          docsToUpdate.slice(offset, offset + 400).forEach((item: any) => batch.set(item.ref, item.data, { merge: true }));
          await batch.commit();
        }
        await db.collection('admin_audit_logs').add({ action: 'delete_restaurant_logical', restaurantSlug: slug, actorUid: user.uid, createdAt: now, preservedBusinessData: true });
        if (cleanupErrors.length) return json(res, 503, { success: false, error: 'Restaurant neutralisé et données conservées, mais certains comptes nécessitent une vérification administrative.', pendingAccountUids: cleanupErrors });
        return json(res, 200, { success: true, status: 'deleted', preservedBusinessData: true });
      }
    }

    // Super-admin account audit is deliberately read-only and limited to identity/linkage fields.
    if (action === 'staff_list' && ['full', 'support'].includes(String(await getPlatformAdminRole(db, user) || ''))) {
      const slug = String(req.method === 'GET' ? req.query?.slug || '' : body.slug || '').trim();
      if (!slug) return json(res, 400, { success: false, error: 'Restaurant manquant.' });
      const restaurantSnap = await db.collection('restaurants').doc(slug).get();
      if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
      const restaurant = restaurantSnap.data() || {};
      const [staffSnap, managersSnap] = await Promise.all([
        db.collection('restaurants').doc(slug).collection('staff').get(),
        db.collection('managers').where('restaurantSlug', '==', slug).get()
      ]);
      const byUid = new Map<string, any>();
      const addAccount = (raw: any, source: string) => {
        const uid = String(raw?.uid || raw?.id || '').trim();
        if (!uid) return;
        const previous = byUid.get(uid) || {
          uid, email: '', displayName: '', role: raw?.role || 'staff',
          active: raw?.active === true, activeKnown: typeof raw?.active === 'boolean', accountLinked: true, emailConflict: false,
          sources: [], emailValues: []
        };
        const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
        if (email && !previous.emailValues.includes(email)) previous.emailValues.push(email);
        previous.emailConflict = previous.emailValues.length > 1;
        previous.email = email || previous.email;
        previous.displayName = String(raw?.displayName || raw?.ownerName || previous.displayName || '');
        previous.role = raw?.role === 'owner' || previous.role === 'owner' ? 'owner' : (raw?.role || previous.role);
        if (typeof raw?.active === 'boolean') { previous.active = raw.active; previous.activeKnown = true; }
        if (!previous.sources.includes(source)) previous.sources.push(source);
        byUid.set(uid, previous);
      };
      staffSnap.docs.forEach((doc: any) => addAccount({ ...doc.data(), uid: doc.id }, 'restaurant.staff'));
      managersSnap.docs.forEach((doc: any) => addAccount({ ...doc.data(), uid: doc.id }, 'managers'));
      const ownership = await getRestaurantOwnership(db, slug, undefined, restaurant);
      const ownerUid = String(ownership.ownerUid || '').trim();
      const ownerEmail = typeof ownership.ownerEmail === 'string' ? ownership.ownerEmail.trim().toLowerCase() : '';
      const ownerName = String(ownership.ownerName || '').trim();
      if (ownerUid) {
        addAccount({ uid: ownerUid, email: ownerEmail, displayName: ownerName, role: 'owner' }, 'restaurants.owner');
      } else if (ownerEmail || ownerName) {
        byUid.set('unlinked-owner', {
          uid: 'unlinked-owner', email: ownerEmail, displayName: ownerName,
          role: 'owner', active: false, activeKnown: false, accountLinked: false, emailConflict: false,
          sources: ['restaurants.owner'], emailValues: ownerEmail ? [ownerEmail] : []
        });
      }
      const accounts = [...byUid.values()].map(({ emailValues, ...account }) => ({
        ...account, readOnly: true
      }));
      return json(res, 200, {
        success: true, actorRole: 'super_admin', restaurant: {
          slug, name: String(restaurant.name || ''), status: String(restaurant.status || 'unknown'),
          ownerUid: ownerUid || null, ownerEmail: ownerEmail || null, ownerName: ownerName || null
        }, staff: accounts
      });
    }

    // Owner and authorized manager staff administration, strictly scoped to one active restaurant.
    if (action === 'staff_list' || action === 'create_staff' || action === 'assign_server_tables' || action === 'update_staff' || action === 'disable_staff' || action === 'set_staff_status' || action === 'delete_staff') {
      const slug = String(req.method === 'GET' ? req.query?.slug || '' : body.slug || '');
      if (!slug) return json(res, 400, { success: false, error: 'Restaurant manquant.' });
      const actor = await requireStaffAdministrator(db, user, slug);
      if (!actor) return json(res, 403, { success: false, error: 'Gestion du personnel non autorisée pour ce restaurant.' });

      const staffRef = db.collection('restaurants').doc(slug).collection('staff');
      const releaseServerTables = async (uid: string) => {
        const restaurantRef = db.collection('restaurants').doc(slug);
        const assigned = await restaurantRef.collection('tables').where('assignedWaiter', '==', uid).get();
        for (let offset = 0; offset < assigned.docs.length; offset += 400) {
          const batch = db.batch();
          assigned.docs.slice(offset, offset + 400).forEach((doc: any) => batch.set(doc.ref, {
            assignedWaiter: null, assignedWaiterName: null, assignmentUpdatedAt: Date.now(), assignmentUpdatedBy: user.uid
          }, { merge: true }));
          await batch.commit();
        }
        for (const tableDoc of assigned.docs) {
          const tableNumber = String(tableDoc.data()?.tableNumber || '').trim();
          if (!tableNumber) continue;
          const orders = await restaurantRef.collection('orders').where('tableNumber', '==', tableNumber).get();
          const activeOrders = orders.docs.filter((doc: any) =>
            ['pending', 'in_prep', 'ready'].includes(String(doc.data()?.status || ''))
          );
          for (let offset = 0; offset < activeOrders.length; offset += 400) {
            const batch = db.batch();
            activeOrders.slice(offset, offset + 400).forEach((doc: any) => batch.update(doc.ref, {
              assignedWaiterUid: null,
              waiterAssignmentUpdatedAt: Date.now(),
              waiterAssignmentUpdatedBy: user.uid
            }));
            await batch.commit();
          }
        }
      };
      if (action === 'staff_list') {
        const actorMembership = actor.role === 'manager'
          ? await db.collection('managers').doc(user.uid).get()
          : null;
        const actorPermissions = Array.isArray(actorMembership?.data()?.permissions)
          ? actorMembership.data().permissions
          : [];
        const canViewTables = actor.role === 'owner' || actorPermissions.includes('tables.view') || actorPermissions.includes('tables.manage');
        const canAssignTables = actor.role === 'owner' || actorPermissions.includes('tables.manage');
        const [snap, tablesSnap] = await Promise.all([
          staffRef.get(),
          canViewTables
            ? db.collection('restaurants').doc(slug).collection('tables').get()
            : Promise.resolve({ docs: [] })
        ]);
        return json(res, 200, {
          success: true, actorRole: actor.role, canAssignTables,
          staff: snap.docs.map((d: any) => d.data()),
          tables: tablesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        });
      }

      if (action === 'create_staff') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const role = parseRestaurantRole(body.role);
        if (!role) return json(res, 400, { success: false, error: 'Rôle invalide. Choisissez manager, cashier, server ou kitchen.' });
        if (actor.role === 'manager' && role === 'manager') return json(res, 403, { success: false, error: 'Un manager ne peut pas créer un autre manager.' });
        const permissions = resolveRolePermissions(role, body.permissions, actor.role === 'owner');
        if (!name || !validEmail(email) || !permissions) {
          return json(res, 400, { success: false, error: 'Nom, e-mail ou permissions hors plafond du rôle.' });
        }
        const auth = getAuth();
        let newUser: any = null;
        try {
          newUser = await auth.createUser({ email, displayName: name, disabled: false });
          await auth.setCustomUserClaims(newUser.uid, { role, restaurantSlug: slug, permissions });
          const record = {
            uid: newUser.uid, email, displayName: name, role, restaurantSlug: slug,
            permissions, active: true, createdAt: Date.now(), createdBy: user.uid
          };
          const batch = db.batch();
          batch.set(db.collection('managers').doc(newUser.uid), record);
          batch.set(staffRef.doc(newUser.uid), record);
          await batch.commit();
          return json(res, 201, { success: true, staff: record });
        } catch (error: any) {
          if (newUser?.uid) await auth.deleteUser(newUser.uid).catch(() => undefined);
          throw error;
        }
      }

      if (action === 'assign_server_tables') {
        const staffUid = String(body.uid || '').trim();
        const requestedIds: string[] | null = Array.isArray(body.tableIds)
          ? [...new Set((body.tableIds as unknown[]).map((id) => String(id || '').trim()).filter((id) => id.length > 0))]
          : null;
        if (!staffUid || !requestedIds || requestedIds.length > 30) {
          return json(res, 400, { success: false, error: 'Serveur ou liste de tables invalide (30 tables maximum).' });
        }
        if (actor.role === 'manager') {
          const managerSnap = await db.collection('managers').doc(user.uid).get();
          if (!managerSnap.exists || !Array.isArray(managerSnap.data()?.permissions) ||
              !managerSnap.data().permissions.includes('tables.manage')) {
            return json(res, 403, { success: false, error: 'La permission tables.manage est requise pour affecter les tables.' });
          }
        }
        const serverRef = staffRef.doc(staffUid);
        const [serverSnap, serverMembershipSnap] = await Promise.all([
          serverRef.get(), db.collection('managers').doc(staffUid).get()
        ]);
        const server = serverSnap.exists ? serverSnap.data() : null;
        const serverMembership = serverMembershipSnap.exists ? serverMembershipSnap.data() : null;
        if (!server || !serverMembership ||
            server.role !== 'server' || serverMembership.role !== 'server' ||
            server.active !== true || serverMembership.active !== true ||
            server.restaurantSlug !== slug || serverMembership.restaurantSlug !== slug ||
            Number(server.sessionVersion || 0) !== Number(serverMembership.sessionVersion || 0)) {
          return json(res, 409, { success: false, error: 'Seul un serveur actif et correctement lié à ce restaurant peut recevoir des tables.' });
        }
        const tablesRef = db.collection('restaurants').doc(slug).collection('tables');
        const [previousAssignments, requestedSnapshots] = await Promise.all([
          tablesRef.where('assignedWaiter', '==', staffUid).get(),
          Promise.all(requestedIds.map((id: string) => tablesRef.doc(id).get()))
        ]);
        if (requestedSnapshots.some((snap: any) => !snap.exists || snap.data()?.isActive !== true)) {
          return json(res, 400, { success: false, error: 'Une ou plusieurs tables sont introuvables ou inactives.' });
        }
        const refsByPath = new Map<string, any>();
        previousAssignments.docs.forEach((doc: any) => refsByPath.set(doc.ref.path, doc.ref));
        requestedSnapshots.forEach((snap: any) => refsByPath.set(snap.ref.path, snap.ref));
        const refs = [...refsByPath.values()];
        const ordersRef = db.collection('restaurants').doc(slug).collection('orders');
        const serverMembershipRef = db.collection('managers').doc(staffUid);
        await db.runTransaction(async (tx: any) => {
          const [snapshots, freshServerMembershipSnap] = await Promise.all([
            Promise.all(refs.map((ref: any) => tx.get(ref))),
            tx.get(serverMembershipRef)
          ]);
          const freshServerMembership = freshServerMembershipSnap.exists ? freshServerMembershipSnap.data() : null;
          if (!freshServerMembership || freshServerMembership.active !== true ||
              freshServerMembership.role !== 'server' || freshServerMembership.restaurantSlug !== slug) {
            throw new Error('Le serveur a été suspendu ou modifié pendant l’affectation.');
          }
          if (snapshots.some((snap: any) => !snap.exists)) {
            throw new Error('Une table a été supprimée pendant l’affectation.');
          }
          const orderSnapshots = await Promise.all(snapshots.map((snap: any) => {
            const tableNumber = String(snap.data()?.tableNumber || '').trim();
            return tableNumber ? tx.get(ordersRef.where('tableNumber', '==', tableNumber)) : Promise.resolve(null);
          }));
          const requestedSet = new Set(requestedIds);
          const now = Date.now();
          snapshots.forEach((snap: any, index: number) => {
            const data = snap.data() || {};
            const tableId = refs[index].id;
            const isRequested = requestedSet.has(tableId);
            if (isRequested && data.isActive !== true) {
              throw new Error('Une table sélectionnée est devenue inactive.');
            }
            const currentWaiterUid = typeof data.assignedWaiter === 'string' ? data.assignedWaiter : null;
            const targetWaiterUid = isRequested ? staffUid : (currentWaiterUid === staffUid ? null : currentWaiterUid);
            if (isRequested || currentWaiterUid === staffUid) {
              tx.update(refs[index], {
                assignedWaiter: targetWaiterUid,
                assignedWaiterName: targetWaiterUid === staffUid ? String(server.displayName || '') : null,
                assignmentUpdatedAt: now,
                assignmentUpdatedBy: user.uid
              });
            }
            const orders = orderSnapshots[index]?.docs || [];
            orders.forEach((orderDoc: any) => {
              if (['pending', 'in_prep', 'ready'].includes(String(orderDoc.data()?.status || '')) &&
                  orderDoc.data()?.assignedWaiterUid !== targetWaiterUid) {
                tx.update(orderDoc.ref, {
                  assignedWaiterUid: targetWaiterUid,
                  waiterAssignmentUpdatedAt: now,
                  waiterAssignmentUpdatedBy: user.uid
                });
              }
            });
          });
        });
        await db.collection('admin_audit_logs').add({
          action: 'assign_server_tables', restaurantSlug: slug, targetUid: staffUid,
          tableIds: requestedIds, actorUid: user.uid, createdAt: Date.now(),
          activeOrdersSynchronized: true
        });
        return json(res, 200, { success: true, uid: staffUid, tableIds: requestedIds });
      }

      const staffUid = String(body.uid || '').trim();
      if (!staffUid || staffUid === user.uid) return json(res, 400, { success: false, error: 'Compte personnel invalide.' });
      const memberRef = staffRef.doc(staffUid);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) return json(res, 404, { success: false, error: 'Membre introuvable.' });
      const member = memberSnap.data();
      if (!canManageStaffMember(actor.role, String(member?.role || ''))) {
        return json(res, 403, { success: false, error: actor.role === 'manager'
          ? 'Un manager ne peut gérer que les caissiers, serveurs et équipes Cuisine/Bar.'
          : 'Le compte propriétaire ne peut pas être géré depuis le personnel du restaurant.' });
      }
      const restaurantSnap = await db.collection('restaurants').doc(slug).get();
      if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'deleted' || restaurantSnap.data()?.deletedAt) {
        return json(res, 409, { success: false, error: 'Les comptes associés à un restaurant supprimé ne peuvent plus être modifiés.' });
      }
      if (restaurantSnap.data()?.status !== 'active') {
        return json(res, 409, { success: false, error: 'Le restaurant est suspendu : gestion du personnel indisponible.' });
      }
      const managerRef = db.collection('managers').doc(staffUid);
      const managerSnap = await managerRef.get();
      const currentSessionVersion = Math.max(
        Number(member.sessionVersion || 0),
        Number(managerSnap.data()?.sessionVersion || 0)
      );
      const auth = getAuth();

      if (action === 'disable_staff' || action === 'set_staff_status') {
        const nextActive = action === 'disable_staff' ? false : body.status === 'active';
        if (action === 'set_staff_status' && !['active', 'suspended'].includes(body.status)) {
          return json(res, 400, { success: false, error: 'Statut de compte invalide.' });
        }
        if (nextActive && restaurantSnap.data()?.status !== 'active') {
          return json(res, 409, { success: false, error: 'Réactive d’abord le restaurant avant de réactiver ses comptes.' });
        }
        const now = Date.now();
        const sessionVersion = currentSessionVersion + 1;
        const authUser = await auth.getUser(staffUid);
        const nextClaims = { ...(authUser.customClaims || {}), sessionVersion };
        if (nextActive) {
          if (member.role === 'server') await releaseServerTables(staffUid);
          // Publish a new token version before reopening Firestore membership.
          await auth.setCustomUserClaims(staffUid, nextClaims);
          await auth.updateUser(staffUid, { disabled: false });
          await auth.revokeRefreshTokens(staffUid);
          const batch = db.batch();
          batch.set(memberRef, { active: true, status: 'active', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
          batch.set(managerRef, { active: true, status: 'active', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
          await batch.commit();
        } else {
          // Close Firestore authorization first; the incremented version invalidates existing ID tokens after reactivation too.
          const batch = db.batch();
          batch.set(memberRef, { active: false, status: 'suspended', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
          batch.set(managerRef, { active: false, status: 'suspended', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
          await batch.commit();
          if (member.role === 'server') await releaseServerTables(staffUid);
          await auth.setCustomUserClaims(staffUid, nextClaims);
          await auth.updateUser(staffUid, { disabled: true });
          await auth.revokeRefreshTokens(staffUid);
        }
        await db.collection('admin_audit_logs').add({ action: nextActive ? 'reactivate_user' : 'suspend_user', restaurantSlug: slug, targetUid: staffUid, targetRole: member.role, actorUid: user.uid, createdAt: now });
        return json(res, 200, { success: true, status: nextActive ? 'active' : 'suspended' });
      }

      if (action === 'delete_staff') {
        const now = Date.now();
        // Revoke Firestore authorization before touching Auth; never remove business history.
        const revokeBatch = db.batch();
        const sessionVersion = Number(member.sessionVersion || 0) + 1;
        revokeBatch.set(memberRef, { active: false, status: 'deleting', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
        revokeBatch.set(managerRef, { active: false, status: 'deleting', sessionVersion, updatedAt: now, updatedBy: user.uid }, { merge: true });
        await revokeBatch.commit();
        if (member.role === 'server') await releaseServerTables(staffUid);
        try {
          const authUser = await auth.getUser(staffUid);
          await auth.setCustomUserClaims(staffUid, { ...(authUser.customClaims || {}), sessionVersion });
          await auth.updateUser(staffUid, { disabled: true });
          await auth.revokeRefreshTokens(staffUid);
        } catch (error: any) {
          if (error?.code !== 'auth/user-not-found') throw error;
        }
        try { await auth.deleteUser(staffUid); } catch (error: any) {
          if (error?.code !== 'auth/user-not-found') throw error;
        }
        const batch = db.batch();
        batch.delete(memberRef);
        batch.delete(managerRef);
        const currentOwnerUid = await getRestaurantOwnerUid(db, slug, undefined, actor.restaurant);
        if (member.role === 'owner' && currentOwnerUid === staffUid) {
          batch.set(db.collection('restaurants').doc(slug).collection('private').doc('ownership'), {
            ownerUid: null, ownerName: null, ownerEmail: null, ownerRemovedAt: now, ownerRemovedBy: user.uid
          }, { merge: true });
        }
        await batch.commit();
        await db.collection('admin_audit_logs').add({ action: 'delete_user_account', restaurantSlug: slug, targetUid: staffUid, targetRole: member.role, actorUid: user.uid, createdAt: now, businessHistoryPreserved: true });
        return json(res, 200, { success: true, deleted: true });
      }
      if (action === 'update_staff') {
        const role = parseRestaurantRole(body.role);
        if (!role) return json(res, 400, { success: false, error: 'Rôle invalide.' });
        if (actor.role === 'manager' && role === 'manager') return json(res, 403, { success: false, error: 'Un manager ne peut pas promouvoir ou administrer un autre manager.' });
        let permissions: Permission[] | null;
        if (actor.role === 'owner') {
          permissions = resolveRolePermissions(role, body.permissions, true);
        } else {
          // Managers may maintain base role permissions but may neither add nor
          // silently remove owner-granted extras by changing the member's role.
          const expectedPermissions = resolveManagerPermissionUpdate(member.role, role, member.permissions);
          if (!expectedPermissions) {
            return json(res, 403, { success: false, error: 'Seul le propriétaire peut retirer une autorisation supplémentaire ou changer de rôle si elle ne peut pas être conservée.' });
          }
          const base = ROLE_BASE_PERMISSIONS[role];
          const expectedExtras = expectedPermissions.filter(permission => !base.includes(permission));
          const requestedExtras = Array.isArray(body.permissions)
            ? [...new Set(body.permissions.filter((p: unknown): p is Permission =>
                typeof p === 'string' && ROLE_PERMISSION_CEILINGS[role].includes(p as Permission) && !base.includes(p as Permission)))]
            : [];
          if (expectedExtras.slice().sort().join('|') !== requestedExtras.slice().sort().join('|')) {
            return json(res, 403, { success: false, error: 'Seul le propriétaire peut modifier les autorisations supplémentaires.' });
          }
          permissions = resolveRolePermissions(role, expectedPermissions, true);
        }
        if (!permissions) return json(res, 400, { success: false, error: 'Permissions incompatibles avec le plafond du rôle.' });
        const managerRecord = managerSnap.exists ? managerSnap.data() : null;
        const permissionSignature = (value: unknown) => Array.isArray(value)
          ? value.map(permission => String(permission)).sort().join('|')
          : '';
        if (!managerRecord || managerRecord.restaurantSlug !== slug || member.restaurantSlug !== slug ||
            managerRecord.uid !== staffUid || managerRecord.active !== member.active || managerRecord.role !== member.role ||
            Number(managerRecord.sessionVersion || 0) !== Number(member.sessionVersion || 0) ||
            permissionSignature(managerRecord.permissions) !== permissionSignature(member.permissions)) {
          return json(res, 409, { success: false, error: 'Les références d’accès du membre sont incohérentes. Actualisez la liste ou demandez une réparation du compte.' });
        }

        // Update both membership records atomically. The session version changes in
        // the same commit, so all previously issued ID tokens are denied immediately.
        const sessionVersion = currentSessionVersion + 1;
        const updatedAt = Date.now();
        await db.runTransaction(async (tx: any) => {
          const [freshMemberSnap, freshManagerSnap] = await Promise.all([
            tx.get(memberRef),
            tx.get(managerRef)
          ]);
          if (!freshMemberSnap.exists || !freshManagerSnap.exists) {
            throw new Error('Références d’accès du membre introuvables.');
          }
          const freshMember = freshMemberSnap.data();
          const freshManager = freshManagerSnap.data();
          if (freshMember.role !== member.role || freshManager.role !== member.role ||
              freshManager.restaurantSlug !== slug || freshMember.restaurantSlug !== slug ||
              freshManager.active !== freshMember.active ||
              Number(freshMember.sessionVersion || 0) !== currentSessionVersion ||
              Number(freshManager.sessionVersion || 0) !== currentSessionVersion ||
              permissionSignature(freshMember.permissions) !== permissionSignature(member.permissions) ||
              permissionSignature(freshManager.permissions) !== permissionSignature(member.permissions)) {
            throw new Error('Conflit : les droits du membre ont changé pendant la modification. Actualisez puis réessayez.');
          }
          tx.set(memberRef, { role, permissions, sessionVersion, updatedAt, updatedBy: user.uid }, { merge: true });
          tx.set(managerRef, { role, permissions, sessionVersion, updatedAt, updatedBy: user.uid }, { merge: true });
        });

        // Refresh the Auth claims only after the authoritative Firestore records
        // have committed. If Auth is temporarily unavailable, the version mismatch
        // keeps the old session blocked and an administrator can safely retry.
        const currentAuthUser = await getAuth().getUser(staffUid);
        await getAuth().setCustomUserClaims(staffUid, { ...(currentAuthUser.customClaims || {}), role, restaurantSlug: slug, permissions, sessionVersion });
        await getAuth().revokeRefreshTokens(staffUid);
        if (member.role === 'server' && role !== 'server') await releaseServerTables(staffUid);
        return json(res, 200, { success: true, requiresReauthentication: true });
      }
    }

    return json(res, 400, { success: false, error: 'Action administrative inconnue.' });
  } catch (error: any) {
    const code = error?.code;
    const message = code === 'auth/email-already-exists'
      ? 'Cette adresse e-mail possède déjà un compte RestauMax.'
      : 'Une erreur est survenue pendant l’opération administrative.';
    console.error('[RestauMax Admin]', code || error?.message || 'unknown');
    return json(res, 500, { success: false, error: message });
  }
}
