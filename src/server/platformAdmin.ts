import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { validateSubscriptionInput } from './subscriptionService.js';
import { settleSubscriptionInvoiceWithDb } from './subscriptionBillingService.js';
import { getRestaurantOwnership, getRestaurantOwnerUid } from './restaurantOwnership.ts';
import {
  beginPlatformAdminMfaEnrollment, confirmPlatformAdminMfaEnrollment,
  getPlatformAdminMfaStatus, hasValidPlatformAdminMfaSession,
  revokePlatformAdminMfaSessions, verifyPlatformAdminMfaAndCreateSession
} from './platformAdminMfa.js';

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

function planIdentifier(name: string) {
  return slugify(name).replace(/-/g, '_').slice(0, 60) || 'plan';
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

function isProtectedSuperAdminAccount(authUser: any): boolean {
  const email = String(authUser?.email || '').trim().toLowerCase();
  return authUser?.customClaims?.role === 'super_admin' || (!!email && configuredSuperAdmins().includes(email));
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

function isSuperAdminIdentity(user: DecodedIdToken): boolean {
  // Identity recognition is separate from the custom RestauMax MFA session proof.
  const hasTrustedSuperAdminClaim = user.role === 'super_admin';
  const verifiedAllowlistedEmail = user.email_verified === true &&
    typeof user.email === 'string' &&
    configuredSuperAdmins().includes(user.email.toLowerCase());
  if (!hasTrustedSuperAdminClaim && !verifiedAllowlistedEmail) return false;
  return true;
}

export function isSuperAdmin(user: DecodedIdToken) {
  // Preserve the legacy Firebase-token predicate for existing callers and regression tests.
  if (!isSuperAdminIdentity(user)) return false;
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
  support: ['platform.overview', 'support.read', 'support.manage', 'support.access.request', 'support.access.diagnostics', 'accounts.read', 'health.read', 'audit.read', 'communication.read'],
  read_only: ['platform.overview', 'support.read', 'health.read', 'audit.read', 'communication.read']
};

function platformAdminMfaSatisfied(_user: DecodedIdToken, mfaSessionValid: boolean): boolean {
  return process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA !== 'true' || mfaSessionValid;
}

export async function getPlatformAdminRole(db: any, user: DecodedIdToken, mfaSessionValid = false): Promise<PlatformAdminRole | null> {
  if (isSuperAdminIdentity(user)) return platformAdminMfaSatisfied(user, mfaSessionValid) ? 'full' : null;
  if (user.role !== 'platform_admin' || !platformAdminMfaSatisfied(user, mfaSessionValid)) return null;
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
  if (['overview', 'audit_list', 'platform_capabilities'].includes(action)) return true;
  if (role === 'billing') return ['billing_list', 'billing_catalog_read', 'update_subscription', 'settle_subscription_invoice', 'promotion_list', 'promotion_save', 'promotion_toggle'].includes(action);
  if (role === 'support') return ['support_list', 'support_messages', 'support_create', 'support_update', 'support_access_request', 'support_access_list', 'support_access_diagnostics', 'platform_staff_list', 'health_details', 'announcement_list'].includes(action);
  if (role === 'read_only') return ['support_list', 'support_messages', 'health_details', 'announcement_list'].includes(action);
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

  const body = req.body || {};
  const action = req.method === 'GET' ? String(req.query?.action || 'overview') : String(body.action || '');
  const cookieHeader = String(req.headers?.cookie || '');
  const mfaCookie = cookieHeader.split(';').map((part: string) => part.trim())
    .find((part: string) => part.startsWith('restaumax_platform_mfa='))?.slice('restaumax_platform_mfa='.length) || '';
  const mfaSessionVersion = Number((user as any).sessionVersion || (user as any).platformAdminSessionVersion || 1);

  const mfaActions = ['mfa_status', 'mfa_enroll_start', 'mfa_enroll_confirm', 'mfa_verify', 'mfa_logout'];
  if (mfaActions.includes(action)) {
    const delegatedIdentity = user.role === 'platform_admin' &&
      await getPlatformAdminRole(db, user, true) !== null;
    if (!isSuperAdminIdentity(user) && !delegatedIdentity) {
      return json(res, 403, { success: false, error: 'Compte administrateur plateforme requis.' });
    }
    if (action === 'mfa_status') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      return json(res, 200, { success: true, ...(await getPlatformAdminMfaStatus(db, user.uid)) });
    }
    if (action === 'mfa_enroll_start') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      if (Number(user.auth_time || 0) < Math.floor(Date.now() / 1000) - 10 * 60) {
        return json(res, 401, { success: false, error: 'Reconnectez-vous avant de configurer le MFA.' });
      }
      const status = await getPlatformAdminMfaStatus(db, user.uid);
      if (status.enrolled) return json(res, 409, { success: false, error: 'Un facteur MFA est déjà enrôlé.' });
      try {
        const setup = await beginPlatformAdminMfaEnrollment(db, user.uid, String(user.email || user.uid));
        return json(res, 200, { success: true, ...setup });
      } catch {
        return json(res, 503, { success: false, error: 'Configuration de chiffrement MFA indisponible.' });
      }
    }
    if (action === 'mfa_enroll_confirm') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const recoveryCodes = await confirmPlatformAdminMfaEnrollment(db, user.uid, String(body.code || ''));
      if (!recoveryCodes) return json(res, 400, { success: false, error: 'Code invalide, déjà utilisé ou enrôlement expiré.' });
      return json(res, 200, { success: true, enrolled: true, recoveryCodes, reauthenticationRequired: true });
    }
    if (action === 'mfa_verify') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      try {
        const session = await verifyPlatformAdminMfaAndCreateSession(db, user.uid, String(body.code || ''), mfaSessionVersion);
        if (!session) return json(res, 401, { success: false, error: 'Code MFA invalide, déjà utilisé ou temporairement bloqué.' });
        res.setHeader?.('Set-Cookie', `restaumax_platform_mfa=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/api/platform-admin; Max-Age=14400`);
        return json(res, 200, { success: true, expiresAt: session.expiresAt });
      } catch {
        return json(res, 503, { success: false, error: 'Service MFA temporairement indisponible.' });
      }
    }
    if (action === 'mfa_logout') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      await revokePlatformAdminMfaSessions(db, user.uid);
      res.setHeader?.('Set-Cookie', 'restaumax_platform_mfa=; HttpOnly; Secure; SameSite=Strict; Path=/api/platform-admin; Max-Age=0');
      return json(res, 200, { success: true });
    }
  }

  const mfaSessionValid = process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA !== 'true' ||
    await hasValidPlatformAdminMfaSession(db, user.uid, mfaSessionVersion, mfaCookie);

  // Restaurant-side support and announcement reads are tenant-scoped. They
  // intentionally run before the platform-admin membership exclusion below.
  const membershipRef = db.collection('managers').doc(user.uid);
  const membershipSnap = await membershipRef.get();
  const existingMembership = membershipSnap.exists ? (membershipSnap.data() || {}) : null;
  if (['support_submit', 'support_my_tickets', 'support_reply', 'restaurant_announcements', 'support_access_requests', 'support_access_decision', 'support_access_revoke'].includes(action)) {
    const member = existingMembership;
    const slug = String(member?.restaurantSlug || '').trim();
    if (!member || member.active !== true || !slug ||
        !['owner', 'manager', 'cashier', 'server', 'kitchen', 'staff'].includes(String(member.role || '')) ||
        Number(user.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return json(res, 403, { success: false, error: 'Compte restaurant actif requis pour accéder au support.' });
    }
    const restaurantRef = db.collection('restaurants').doc(slug);
    const restaurantSnap = await restaurantRef.get();
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() || {} : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt) {
      return json(res, 403, { success: false, error: 'Ce restaurant ne peut pas accéder aux services de la plateforme.' });
    }
    const now = Date.now();
    if (action === 'support_submit') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const subject = String(body.subject || '').trim();
      const message = String(body.message || '').trim();
      const priority = ['low', 'medium', 'high'].includes(String(body.priority)) ? String(body.priority) : 'medium';
      if (subject.length < 5 || subject.length > 140 || message.length < 10 || message.length > 4000) {
        return json(res, 400, { success: false, error: 'Le sujet doit contenir 5 à 140 caractères et le message 10 à 4 000 caractères.' });
      }
      const ticketRef = db.collection('platform_support_tickets').doc();
      const ticket = {
        id: ticketRef.id, restaurantSlug: slug, restaurantName: String(restaurant.name || slug),
        subject, priority, status: 'open', source: 'restaurant_portal',
        createdByUid: user.uid, createdByName: String(user.name || user.email || user.uid),
        createdByEmail: typeof user.email === 'string' ? user.email : '',
        createdAt: now, updatedAt: now, lastMessageAt: now, messageCount: 1
      };
      const batch = db.batch();
      batch.create(ticketRef, ticket);
      batch.create(ticketRef.collection('messages').doc(), {
        authorUid: user.uid, authorRole: String(member.role), body: message,
        visibility: 'public', createdAt: now
      });
      batch.create(db.collection('admin_audit_logs').doc(), {
        action: 'support_ticket_created', restaurantSlug: slug, ticketId: ticketRef.id,
        actorUid: user.uid, actorRole: String(member.role), createdAt: now
      });
      await batch.commit();
      return json(res, 201, { success: true, ticket });
    }
    if (action === 'support_my_tickets') {
      if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const snap = await db.collection('platform_support_tickets').where('restaurantSlug', '==', slug).limit(100).get();
      const tickets = await Promise.all(snap.docs.map(async (doc: any) => {
        const messages = await doc.ref.collection('messages').orderBy('createdAt', 'asc').limit(50).get();
        return { ...doc.data(), messages: messages.docs.map((message: any) => ({ id: message.id, ...message.data() })).filter((message: any) => message.visibility !== 'internal') };
      }));
      tickets.sort((a: any, b: any) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      return json(res, 200, { success: true, tickets: tickets.slice(0, 30) });
    }
    if (action === 'support_reply') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const ticketId = String(body.ticketId || '').trim();
      const message = String(body.message || '').trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(ticketId) || message.length < 2 || message.length > 4000) {
        return json(res, 400, { success: false, error: 'Réponse invalide.' });
      }
      const ticketRef = db.collection('platform_support_tickets').doc(ticketId);
      const ticketSnap = await ticketRef.get();
      if (!ticketSnap.exists || ticketSnap.data()?.restaurantSlug !== slug || ['closed'].includes(String(ticketSnap.data()?.status))) {
        return json(res, 404, { success: false, error: 'Ticket introuvable ou fermé.' });
      }
      const batch = db.batch();
      batch.create(ticketRef.collection('messages').doc(), {
        authorUid: user.uid, authorRole: String(member.role), body: message,
        visibility: 'public', createdAt: now
      });
      batch.update(ticketRef, {
        updatedAt: now, lastMessageAt: now, messageCount: Number(ticketSnap.data()?.messageCount || 0) + 1,
        status: 'waiting_support'
      });
      batch.create(db.collection('admin_audit_logs').doc(), {
        action: 'support_ticket_customer_reply', restaurantSlug: slug, ticketId,
        actorUid: user.uid, actorRole: String(member.role), createdAt: now
      });
      await batch.commit();
      return json(res, 200, { success: true });
    }
    if (action === 'support_access_requests' || action === 'support_access_decision' || action === 'support_access_revoke') {
      if (action === 'support_access_decision' || action === 'support_access_revoke') {
        const ownerUid = await getRestaurantOwnerUid(db, slug, undefined, restaurant);
        if (member.role !== 'owner' || ownerUid !== user.uid) {
          return json(res, 403, { success: false, error: 'Seul le propriétaire du restaurant peut gérer le consentement au diagnostic.' });
        }
      }
      if (action === 'support_access_revoke') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const requestId = String(body.requestId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return json(res, 400, { success: false, error: 'Demande invalide.' });
        const requestRef = db.collection('platform_support_access_requests').doc(requestId);
        const requestSnap = await requestRef.get();
        const requestData = requestSnap.exists ? requestSnap.data() || {} : null;
        if (!requestData || requestData.restaurantSlug !== slug || requestData.status !== 'approved' || Number(requestData.accessExpiresAt || 0) <= now) {
          return json(res, 409, { success: false, error: 'Accès déjà expiré ou demande introuvable.' });
        }
        await requestRef.update({ status: 'revoked', accessExpiresAt: now, revokedAt: now, revokedBy: user.uid, updatedAt: now });
        await db.collection('admin_audit_logs').add({
          action: 'revoke_support_diagnostic_access', restaurantSlug: slug,
          supportAccessRequestId: requestId, actorUid: user.uid, createdAt: now
        });
        return json(res, 200, { success: true, status: 'revoked' });
      }
      if (action === 'support_access_requests') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_support_access_requests').where('restaurantSlug', '==', slug).limit(30).get();
        const requests = snap.docs.map((doc: any) => doc.data()).filter((item: any) =>
          (item.status === 'pending' && Number(item.requestExpiresAt || 0) > now) ||
          (item.status === 'approved' && Number(item.accessExpiresAt || 0) > now)
        ).sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return json(res, 200, { success: true, requests });
      }
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const requestId = String(body.requestId || '').trim();
      const approve = body.approve === true;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || typeof body.approve !== 'boolean') {
        return json(res, 400, { success: false, error: 'Décision de consentement invalide.' });
      }
      const requestRef = db.collection('platform_support_access_requests').doc(requestId);
      const requestSnap = await requestRef.get();
      const requestData = requestSnap.exists ? requestSnap.data() || {} : null;
      if (!requestData || requestData.restaurantSlug !== slug || requestData.status !== 'pending' ||
          Number(requestData.requestExpiresAt || 0) <= now) {
        return json(res, 409, { success: false, error: 'Demande introuvable, expirée ou déjà traitée.' });
      }
      const patch = approve
        ? { status: 'approved', approvedAt: now, approvedBy: user.uid, accessExpiresAt: now + 60 * 60 * 1000 }
        : { status: 'denied', deniedAt: now, deniedBy: user.uid, accessExpiresAt: null };
      await requestRef.update({ ...patch, updatedAt: now });
      await db.collection('admin_audit_logs').add({
        action: approve ? 'approve_support_diagnostic_access' : 'deny_support_diagnostic_access',
        restaurantSlug: slug, supportAccessRequestId: requestId,
        actorUid: user.uid, createdAt: now, accessDurationMinutes: approve ? 60 : 0
      });
      return json(res, 200, { success: true, status: approve ? 'approved' : 'denied', accessExpiresAt: approve ? now + 60 * 60 * 1000 : null });
    }
    if (action === 'restaurant_announcements') {
      if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const [announcementsSnap, subscriptionSnap] = await Promise.all([
        db.collection('platform_announcements').where('status', '==', 'published').limit(100).get(),
        db.collection('restaurantSubscriptions').doc(slug).get()
      ]);
      const planName = String(subscriptionSnap.data()?.planName || restaurant.subscription?.planName || '');
      const announcements = announcementsSnap.docs.map((doc: any) => doc.data()).filter((item: any) => {
        const publishedAt = Number(item.publishedAt || item.scheduledAt || 0);
        if (publishedAt > now) return false;
        if (item.targetType === 'selected') return Array.isArray(item.restaurantSlugs) && item.restaurantSlugs.includes(slug);
        if (item.targetType === 'plan') return String(item.planName || '') === planName;
        return item.targetType === 'all';
      }).sort((a: any, b: any) => Number(b.publishedAt || 0) - Number(a.publishedAt || 0)).slice(0, 10);
      return json(res, 200, { success: true, announcements });
    }
  }

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

  try {
    // Global platform administration: allowlisted super-admin or trusted custom claim only.
    if (['overview', 'billing_list', 'billing_catalog_read', 'audit_list', 'platform_capabilities', 'create_restaurant', 'set_restaurant_status', 'update_subscription', 'settle_subscription_invoice', 'delete_restaurant', 'platform_admin_list', 'platform_admin_create', 'platform_admin_update', 'platform_admin_status', 'platform_account_password_reset', 'platform_owner_invite', 'platform_staff_status', 'platform_staff_revoke_sessions', 'platform_staff_list', 'support_list', 'support_messages', 'support_create', 'support_update', 'support_access_request', 'support_access_list', 'support_access_diagnostics', 'config_read', 'config_update', 'promotion_list', 'promotion_save', 'promotion_toggle', 'announcement_list', 'announcement_save', 'announcement_publish', 'announcement_cancel', 'health_details', 'mfa_reset'].includes(action)) {
      const platformRole = await getPlatformAdminRole(db, user, mfaSessionValid);
      if (!platformRole || !canPlatformAdminPerform(platformRole, action)) return json(res, 403, { success: false, error: 'Cette action est réservée à un rôle super-administrateur autorisé.' });

      if (action === 'mfa_reset') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        if (platformRole !== 'full') return json(res, 403, { success: false, error: 'Seul un Super-admin avec MFA validé peut réinitialiser un facteur MFA.' });
        const targetUid = String(body.uid || '').trim();
        if (!/^[A-Za-z0-9]{20,128}$/.test(targetUid) || targetUid === user.uid) {
          return json(res, 400, { success: false, error: 'Compte cible invalide. Un autre Super-admin doit effectuer cette réinitialisation.' });
        }
        const auth = getAuth();
        const targetAuthUser = await auth.getUser(targetUid);
        const delegatedRef = db.collection('platform_admins').doc(targetUid);
        const delegatedSnap = await delegatedRef.get();
        const targetEmail = String(targetAuthUser.email || '').trim().toLowerCase();
        const protectedSuperAdmin = targetAuthUser.customClaims?.role === 'super_admin' ||
          (targetEmail && configuredSuperAdmins().includes(targetEmail));
        if (!delegatedSnap.exists && !protectedSuperAdmin) {
          return json(res, 404, { success: false, error: 'Compte administrateur plateforme introuvable.' });
        }
        const nextVersion = Math.max(
          Number(targetAuthUser.customClaims?.sessionVersion || 0),
          Number(targetAuthUser.customClaims?.platformAdminSessionVersion || 0),
          Number(delegatedSnap.data()?.sessionVersion || 0)
        ) + 1;
        const nextClaims = { ...(targetAuthUser.customClaims || {}) };
        if (protectedSuperAdmin) {
          nextClaims.role = 'super_admin';
          nextClaims.sessionVersion = nextVersion;
        } else {
          nextClaims.platformAdminSessionVersion = nextVersion;
        }
        await auth.setCustomUserClaims(targetUid, nextClaims);
        await auth.revokeRefreshTokens(targetUid);
        if (delegatedSnap.exists) await delegatedRef.update({ sessionVersion: nextVersion, updatedAt: Date.now(), mfaResetAt: Date.now(), mfaResetBy: user.uid });
        await db.collection('platform_admin_mfa').doc(targetUid).delete().catch(() => undefined);
        await revokePlatformAdminMfaSessions(db, targetUid);
        await db.collection('admin_audit_logs').add({
          action: 'platform_admin_mfa_reset', targetUid, targetEmail,
          actorUid: user.uid, actorRole: 'super_admin', createdAt: Date.now()
        });
        return json(res, 200, { success: true, uid: targetUid, reauthenticationRequired: true, enrollmentRequired: true });
      }

      if (action === 'platform_capabilities') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const knownActions = [
          'overview', 'billing_list', 'billing_catalog_read', 'audit_list', 'create_restaurant', 'set_restaurant_status',
          'update_subscription', 'settle_subscription_invoice', 'delete_restaurant',
          'platform_admin_list', 'platform_admin_create', 'platform_admin_update', 'platform_admin_status',
          'platform_owner_invite', 'platform_staff_status', 'platform_staff_revoke_sessions',
          'platform_staff_list', 'support_list', 'support_messages', 'support_create', 'support_update',
          'support_access_request', 'support_access_list', 'support_access_diagnostics',
          'config_read', 'config_update', 'promotion_list', 'promotion_save', 'promotion_toggle', 'announcement_list', 'announcement_save',
          'announcement_publish', 'announcement_cancel', 'health_details'
        ];
        return json(res, 200, {
          success: true, role: platformRole,
          allowedActions: knownActions.filter((candidate: string) => canPlatformAdminPerform(platformRole, candidate))
        });
      }

      if (action === 'platform_admin_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_admins').orderBy('createdAt', 'desc').limit(100).get();
        const admins = await Promise.all(snap.docs.map(async (doc: any) => {
          const raw = doc.data() || {};
          let authUser: any = null;
          try { authUser = await getAuth().getUser(doc.id); } catch { /* report a disabled/unavailable identity */ }
          return {
            uid: doc.id, email: String(raw.email || authUser?.email || ''),
            displayName: String(raw.displayName || authUser?.displayName || ''),
            role: String(raw.role || 'read_only'), active: raw.active === true,
            createdAt: Number(raw.createdAt || 0), updatedAt: Number(raw.updatedAt || 0),
            lastSignInAt: authUser?.metadata?.lastSignInTime ? Date.parse(authUser.metadata.lastSignInTime) : null,
            mfaEnrolled: Array.isArray(authUser?.multiFactor?.enrolledFactors) && authUser.multiFactor.enrolledFactors.length > 0,
            disabled: authUser?.disabled === true
          };
        }));
        const knownUids = new Set(admins.map((admin: any) => admin.uid));
        const trustedPrimaryUsers = new Map<string, any>();
        // Include Firebase identities carrying the server-issued super_admin claim,
        // even when they are not represented in platform_admins or the bootstrap allowlist.
        let pageToken: string | undefined;
        do {
          const page = await getAuth().listUsers(1000, pageToken);
          for (const authUser of page.users) {
            if (authUser.customClaims?.role === 'super_admin') trustedPrimaryUsers.set(authUser.uid, authUser);
          }
          pageToken = page.pageToken;
        } while (pageToken);
        // Also include verified bootstrap allowlist identities, when provisioned.
        for (const email of configuredSuperAdmins()) {
          try {
            const authUser = await getAuth().getUserByEmail(email);
            trustedPrimaryUsers.set(authUser.uid, authUser);
          } catch { /* a configured address without a Firebase identity is not presented as an account */ }
        }
        for (const authUser of trustedPrimaryUsers.values()) {
          if (knownUids.has(authUser.uid)) continue;
          admins.unshift({
            uid: authUser.uid, email: String(authUser.email || ''),
            displayName: String(authUser.displayName || 'Super-administrateur principal'),
            role: 'full', active: authUser.disabled !== true, mfaEnrolled: Array.isArray(authUser.multiFactor?.enrolledFactors) && authUser.multiFactor.enrolledFactors.length > 0,
            disabled: authUser.disabled === true, lastSignInAt: authUser.metadata?.lastSignInTime ? Date.parse(authUser.metadata.lastSignInTime) : null,
            isPrimary: true
          });
        }
        return json(res, 200, { success: true, admins });
      }

      if (action === 'platform_staff_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(req.query?.slug || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return json(res, 400, { success: false, error: 'Restaurant invalide.' });
        const restaurantSnap = await db.collection('restaurants').doc(slug).get();
        if (!restaurantSnap.exists || restaurantSnap.data()?.deletedAt || restaurantSnap.data()?.status === 'deleted') {
          return json(res, 404, { success: false, error: 'Restaurant introuvable ou supprimé.' });
        }
        const [staffSnap, managersSnap] = await Promise.all([
          db.collection('restaurants').doc(slug).collection('staff').get(),
          db.collection('managers').where('restaurantSlug', '==', slug).get()
        ]);
        const canSeeFullAccountDetails = platformRole === 'full';
        const byUid = new Map<string, any>();
        const addAccount = (raw: any) => {
          const uid = String(raw?.uid || raw?.id || '').trim();
          if (!uid) return;
          const previous = byUid.get(uid) || {
            uid, email: '', displayName: '', role: raw?.role || 'staff',
            active: raw?.active === true, activeKnown: typeof raw?.active === 'boolean',
            accountLinked: true, emailConflict: false, emailValues: []
          };
          const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
          if (email && !previous.emailValues.includes(email)) previous.emailValues.push(email);
          previous.emailConflict = previous.emailValues.length > 1;
          previous.email = email || previous.email;
          previous.displayName = String(raw?.displayName || raw?.ownerName || previous.displayName || '');
          previous.role = raw?.role === 'owner' || previous.role === 'owner' ? 'owner' : (raw?.role || previous.role);
          if (typeof raw?.active === 'boolean') { previous.active = raw.active; previous.activeKnown = true; }
          byUid.set(uid, previous);
        };
        staffSnap.docs.forEach((doc: any) => addAccount({ ...doc.data(), uid: doc.id }));
        managersSnap.docs.forEach((doc: any) => addAccount({ ...doc.data(), uid: doc.id }));
        const ownership = await getRestaurantOwnership(db, slug, undefined, restaurantSnap.data() || {});
        const ownerUid = String(ownership.ownerUid || '').trim();
        const ownerEmail = typeof ownership.ownerEmail === 'string' ? ownership.ownerEmail.trim().toLowerCase() : '';
        const ownerName = String(ownership.ownerName || '').trim();
        if (ownerUid) {
          addAccount({ uid: ownerUid, email: ownerEmail, displayName: ownerName, role: 'owner' });
        } else if (ownerEmail || ownerName) {
          byUid.set('unlinked-owner', {
            uid: 'unlinked-owner', email: ownerEmail, displayName: ownerName,
            role: 'owner', active: false, activeKnown: false, accountLinked: false,
            emailConflict: false, emailValues: []
          });
        }
        const staff = await Promise.all([...byUid.values()].map(async ({ emailValues, ...account }) => {
          try {
            const authUser = await getAuth().getUser(account.uid);
            const authActive = authUser.disabled !== true;
            const email = String(account.email || authUser.email || '');
            const maskedEmail = email.includes('@') ? email.replace(/^(.).+(@.+)$/, '$1•••$2') : '';
            return {
              ...account,
              email: canSeeFullAccountDetails ? email : maskedEmail,
              displayName: String(account.displayName || authUser.displayName || ''),
              active: account.activeKnown ? account.active && authActive : authActive,
              activeKnown: true, accountLinked: true, readOnly: true
            };
          } catch {
            const email = String(account.email || '');
            const maskedEmail = email.includes('@') ? email.replace(/^(.).+(@.+)$/, '$1•••$2') : '';
            return {
              ...account,
              email: canSeeFullAccountDetails ? email : maskedEmail,
              active: false, activeKnown: false, accountLinked: false, readOnly: true
            };
          }
        }));
        return json(res, 200, {
          success: true, staff, readOnly: !canSeeFullAccountDetails,
          sources: ['restaurants/{slug}/staff', 'managers', 'restaurants.private.ownership']
        });
      }

      if (action === 'platform_admin_create') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const email = String(body.email || '').trim().toLowerCase();
        const displayName = String(body.displayName || '').trim();
        const role = String(body.platformRole || '');
        if (!validEmail(email) || displayName.length < 2 || displayName.length > 100 ||
            !['billing', 'support', 'read_only'].includes(role)) {
          return json(res, 400, { success: false, error: 'Nom, e-mail ou rôle délégué invalide. Le rôle Full ne peut être attribué que par la liste de confiance.' });
        }
        const auth = getAuth();
        let created: any = null;
        try {
          created = await auth.createUser({ email, displayName, disabled: false, emailVerified: false });
          const sessionVersion = 1;
          await auth.setCustomUserClaims(created.uid, {
            role: 'platform_admin', platformAdminRole: role,
            platformAdminSessionVersion: sessionVersion,
            platformAdminPermissions: PLATFORM_ADMIN_ROLE_PERMISSIONS[role as PlatformAdminRole]
          });
          const now = Date.now();
          const record = {
            uid: created.uid, email, displayName, role, active: true,
            sessionVersion, createdAt: now, updatedAt: now, createdBy: user.uid
          };
          const batch = db.batch();
          batch.create(db.collection('platform_admins').doc(created.uid), record);
          batch.create(db.collection('admin_audit_logs').doc(), {
            action: 'create_platform_admin', targetUid: created.uid,
            targetRole: role, actorUid: user.uid, createdAt: now
          });
          await batch.commit();
          return json(res, 201, { success: true, admin: { uid: created.uid, email, displayName, role, active: true, mfaEnrolled: false } });
        } catch (error: any) {
          if (created?.uid) await auth.deleteUser(created.uid).catch(() => undefined);
          if (error?.code === 'auth/email-already-exists') return json(res, 409, { success: false, error: 'Cette adresse e-mail possède déjà un compte Firebase.' });
          throw error;
        }
      }

      if (action === 'platform_admin_update') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const uid = String(body.uid || '').trim();
        const role = String(body.platformRole || '');
        if (!uid || uid === user.uid || !['billing', 'support', 'read_only'].includes(role)) {
          return json(res, 400, { success: false, error: 'Compte cible ou rôle invalide. Vous ne pouvez pas modifier votre propre rôle.' });
        }
        const ref = db.collection('platform_admins').doc(uid);
        const snap = await ref.get();
        if (!snap.exists || snap.data()?.active !== true) return json(res, 404, { success: false, error: 'Compte délégué actif introuvable.' });
        const tenantMembership = await db.collection('managers').doc(uid).get();
        if (tenantMembership.exists && tenantMembership.data()?.active === true) return json(res, 409, { success: false, error: 'Ce compte possède une appartenance restaurant active et ne peut pas devenir administrateur de plateforme.' });
        const auth = getAuth();
        const authUser = await auth.getUser(uid);
        if (isProtectedSuperAdminAccount(authUser)) return json(res, 403, { success: false, error: 'Le compte Super-admin principal est protégé et ne peut pas être modifié comme un compte délégué.' });
        const sessionVersion = Number(snap.data()?.sessionVersion || 0) + 1;
        await auth.setCustomUserClaims(uid, {
          ...(authUser.customClaims || {}), role: 'platform_admin',
          platformAdminRole: role, platformAdminSessionVersion: sessionVersion,
          platformAdminPermissions: PLATFORM_ADMIN_ROLE_PERMISSIONS[role as PlatformAdminRole]
        });
        await auth.revokeRefreshTokens(uid);
        const now = Date.now();
        await ref.update({ role, sessionVersion, updatedAt: now, updatedBy: user.uid });
        await db.collection('admin_audit_logs').add({
          action: 'update_platform_admin_role', targetUid: uid, targetRole: role,
          previousRole: String(snap.data()?.role || ''), newRole: role,
          outcome: 'success', actorUid: user.uid, createdAt: now
        });
        return json(res, 200, { success: true, uid, role, requiresReauthentication: true });
      }

      if (action === 'platform_admin_status') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const uid = String(body.uid || '').trim();
        const active = body.active === true;
        if (!uid || uid === user.uid) return json(res, 400, { success: false, error: 'Compte cible invalide. Vous ne pouvez pas suspendre votre propre session.' });
        const ref = db.collection('platform_admins').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 404, { success: false, error: 'Compte délégué introuvable.' });
        const auth = getAuth();
        const authUser = await auth.getUser(uid);
        if (isProtectedSuperAdminAccount(authUser)) return json(res, 403, { success: false, error: 'Le compte Super-admin principal est protégé et ne peut pas être suspendu depuis la gestion des comptes délégués.' });
        const sessionVersion = Number(snap.data()?.sessionVersion || 0) + 1;
        await auth.setCustomUserClaims(uid, {
          ...(authUser.customClaims || {}), role: 'platform_admin',
          platformAdminRole: String(snap.data()?.role || 'read_only'),
          platformAdminSessionVersion: sessionVersion,
          platformAdminPermissions: PLATFORM_ADMIN_ROLE_PERMISSIONS[String(snap.data()?.role || 'read_only') as PlatformAdminRole]
        });
        await auth.updateUser(uid, { disabled: !active });
        await auth.revokeRefreshTokens(uid);
        const now = Date.now();
        await ref.update({ active, sessionVersion, updatedAt: now, updatedBy: user.uid });
        await db.collection('admin_audit_logs').add({
          action: active ? 'reactivate_platform_admin' : 'suspend_platform_admin',
          targetUid: uid, targetRole: String(snap.data()?.role || ''),
          previousStatus: snap.data()?.active === true ? 'active' : 'suspended',
          newStatus: active ? 'active' : 'suspended',
          outcome: 'success', actorUid: user.uid, createdAt: now
        });
        return json(res, 200, { success: true, uid, active, requiresReauthentication: true });
      }

      if (action === 'platform_account_password_reset') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const uid = String(body.uid || '').trim();
        const slug = String(body.slug || '').trim();
        if (!uid || uid === user.uid) return json(res, 400, { success: false, error: 'Compte cible invalide.' });
        if (slug) {
          const [memberSnap, staffSnap] = await Promise.all([
            db.collection('managers').doc(uid).get(),
            db.collection('restaurants').doc(slug).collection('staff').doc(uid).get()
          ]);
          if (!memberSnap.exists || !staffSnap.exists || memberSnap.data()?.restaurantSlug !== slug || staffSnap.data()?.restaurantSlug !== slug) {
            return json(res, 404, { success: false, error: 'Compte restaurant introuvable ou non concordant.' });
          }
        } else {
          const adminSnap = await db.collection('platform_admins').doc(uid).get();
          if (!adminSnap.exists) return json(res, 404, { success: false, error: 'Compte administrateur délégué introuvable.' });
          const targetAuthUser = await getAuth().getUser(uid);
          if (isProtectedSuperAdminAccount(targetAuthUser)) return json(res, 403, { success: false, error: 'Le compte Super-admin principal est protégé.' });
        }
        const now = Date.now();
        await db.collection('admin_audit_logs').add({
          action: 'request_account_password_reset', targetUid: uid,
          restaurantSlug: slug || '', actorUid: user.uid, createdAt: now
        });
        return json(res, 200, { success: true, audited: true });
      }

      if (action === 'platform_owner_invite') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(body.slug || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return json(res, 400, { success: false, error: 'Restaurant invalide.' });
        const restaurantRef = db.collection('restaurants').doc(slug);
        const restaurantSnap = await restaurantRef.get();
        if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'deleted' || restaurantSnap.data()?.deletedAt) {
          return json(res, 404, { success: false, error: 'Restaurant introuvable ou supprimé.' });
        }
        const ownershipRef = restaurantRef.collection('private').doc('ownership');
        const [ownershipSnap, ownership] = await Promise.all([
          ownershipRef.get(),
          getRestaurantOwnership(db, slug, undefined, restaurantSnap.data())
        ]);
        if (String(ownership.ownerUid || ownershipSnap.data()?.ownerUid || '').trim()) {
          return json(res, 409, { success: false, error: 'Un UID propriétaire est déjà lié. Utilisez la réinitialisation ou une procédure de rapprochement contrôlée.' });
        }
        const ownerEmail = String(ownership.ownerEmail || body.email || '').trim().toLowerCase();
        const ownerName = String(ownership.ownerName || body.displayName || '').trim();
        if (!validEmail(ownerEmail) || ownerName.length < 2 || ownerName.length > 100) {
          return json(res, 400, { success: false, error: 'Les coordonnées du propriétaire doivent être complétées avant l’invitation.' });
        }
        const auth = getAuth();
        let ownerUser: any = null;
        let created = false;
        let previousClaims: Record<string, any> = {};
        let claimsUpdated = false;
        try {
          try { ownerUser = await auth.getUserByEmail(ownerEmail); }
          catch (lookupError: any) { if (lookupError?.code !== 'auth/user-not-found') throw lookupError; }
          if (ownerUser) {
            previousClaims = { ...(ownerUser.customClaims || {}) };
            if (ownerUser.disabled || previousClaims.role === 'super_admin' || previousClaims.role === 'admin' || previousClaims.role === 'platform_admin') {
              return json(res, 409, { success: false, error: 'Le compte existant est désactivé ou réservé à une autre fonction.' });
            }
            const [membership, staffLink, ownershipLink] = await Promise.all([
              db.collection('managers').doc(ownerUser.uid).get(),
              db.collectionGroup('staff').where('uid', '==', ownerUser.uid).limit(1).get(),
              db.collectionGroup('private').where('ownerUid', '==', ownerUser.uid).limit(1).get()
            ]);
            if (membership.exists || !staffLink.empty || !ownershipLink.empty ||
                (typeof previousClaims.restaurantSlug === 'string' && previousClaims.restaurantSlug.trim())) {
              return json(res, 409, { success: false, error: 'Cette identité est déjà rattachée à un restaurant. Rapprochement manuel requis.' });
            }
          } else {
            ownerUser = await auth.createUser({ email: ownerEmail, displayName: ownerName, disabled: false, emailVerified: false });
            created = true;
          }
          const sessionVersion = 1;
          await auth.setCustomUserClaims(ownerUser.uid, {
            ...previousClaims, role: 'owner', restaurantSlug: slug, sessionVersion
          });
          claimsUpdated = true;
          const now = Date.now();
          const batch = db.batch();
          batch.set(ownershipRef, {
            ownerUid: ownerUser.uid, ownerName, ownerEmail,
            updatedAt: now, ownerLinkedBy: user.uid
          }, { merge: true });
          batch.set(db.collection('managers').doc(ownerUser.uid), {
            uid: ownerUser.uid, email: ownerEmail, displayName: ownerName,
            role: 'owner', restaurantSlug: slug, permissions: PERMISSIONS,
            active: true, sessionVersion, createdAt: now, createdBy: user.uid
          });
          batch.set(restaurantRef.collection('staff').doc(ownerUser.uid), {
            uid: ownerUser.uid, email: ownerEmail, displayName: ownerName,
            role: 'owner', permissions: PERMISSIONS, active: true, sessionVersion,
            createdAt: now, createdBy: user.uid
          });
          batch.create(db.collection('admin_audit_logs').doc(), {
            action: 'invite_restaurant_owner', restaurantSlug: slug,
            targetUid: ownerUser.uid, targetEmail: ownerEmail,
            existingAccountReused: !created, actorUid: user.uid, createdAt: now
          });
          await batch.commit();
          return json(res, 201, { success: true, owner: { uid: ownerUser.uid, email: ownerEmail, displayName: ownerName, existingAccount: !created } });
        } catch (error: any) {
          if (ownerUser?.uid && claimsUpdated) await auth.setCustomUserClaims(ownerUser.uid, previousClaims).catch(() => undefined);
          if (created && ownerUser?.uid) await auth.deleteUser(ownerUser.uid).catch(() => undefined);
          throw error;
        }
      }

      if (action === 'platform_staff_status' || action === 'platform_staff_revoke_sessions') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(body.slug || '').trim();
        const uid = String(body.uid || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !uid || uid === user.uid || (action === 'platform_staff_status' && typeof body.active !== 'boolean')) {
          return json(res, 400, { success: false, error: 'Restaurant ou compte cible invalide.' });
        }
        const restaurantRef = db.collection('restaurants').doc(slug);
        const memberRef = db.collection('managers').doc(uid);
        const staffRef = restaurantRef.collection('staff').doc(uid);
        const [restaurantSnap, memberSnap, staffSnap] = await Promise.all([
          restaurantRef.get(), memberRef.get(), staffRef.get()
        ]);
        if (!restaurantSnap.exists || !memberSnap.exists || !staffSnap.exists) {
          return json(res, 404, { success: false, error: 'Compte rattaché introuvable.' });
        }
        const member = memberSnap.data() || {};
        const staff = staffSnap.data() || {};
        if (member.restaurantSlug !== slug || staff.restaurantSlug !== slug ||
            member.role !== staff.role || !['owner', 'manager', 'cashier', 'server', 'kitchen', 'staff'].includes(String(member.role))) {
          return json(res, 409, { success: false, error: 'Les liens de compte ne concordent pas. Aucune modification appliquée.' });
        }
        const auth = getAuth();
        const authUser = await auth.getUser(uid);
        const nextVersion = Math.max(Number(member.sessionVersion || 0), Number(staff.sessionVersion || 0)) + 1;
        const now = Date.now();
        const nextActive = action === 'platform_staff_status' ? body.active === true : member.active === true;
        const claims = { ...(authUser.customClaims || {}), role: String(member.role), restaurantSlug: slug, sessionVersion: nextVersion };
        await auth.setCustomUserClaims(uid, claims);
        if (action === 'platform_staff_status') await auth.updateUser(uid, { disabled: !nextActive });
        await auth.revokeRefreshTokens(uid);

        if (member.role === 'server' && !nextActive) {
          const assigned = await restaurantRef.collection('tables').where('assignedWaiter', '==', uid).get();
          for (let offset = 0; offset < assigned.docs.length; offset += 400) {
            const batch = db.batch();
            assigned.docs.slice(offset, offset + 400).forEach((doc: any) => batch.set(doc.ref, {
              assignedWaiter: null, assignedWaiterName: null,
              assignmentUpdatedAt: now, assignmentUpdatedBy: user.uid
            }, { merge: true }));
            await batch.commit();
          }
          for (const tableDoc of assigned.docs) {
            const tableNumber = String(tableDoc.data()?.tableNumber || '').trim();
            if (!tableNumber) continue;
            const orders = await restaurantRef.collection('orders').where('tableNumber', '==', tableNumber).get();
            const activeOrders = orders.docs.filter((doc: any) => ['pending', 'in_prep', 'ready'].includes(String(doc.data()?.status || '')));
            for (let offset = 0; offset < activeOrders.length; offset += 400) {
              const batch = db.batch();
              activeOrders.slice(offset, offset + 400).forEach((doc: any) => batch.update(doc.ref, {
                assignedWaiterUid: null, waiterAssignmentUpdatedAt: now, waiterAssignmentUpdatedBy: user.uid
              }));
              await batch.commit();
            }
          }
        }

        const batch = db.batch();
        const patch = {
          ...(action === 'platform_staff_status' ? { active: nextActive, status: nextActive ? 'active' : 'suspended' } : {}),
          sessionVersion: nextVersion, updatedAt: now, updatedBy: user.uid
        };
        batch.set(memberRef, patch, { merge: true });
        batch.set(staffRef, patch, { merge: true });
        batch.create(db.collection('admin_audit_logs').doc(), {
          action: action === 'platform_staff_status' ? (nextActive ? 'reactivate_restaurant_account' : 'suspend_restaurant_account') : 'revoke_restaurant_account_sessions',
          restaurantSlug: slug, targetUid: uid, targetRole: String(member.role),
          actorUid: user.uid, createdAt: now, serverAssignmentsReleased: member.role === 'server' && !nextActive
        });
        await batch.commit();
        return json(res, 200, {
          success: true, uid, active: nextActive, sessionVersion: nextVersion,
          sessionsRevoked: true, requiresReauthentication: action === 'platform_staff_revoke_sessions' || nextActive
        });
      }

      if (action === 'support_access_request') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(body.restaurantSlug || '').trim();
        const reason = String(body.reason || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || reason.length < 15 || reason.length > 1000) {
          return json(res, 400, { success: false, error: 'Restaurant ou motif de diagnostic invalide (15 à 1 000 caractères).' });
        }
        const restaurantSnap = await db.collection('restaurants').doc(slug).get();
        if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
        const pending = await db.collection('platform_support_access_requests')
          .where('restaurantSlug', '==', slug).limit(30).get();
        const activeRequest = pending.docs.find((doc: any) =>
          doc.data()?.status === 'pending' && Number(doc.data()?.requestExpiresAt || 0) > Date.now()
        );
        if (activeRequest) return json(res, 409, { success: false, error: 'Une demande de diagnostic attend déjà le consentement du propriétaire.' });
        const ref = db.collection('platform_support_access_requests').doc();
        const now = Date.now();
        const requestRecord = {
          id: ref.id, restaurantSlug: slug,
          restaurantName: String(restaurantSnap.data()?.name || slug),
          reason, requestedBy: user.uid,
          requestedByEmail: typeof user.email === 'string' ? user.email : '',
          status: 'pending', createdAt: now,
          requestExpiresAt: now + 24 * 60 * 60 * 1000,
          accessDurationMinutes: 60,
          scope: ['restaurant.profile.read', 'tables.metadata.read', 'staff.count.read'],
          excluded: ['orders', 'payments', 'cash', 'customer_personal_data']
        };
        await ref.create(requestRecord);
        await db.collection('admin_audit_logs').add({
          action: 'request_support_diagnostic_access', restaurantSlug: slug,
          supportAccessRequestId: ref.id, actorUid: user.uid, createdAt: now
        });
        return json(res, 201, { success: true, request: requestRecord });
      }

      if (action === 'support_access_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(req.query?.slug || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return json(res, 400, { success: false, error: 'Restaurant invalide.' });
        const snap = await db.collection('platform_support_access_requests').where('restaurantSlug', '==', slug).limit(30).get();
        const requests = snap.docs.map((doc: any) => doc.data()).sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return json(res, 200, { success: true, requests });
      }

      if (action === 'support_access_diagnostics') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const requestId = String(req.query?.requestId || '').trim();
        const ref = db.collection('platform_support_access_requests').doc(requestId);
        const accessSnap = await ref.get();
        const access = accessSnap.exists ? accessSnap.data() || {} : null;
        const now = Date.now();
        if (!access || access.status !== 'approved' || access.requestedBy !== user.uid ||
            Number(access.accessExpiresAt || 0) <= now) {
          return json(res, 403, { success: false, error: 'Le consentement du propriétaire est absent ou expiré.' });
        }
        const restaurantRef = db.collection('restaurants').doc(String(access.restaurantSlug));
        const [restaurantSnap, tablesSnap, staffSnap] = await Promise.all([
          restaurantRef.get(), restaurantRef.collection('tables').get(),
          restaurantRef.collection('staff').get()
        ]);
        if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
        const restaurant = restaurantSnap.data() || {};
        await db.collection('admin_audit_logs').add({
          action: 'view_support_diagnostic_data', restaurantSlug: String(access.restaurantSlug),
          supportAccessRequestId: requestId, actorUid: user.uid, createdAt: now,
          dataScope: 'profile_and_counts_only'
        });
        return json(res, 200, {
          success: true, expiresAt: Number(access.accessExpiresAt),
          diagnostics: {
            restaurant: { name: String(restaurant.name || ''), status: String(restaurant.status || 'unknown'), isOpen: restaurant.isOpen === true, createdAt: Number(restaurant.createdAt || 0) || null },
            tables: { total: tablesSnap.size, active: tablesSnap.docs.filter((doc: any) => doc.data()?.isActive === true).length },
            staff: { total: staffSnap.size, active: staffSnap.docs.filter((doc: any) => doc.data()?.active === true).length }
          }
        });
      }

      if (action === 'support_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_support_tickets').limit(100).get();
        const tickets = snap.docs.map((doc: any) => doc.data()).sort((a: any, b: any) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        return json(res, 200, { success: true, tickets });
      }

      if (action === 'support_messages') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const ticketId = String(req.query?.ticketId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(ticketId)) return json(res, 400, { success: false, error: 'Ticket invalide.' });
        const ref = db.collection('platform_support_tickets').doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 404, { success: false, error: 'Ticket introuvable.' });
        const messagesSnap = await ref.collection('messages').orderBy('createdAt', 'asc').limit(100).get();
        return json(res, 200, { success: true, messages: messagesSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) });
      }

      if (action === 'support_create') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const slug = String(body.restaurantSlug || '').trim();
        const subject = String(body.subject || '').trim();
        const message = String(body.message || '').trim();
        const priority = ['low', 'medium', 'high'].includes(String(body.priority)) ? String(body.priority) : 'medium';
        if (!slug || subject.length < 5 || subject.length > 140 || message.length < 10 || message.length > 4000) {
          return json(res, 400, { success: false, error: 'Restaurant, sujet ou message invalide.' });
        }
        const restaurantSnap = await db.collection('restaurants').doc(slug).get();
        if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
        const ticketRef = db.collection('platform_support_tickets').doc();
        const now = Date.now();
        const ticket = {
          id: ticketRef.id, restaurantSlug: slug,
          restaurantName: String(restaurantSnap.data()?.name || slug),
          subject, priority, status: 'open', source: 'admin_console',
          createdByUid: user.uid, createdByName: String(user.name || user.email || user.uid),
          createdByEmail: typeof user.email === 'string' ? user.email : '',
          createdAt: now, updatedAt: now, lastMessageAt: now, messageCount: 1
        };
        const batch = db.batch();
        batch.create(ticketRef, ticket);
        batch.create(ticketRef.collection('messages').doc(), {
          authorUid: user.uid, authorRole: 'platform_admin', body: message,
          visibility: 'public', createdAt: now
        });
        batch.create(db.collection('admin_audit_logs').doc(), {
          action: 'support_ticket_created_by_admin', restaurantSlug: slug,
          ticketId: ticketRef.id, actorUid: user.uid, createdAt: now
        });
        await batch.commit();
        return json(res, 201, { success: true, ticket });
      }

      if (action === 'support_update') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const ticketId = String(body.ticketId || '').trim();
        const status = String(body.status || '');
        const priority = String(body.priority || '');
        const reply = String(body.reply || '').trim();
        const internalNote = String(body.internalNote || '').trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(ticketId) ||
            (status && !['open', 'in_progress', 'waiting_customer', 'waiting_support', 'resolved', 'closed'].includes(status)) ||
            (priority && !['low', 'medium', 'high'].includes(priority)) ||
            reply.length > 4000 || internalNote.length > 4000) {
          return json(res, 400, { success: false, error: 'Mise à jour de ticket invalide.' });
        }
        const ref = db.collection('platform_support_tickets').doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 404, { success: false, error: 'Ticket introuvable.' });
        const now = Date.now();
        const patch: Record<string, unknown> = { updatedAt: now, updatedBy: user.uid };
        if (status) patch.status = status;
        if (priority) patch.priority = priority;
        if (reply) { patch.lastMessageAt = now; patch.messageCount = Number(snap.data()?.messageCount || 0) + 1; }
        const batch = db.batch();
        batch.update(ref, patch);
        if (reply) batch.create(ref.collection('messages').doc(), {
          authorUid: user.uid, authorRole: 'platform_admin', body: reply,
          visibility: 'public', createdAt: now
        });
        if (internalNote) batch.create(ref.collection('messages').doc(), {
          authorUid: user.uid, authorRole: 'platform_admin', body: internalNote,
          visibility: 'internal', createdAt: now
        });
        batch.create(db.collection('admin_audit_logs').doc(), {
          action: 'support_ticket_updated', restaurantSlug: String(snap.data()?.restaurantSlug || ''),
          ticketId, actorUid: user.uid, status: status || String(snap.data()?.status || ''),
          priority: priority || String(snap.data()?.priority || ''), createdAt: now,
          publicReplyAdded: Boolean(reply), internalNoteAdded: Boolean(internalNote)
        });
        await batch.commit();
        return json(res, 200, { success: true, ticketId });
      }

      if (action === 'billing_catalog_read') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_config').doc('global').get();
        const raw = snap.exists ? snap.data() || {} : {};
        const plans = Array.isArray(raw.plans) ? raw.plans.map((plan: any) => ({
          id: String(plan.id || planIdentifier(String(plan.name || ''))),
          name: String(plan.name || ''), description: String(plan.description || ''),
          active: plan.active === true, priceMonthlyFcfa: Number.isSafeInteger(plan.priceMonthlyFcfa) ? plan.priceMonthlyFcfa : 0,
          features: plan.features && typeof plan.features === 'object' ? Object.fromEntries(
            ['kitchenScreen', 'advancedReports', 'inventoryRecipes', 'loyalty', 'dishImages'].map(key => [key, plan.features[key] === true])
          ) : {}
        })) : [];
        return json(res, 200, { success: true, config: {
          currency: 'XOF', plans,
          gracePeriodDays: Number.isInteger(raw.gracePeriodDays) ? raw.gracePeriodDays : 7,
          quarterlyDiscountPercent: Number.isInteger(raw.quarterlyDiscountPercent) ? raw.quarterlyDiscountPercent : 0
        } });
      }

      if (action === 'config_read') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_config').doc('global').get();
        const config = snap.exists ? snap.data() : null;
        return json(res, 200, { success: true, config: config || {
          currency: 'XOF', gracePeriodDays: 7, quarterlyDiscountPercent: 0, maintenanceMode: false, version: 1,
          plans: [
            { name: 'Essentiel', description: 'Formule essentielle', active: true, priceMonthlyFcfa: 0, features: { kitchenScreen: true, advancedReports: false, inventoryRecipes: false, loyalty: false, dishImages: false } },
            { name: 'Pro', description: 'Formule complète', active: true, priceMonthlyFcfa: 0, features: { kitchenScreen: true, advancedReports: true, inventoryRecipes: true, loyalty: true, dishImages: true } }
          ],
          planFeatures: {
            Essentiel: { kitchenScreen: true, advancedReports: false, inventoryRecipes: false, loyalty: false, dishImages: false },
            Pro: { kitchenScreen: true, advancedReports: true, inventoryRecipes: true, loyalty: true, dishImages: true }
          },
          emailTemplates: {
            invitation: { subject: 'Bienvenue sur RestauMax', body: 'Votre compte RestauMax est prêt. Utilisez le lien sécurisé reçu par e-mail.' },
            passwordReset: { subject: 'Réinitialisation de votre mot de passe', body: 'Suivez le lien sécurisé de Firebase Authentication pour choisir un nouveau mot de passe.' },
            invoice: { subject: 'Votre facture RestauMax', body: 'Votre facture est disponible dans votre espace.' },
            overdue: { subject: 'Rappel de paiement RestauMax', body: 'Une facture reste à régulariser dans votre espace.' }
          }
        } });
      }

      if (action === 'config_update') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const input = body.config && typeof body.config === 'object' ? body.config : {};
        const gracePeriodDays = Number(input.gracePeriodDays);
        const quarterlyDiscountPercent = Number(input.quarterlyDiscountPercent ?? 0);
        if (input.currency !== 'XOF' || !Number.isInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 60 ||
            !Number.isInteger(quarterlyDiscountPercent) || quarterlyDiscountPercent < 0 || quarterlyDiscountPercent > 100 ||
            typeof input.maintenanceMode !== 'boolean') {
          return json(res, 400, { success: false, error: 'Devise, délai de grâce ou mode maintenance invalide.' });
        }
        const featureKeys = ['kitchenScreen', 'advancedReports', 'inventoryRecipes', 'loyalty', 'dishImages'];
        const legacyPlanNames = ['Essentiel', 'Pro'];
        const planInput = Array.isArray(input.plans) ? input.plans :
          legacyPlanNames.map(name => ({
            name, description: '', active: true, priceMonthlyFcfa: 0,
            features: input.planFeatures?.[name]
          }));
        if (planInput.length < 1 || planInput.length > 20) {
          return json(res, 400, { success: false, error: 'Le catalogue doit contenir entre 1 et 20 formules.' });
        }
        const planNames = new Set<string>();
        const normalizedPlans: Array<{ id: string; name: string; description: string; active: boolean; priceMonthlyFcfa: number; features: Record<string, boolean> }> = [];
        const planFeatures: Record<string, Record<string, boolean>> = {};
        for (const rawPlan of planInput) {
          const name = String(rawPlan?.name || '').trim();
          const normalizedName = name.toLocaleLowerCase('fr-FR');
          const priceMonthlyFcfa = Number(rawPlan?.priceMonthlyFcfa ?? 0);
          const features = rawPlan?.features || input.planFeatures?.[name];
          if (name.length < 2 || name.length > 50 || planNames.has(normalizedName) ||
              typeof rawPlan?.active !== 'boolean' ||
              !Number.isSafeInteger(priceMonthlyFcfa) || priceMonthlyFcfa < 0 || priceMonthlyFcfa > 1000000000 ||
              typeof rawPlan?.description !== 'string' || rawPlan.description.length > 240 ||
              !features || featureKeys.some(key => typeof features[key] !== 'boolean')) {
            return json(res, 400, { success: false, error: 'Une formule contient un nom, un tarif, un statut ou des droits invalides.' });
          }
          planNames.add(normalizedName);
          const normalizedFeatures = Object.fromEntries(featureKeys.map(key => [key, features[key]]));
          const id = String(rawPlan?.id || planIdentifier(name)).trim();
          if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id) || normalizedPlans.some(plan => plan.id === id)) {
            return json(res, 400, { success: false, error: 'Identifiant de formule invalide ou dupliqué.' });
          }
          normalizedPlans.push({
            id, name, description: rawPlan.description.trim(), active: rawPlan.active,
            priceMonthlyFcfa, features: normalizedFeatures
          });
          planFeatures[name] = normalizedFeatures;
        }
        const emailTemplates = input.emailTemplates && typeof input.emailTemplates === 'object' ? input.emailTemplates : {};
        const templateKeys = ['invitation', 'passwordReset', 'invoice', 'overdue'];
        const normalizedTemplates: Record<string, { subject: string; body: string }> = {};
        for (const key of templateKeys) {
          const template = emailTemplates[key];
          if (!template || typeof template.subject !== 'string' || typeof template.body !== 'string' ||
              template.subject.length < 3 || template.subject.length > 160 ||
              template.body.length < 10 || template.body.length > 3000) {
            return json(res, 400, { success: false, error: 'Un modèle de message contient un contenu invalide.' });
          }
          normalizedTemplates[key] = { subject: template.subject.trim(), body: template.body.trim() };
        }
        const ref = db.collection('platform_config').doc('global');
        const now = Date.now();
        const saved = {
          currency: 'XOF', gracePeriodDays, quarterlyDiscountPercent, maintenanceMode: input.maintenanceMode,
          plans: normalizedPlans, planFeatures, emailTemplates: normalizedTemplates, updatedAt: now, updatedBy: user.uid
        };
        await db.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          tx.set(ref, { ...saved, version: Number(snap.data()?.version || 0) + 1, createdAt: snap.data()?.createdAt || now });
        });
        await db.collection('admin_audit_logs').add({
          action: 'update_platform_configuration', actorUid: user.uid, createdAt: now,
          gracePeriodDays, quarterlyDiscountPercent, maintenanceMode: input.maintenanceMode, currency: 'XOF'
        });
        return json(res, 200, { success: true, config: saved });
      }

      if (action === 'promotion_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_promotions').orderBy('createdAt', 'desc').limit(100).get();
        const promotions = snap.docs.map((doc: any) => {
          const raw = doc.data() || {};
          return {
            id: doc.id, name: String(raw.name || ''), code: String(raw.code || ''),
            discountType: raw.discountType === 'fixed' ? 'fixed' : 'percentage',
            value: Number(raw.value || 0), startsAt: Number(raw.startsAt || 0),
            endsAt: Number(raw.endsAt || 0), eligiblePlans: Array.isArray(raw.eligiblePlans) ? raw.eligiblePlans : [],
            maxUses: Number(raw.maxUses || 0), usedCount: Number(raw.usedCount || 0),
            active: raw.active === true, createdAt: Number(raw.createdAt || 0)
          };
        });
        return json(res, 200, { success: true, promotions });
      }

      if (action === 'promotion_save') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const id = String(body.id || '').trim();
        const name = String(body.name || '').trim();
        const code = String(body.code || '').trim().toUpperCase();
        const discountType = String(body.discountType || '');
        const value = Number(body.value);
        const startsAt = Number(body.startsAt);
        const endsAt = Number(body.endsAt);
        const eligiblePlans = Array.isArray(body.eligiblePlans)
          ? [...new Set<string>(body.eligiblePlans.map((item: unknown) => String(item).trim()).filter(Boolean))]
          : [];
        const maxUses = Number(body.maxUses);
        if ((id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
            name.length < 3 || name.length > 80 || !/^[A-Z0-9_-]{3,24}$/.test(code) ||
            !['percentage', 'fixed'].includes(discountType) ||
            !Number.isSafeInteger(value) || value < 1 ||
            (discountType === 'percentage' ? value > 100 : value > 1000000000) ||
            !Number.isSafeInteger(startsAt) || startsAt <= 0 ||
            !Number.isSafeInteger(endsAt) || endsAt <= startsAt ||
            eligiblePlans.length < 1 || eligiblePlans.length > 20 ||
            !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 1000000 ||
            typeof body.active !== 'boolean') {
          return json(res, 400, { success: false, error: 'Paramètres de promotion invalides. Vérifiez le code, la réduction, les dates, les formules et le quota.' });
        }
        const planConfig = await db.collection('platform_config').doc('global').get();
        const knownPlans = Array.isArray(planConfig.data()?.plans) ? planConfig.data().plans.map((plan: any) => String(plan.name)) : ['Essentiel', 'Pro'];
        if (eligiblePlans.some((plan: string) => !knownPlans.includes(plan))) {
          return json(res, 400, { success: false, error: 'Une formule ciblée n’existe pas dans le catalogue.' });
        }
        const collection = db.collection('platform_promotions');
        const duplicateSnap = await collection.where('code', '==', code).limit(5).get();
        if (duplicateSnap.docs.some((doc: any) => doc.id !== id)) {
          return json(res, 409, { success: false, error: 'Ce code promotionnel existe déjà.' });
        }
        const ref = id ? collection.doc(id) : collection.doc(`promo_${code.toLowerCase()}`);
        const existing = await ref.get();
        if (id && !existing.exists) return json(res, 404, { success: false, error: 'Promotion introuvable.' });
        if (!id && existing.exists) return json(res, 409, { success: false, error: 'Ce code promotionnel existe déjà.' });
        const previous = existing.exists ? existing.data() || {} : {};
        if (body.active === true && (!id || previous.active !== true)) {
          const activePromotions = await collection.where('active', '==', true).get();
          if (activePromotions.size >= 100) return json(res, 409, { success: false, error: 'Limite de 100 promotions actives atteinte.' });
        }
        const now = Date.now();
        const saved = {
          name, code, discountType, value, startsAt, endsAt, eligiblePlans, maxUses,
          usedCount: Number(previous.usedCount || 0), active: body.active,
          createdAt: Number(previous.createdAt || now), updatedAt: now, updatedBy: user.uid
        };
        if (id) {
          await ref.set(saved);
        } else {
          try { await ref.create(saved); }
          catch (error: any) {
            if (error?.code === 6 || String(error?.code || '').includes('ALREADY_EXISTS')) {
              return json(res, 409, { success: false, error: 'Ce code promotionnel existe déjà.' });
            }
            throw error;
          }
        }
        await db.collection('admin_audit_logs').add({
          action: id ? 'update_platform_promotion' : 'create_platform_promotion',
          actorUid: user.uid, promotionId: ref.id, promotionCode: code,
          discountType, discountValue: value, eligiblePlans, active: body.active,
          outcome: 'success', createdAt: now
        });
        return json(res, 200, { success: true, promotion: { id: ref.id, ...saved } });
      }

      if (action === 'promotion_toggle') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const id = String(body.id || '').trim();
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || typeof body.active !== 'boolean') {
          return json(res, 400, { success: false, error: 'Identifiant ou statut de promotion invalide.' });
        }
        const ref = db.collection('platform_promotions').doc(id);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 404, { success: false, error: 'Promotion introuvable.' });
        const now = Date.now();
        await ref.update({ active: body.active, updatedAt: now, updatedBy: user.uid });
        await db.collection('admin_audit_logs').add({
          action: body.active ? 'activate_platform_promotion' : 'deactivate_platform_promotion',
          actorUid: user.uid, promotionId: id, promotionCode: String(snap.data()?.code || ''),
          outcome: 'success', createdAt: now
        });
        return json(res, 200, { success: true, active: body.active });
      }

      if (action === 'announcement_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('platform_announcements').limit(100).get();
        const announcements = snap.docs.map((doc: any) => doc.data()).sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        return json(res, 200, { success: true, announcements });
      }

      if (action === 'announcement_save') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const title = String(body.title || '').trim();
        const message = String(body.message || '').trim();
        const targetType = String(body.targetType || 'all');
        const planName = String(body.planName || '').trim();
        const restaurantSlugs: string[] = Array.isArray(body.restaurantSlugs) ? [...new Set<string>(body.restaurantSlugs.map((v: unknown) => String(v).trim()).filter((v: string) => Boolean(v)))] : [];
        if (title.length < 3 || title.length > 100 || message.length < 10 || message.length > 3000 ||
            !['all', 'plan', 'selected'].includes(targetType) ||
            (targetType === 'plan' && !['Essentiel', 'Pro'].includes(planName)) ||
            (targetType === 'selected' && (restaurantSlugs.length < 1 || restaurantSlugs.length > 200))) {
          return json(res, 400, { success: false, error: 'Contenu ou ciblage de l’annonce invalide.' });
        }
        if (targetType === 'selected') {
          const checks = await Promise.all(restaurantSlugs.map((slug: string) => db.collection('restaurants').doc(slug).get()));
          if (checks.some((snap: any) => !snap.exists)) return json(res, 400, { success: false, error: 'Une sélection contient un restaurant introuvable.' });
        }
        const ref = db.collection('platform_announcements').doc();
        const now = Date.now();
        const announcement = {
          id: ref.id, title, message, targetType, planName: targetType === 'plan' ? planName : '',
          restaurantSlugs: targetType === 'selected' ? restaurantSlugs : [],
          status: 'draft', scheduledAt: null, publishedAt: null,
          createdAt: now, updatedAt: now, createdBy: user.uid
        };
        await ref.create(announcement);
        await db.collection('admin_audit_logs').add({
          action: 'create_platform_announcement', announcementId: ref.id,
          actorUid: user.uid, targetType, createdAt: now
        });
        return json(res, 201, { success: true, announcement });
      }

      if (action === 'announcement_publish') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const id = String(body.id || '').trim();
        const scheduledAt = body.scheduledAt ? Date.parse(String(body.scheduledAt)) : Date.now();
        if (!id || !Number.isFinite(scheduledAt) || scheduledAt < Date.now() - 60000) {
          return json(res, 400, { success: false, error: 'Date de publication invalide.' });
        }
        const ref = db.collection('platform_announcements').doc(id);
        const snap = await ref.get();
        if (!snap.exists || ['cancelled', 'published'].includes(String(snap.data()?.status))) {
          return json(res, 409, { success: false, error: 'Annonce introuvable ou déjà traitée.' });
        }
        const now = Date.now();
        await ref.update({ status: 'published', scheduledAt, publishedAt: scheduledAt, updatedAt: now, publishedBy: user.uid });
        await db.collection('admin_audit_logs').add({
          action: 'publish_platform_announcement', announcementId: id,
          actorUid: user.uid, scheduledAt, createdAt: now
        });
        return json(res, 200, { success: true, status: scheduledAt > now ? 'scheduled' : 'published' });
      }

      if (action === 'announcement_cancel') {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const id = String(body.id || '').trim();
        if (!id) return json(res, 400, { success: false, error: 'Annonce manquante.' });
        const ref = db.collection('platform_announcements').doc(id);
        const snap = await ref.get();
        if (!snap.exists || snap.data()?.status === 'cancelled') return json(res, 404, { success: false, error: 'Annonce introuvable.' });
        const now = Date.now();
        await ref.update({ status: 'cancelled', cancelledAt: now, cancelledBy: user.uid, updatedAt: now });
        await db.collection('admin_audit_logs').add({ action: 'cancel_platform_announcement', announcementId: id, actorUid: user.uid, createdAt: now });
        return json(res, 200, { success: true });
      }

      if (action === 'health_details') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const now = Date.now();
        const services: any[] = [];
        let databaseStatus = 'operational';
        try {
          await db.collection('platform_health').doc('probe').get();
        } catch { databaseStatus = 'unavailable'; }
        let authStatus = 'operational';
        try { await getAuth().getUser(user.uid); } catch { authStatus = 'unavailable'; }
        const [billingRunSnap, backupRunSnap] = await Promise.all([
          db.collection('platform_job_runs').doc('subscription_billing').get().catch(() => null),
          db.collection('platform_job_runs').doc('backup').get().catch(() => null)
        ]);
        const billingRun = billingRunSnap?.exists ? billingRunSnap.data() || {} : null;
        const backupRun = backupRunSnap?.exists ? backupRunSnap.data() || {} : null;
        const backupLastRunAt = Number(backupRun?.lastRunAt || 0) || null;
        const backupFresh = Boolean(
          backupRun?.lastStatus === 'success' && backupLastRunAt &&
          backupLastRunAt <= now && now - backupLastRunAt <= 48 * 60 * 60 * 1000
        );
        const backupStatus = backupRun?.lastStatus === 'failed' || backupRun?.lastStatus === 'error'
          ? 'unavailable' : backupFresh ? 'operational' : backupLastRunAt ? 'degraded' : 'unknown';
        const billingLastRunAt = Number(billingRun?.lastRunAt || 0) || null;
        const billingFresh = Boolean(billingLastRunAt && billingLastRunAt <= now && now - billingLastRunAt >= 0 && now - billingLastRunAt <= 36 * 60 * 60 * 1000 && billingRun?.lastStatus === 'success');
        services.push({ id: 'auth', label: 'Authentification Firebase', status: authStatus, detail: authStatus === 'operational' ? 'Le compte administrateur courant est accessible dans Firebase Authentication.' : 'Lecture Firebase Authentication impossible.' });
        services.push({
          id: 'mfa', label: 'Protection MFA des administrateurs',
          status: process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA === 'true' ? 'unknown' : 'degraded',
          detail: process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA === 'true'
            ? 'La politique MFA est activée. Cette sonde ne vérifie pas l’enrôlement individuel de chaque administrateur.'
            : 'La politique MFA obligatoire n’est pas activée par configuration serveur.'
        });
        services.push({ id: 'email', label: 'Distribution des e-mails', status: 'unknown', detail: 'Les e-mails de réinitialisation sont gérés par Firebase Authentication. La livraison et les rebonds ne sont pas télémétrés par RestauMax.' });
        services.push({ id: 'database', label: 'Firestore', status: databaseStatus, detail: databaseStatus === 'operational' ? 'Lecture de contrôle réussie.' : 'Firestore ne répond pas.' });
        services.push({ id: 'payments', label: 'Paiements Mobile Money', status: 'unknown', detail: process.env.PAYDUNYA_LIVE_ENABLED === 'true' ? 'Production autorisée, mais aucun appel fournisseur ni paiement réel n’est lancé par cette sonde.' : 'Mode test / Production désactivée. La sonde ne déclenche aucune transaction et les identifiants restent propres à chaque restaurant.' });
        const previewDeployment = process.env.VERCEL_ENV === 'preview';
        const billingSecretConfigured = Boolean(process.env.CRON_SECRET);
        const billingStatus = billingFresh ? 'operational' : previewDeployment ? 'unknown' : billingSecretConfigured ? 'degraded' : 'unavailable';
        const billingDetail = billingFresh
          ? `Dernière exécution : ${new Date(billingLastRunAt as number).toISOString()} · ${String(billingRun?.lastStatus || 'inconnue')}`
          : previewDeployment
            ? 'Contrôle Production non exécutable depuis une Preview : Vercel déclenche les tâches Cron sur les déploiements Production uniquement. Le secret Production reste isolé.'
            : billingSecretConfigured
              ? 'Secret CRON_SECRET présent, mais aucune exécution réussie récente n’est enregistrée.'
              : 'CRON_SECRET absent sur cet environnement : tâche planifiée non activable.';
        const imageKitUploadEnabled = process.env.RESTAUMAX_IMAGEKIT_UPLOADS_ENABLED === 'true';
        let imageKitEndpointValid = false;
        try { imageKitEndpointValid = new URL(String(process.env.IMAGEKIT_URL_ENDPOINT || '')).protocol === 'https:'; } catch { imageKitEndpointValid = false; }
        const imageKitConfigured = Boolean(process.env.IMAGEKIT_PRIVATE_KEY) && imageKitEndpointValid;
        services.push({
          id: 'imagekit', label: 'Photos des plats · ImageKit',
          status: !imageKitUploadEnabled ? 'unknown' : imageKitConfigured ? 'unknown' : 'degraded',
          detail: !imageKitUploadEnabled
            ? 'Les envois ImageKit sont désactivés par le feature flag de cet environnement.'
            : imageKitConfigured
              ? 'Le feature flag, la clé serveur et le endpoint HTTPS sont présents. Aucune requête de test n’est lancée : la disponibilité du fournisseur reste non mesurée.'
              : 'Le feature flag ImageKit est activé, mais la clé privée ou le endpoint HTTPS manque. Aucun secret n’est exposé.'
        });
        services.push({ id: 'billing', label: 'Facturation planifiée', status: billingStatus, detail: billingDetail });
        services.push({
          id: 'deployment', label: 'Déploiement', status: 'unknown',
          detail: process.env.VERCEL_ENV
            ? `Métadonnées : ${process.env.VERCEL_ENV} · ${String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || 'SHA non exposé'}. Le statut Ready n’est pas vérifié par cette sonde.`
            : 'Environnement Vercel non détecté.'
        });
        services.push({
          id: 'backup', label: 'Sauvegardes', status: backupStatus,
          detail: backupLastRunAt
            ? `Dernière exécution enregistrée : ${new Date(backupLastRunAt).toISOString()} · ${backupFresh ? 'succès récent (moins de 48 h)' : backupStatus === 'unavailable' ? 'échec signalé' : 'résultat ancien ou non confirmé'}.`
            : 'Aucune télémétrie de sauvegarde connectée.'
        });
        return json(res, 200, { success: true, checkedAt: now, services });
      }

      if (action === 'billing_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const configSnap = await db.collection('platform_config').doc('global').get();
        const configuredGrace = Number(configSnap.data()?.gracePeriodDays);
        const gracePeriodDays = Number.isInteger(configuredGrace) && configuredGrace >= 0 && configuredGrace <= 60 ? configuredGrace : 7;
        const requestedLimit = Number(req.query?.limit || 100);
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
          return json(res, 400, { success: false, error: 'Taille de page de factures invalide (1 à 200).' });
        }
        let query = db.collectionGroup('invoices').orderBy('issuedAt', 'desc').limit(requestedLimit + 1);
        const cursor = String(req.query?.cursor || '').trim();
        if (cursor) {
          let parsed: any = null;
          try { parsed = JSON.parse(cursor); } catch { /* invalid cursor handled below */ }
          const slug = String(parsed?.slug || '');
          const invoiceId = String(parsed?.id || '');
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,160}$/.test(invoiceId)) {
            return json(res, 400, { success: false, error: 'Curseur de facturation invalide.' });
          }
          const cursorSnap = await db.collection('restaurantSubscriptions').doc(slug).collection('invoices').doc(invoiceId).get();
          if (!cursorSnap.exists) return json(res, 400, { success: false, error: 'Curseur de facturation expiré.' });
          query = query.startAfter(cursorSnap);
        }
        const invoiceSnap = await query.get();
        const hasMore = invoiceSnap.docs.length > requestedLimit;
        const pageDocs = hasMore ? invoiceSnap.docs.slice(0, requestedLimit) : invoiceSnap.docs;
        const invoices = pageDocs.map((invoiceDoc: any) => {
          const invoice = invoiceDoc.data() || {};
          const restaurantSlug = invoiceDoc.ref.parent.parent?.id || String(invoice.restaurantSlug || '');
          return {
            id: invoiceDoc.id, restaurantSlug,
            planName: typeof invoice.planName === 'string' ? invoice.planName : '',
            amountFcfa: Number.isSafeInteger(invoice.amountFcfa) ? invoice.amountFcfa : 0,
            baseAmountFcfa: Number.isSafeInteger(invoice.baseAmountFcfa) ? invoice.baseAmountFcfa : Number(invoice.amountFcfa || 0),
            discountPercent: Number.isInteger(invoice.discountPercent) ? invoice.discountPercent : 0,
            discountAmountFcfa: Number.isSafeInteger(invoice.discountAmountFcfa) ? invoice.discountAmountFcfa : 0,
            discountSource: typeof invoice.discountSource === 'string' ? invoice.discountSource : 'none',
            discountType: typeof invoice.discountType === 'string' ? invoice.discountType : 'none',
            discountValue: Number.isSafeInteger(invoice.discountValue) ? invoice.discountValue : 0,
            promotionCode: typeof invoice.promotionCode === 'string' ? invoice.promotionCode : null,
            promotionName: typeof invoice.promotionName === 'string' ? invoice.promotionName : null,
            currency: 'FCFA',
            status: invoice.status === 'open' && Number(invoice.dueAt || 0) > 0 && Number(invoice.dueAt) <= Date.now()
              ? 'overdue' : (['open', 'paid', 'void', 'overdue'].includes(String(invoice.status)) ? invoice.status : 'unknown'),
            issuedAt: Number.isFinite(invoice.issuedAt) ? invoice.issuedAt : null,
            dueAt: Number.isFinite(invoice.dueAt) ? invoice.dueAt : null,
            paidAt: Number.isFinite(invoice.paidAt) ? invoice.paidAt : null,
            paymentReference: typeof invoice.paymentReference === 'string' ? invoice.paymentReference.slice(0, 80) : null
          };
        });
        const lastDoc = pageDocs.length ? pageDocs[pageDocs.length - 1] : null;
        const lastSlug = lastDoc?.ref.parent.parent?.id || '';
        return json(res, 200, {
          success: true, invoices, gracePeriodDays, hasMore,
          nextCursor: hasMore && lastDoc ? JSON.stringify({ slug: lastSlug, id: lastDoc.id }) : null
        });
      }

      if (action === 'audit_list') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const requestedLimit = Number(req.query?.limit || 100);
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
          return json(res, 400, { success: false, error: 'Taille de page invalide (1 à 200 événements).' });
        }
        const cursor = String(req.query?.cursor || '').trim();
        let query = db.collection('admin_audit_logs').orderBy('createdAt', 'desc').limit(requestedLimit + 1);
        if (cursor) {
          const cursorSnap = await db.collection('admin_audit_logs').doc(cursor).get();
          if (!cursorSnap.exists) return json(res, 400, { success: false, error: 'Curseur d’audit invalide ou expiré.' });
          query = db.collection('admin_audit_logs').orderBy('createdAt', 'desc').startAfter(cursorSnap).limit(requestedLimit + 1);
        }
        const auditSnap = await query.get();
        const hasMore = auditSnap.docs.length > requestedLimit;
        const pageDocs = hasMore ? auditSnap.docs.slice(0, requestedLimit) : auditSnap.docs;
        const logs = pageDocs.map((doc: any) => {
          const raw = doc.data() || {};
          return {
            id: doc.id,
            action: typeof raw.action === 'string' ? raw.action : 'unknown',
            actorUid: typeof raw.actorUid === 'string' ? raw.actorUid : '',
            restaurantSlug: typeof raw.restaurantSlug === 'string' ? raw.restaurantSlug : '',
            targetUid: typeof raw.targetUid === 'string' ? raw.targetUid.slice(0, 128) : '',
            targetRole: typeof raw.targetRole === 'string' ? raw.targetRole.slice(0, 40) : '',
            invoiceId: typeof raw.invoiceId === 'string' ? raw.invoiceId.slice(0, 128) : '',
            amountFcfa: Number.isSafeInteger(raw.amountFcfa) ? raw.amountFcfa : null,
            planName: typeof raw.planName === 'string' ? raw.planName.slice(0, 80) : '',
            subscriptionStatus: typeof raw.subscriptionStatus === 'string' ? raw.subscriptionStatus.slice(0, 40) : '',
            previousRole: typeof raw.previousRole === 'string' ? raw.previousRole.slice(0, 40) : '',
            newRole: typeof raw.newRole === 'string' ? raw.newRole.slice(0, 40) : '',
            previousStatus: typeof raw.previousStatus === 'string' ? raw.previousStatus.slice(0, 40) : '',
            newStatus: typeof raw.newStatus === 'string' ? raw.newStatus.slice(0, 40) : '',
            previousPlanName: typeof raw.previousPlanName === 'string' ? raw.previousPlanName.slice(0, 80) : '',
            newPlanName: typeof raw.newPlanName === 'string' ? raw.newPlanName.slice(0, 80) : '',
            outcome: ['success', 'denied', 'failed'].includes(String(raw.outcome || '')) ? String(raw.outcome) : '',
            reasonCode: typeof raw.reasonCode === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(raw.reasonCode) ? raw.reasonCode : '',
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : null,
            preservedBusinessData: raw.preservedBusinessData === true || raw.businessHistoryPreserved === true
          };
        });
        return json(res, 200, {
          success: true, logs, readOnly: true, hasMore,
          nextCursor: hasMore && pageDocs.length ? pageDocs[pageDocs.length - 1].id : null
        });
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
            planId: typeof raw.planId === 'string' ? raw.planId : null,
            planFeatures: raw.planFeatures && typeof raw.planFeatures === 'object' ? raw.planFeatures : {},
            planPriceMonthlyFcfa: Number.isSafeInteger(raw.planPriceMonthlyFcfa) ? raw.planPriceMonthlyFcfa : null,
            source: subscriptionSnap.exists ? 'canonical' : (data.subscription && typeof data.subscription === 'object' ? 'legacy_unmigrated' : 'none'),
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
          if (r.subscription.billingCycle === 'quarterly') return sum + Math.round(amount / 3);
          if (r.subscription.billingCycle === 'yearly') return sum + Math.round(amount / 12);
          if (r.subscription.billingCycle === 'custom' && r.subscription.startsAt && r.subscription.endsAt) {
            const durationMonths = (r.subscription.endsAt - r.subscription.startsAt) / (30.4375 * 24 * 60 * 60 * 1000);
            if (durationMonths > 0) return sum + Math.round(amount / durationMonths);
          }
          return sum;
        }, 0);
        const canReadFinancials = ['full', 'billing'].includes(String(await getPlatformAdminRole(db, user, mfaSessionValid) || ''));
        let financialSummary: any = null;
        if (canReadFinancials) {
          const [invoiceFinancialSnap, paymentFinancialSnap] = await Promise.all([
            db.collectionGroup('invoices').get(),
            db.collectionGroup('payments').get()
          ]);
          const invoiceRows = invoiceFinancialSnap.docs
            .filter((doc: any) => doc.ref.parent.parent?.parent?.id === 'restaurantSubscriptions')
            .map((doc: any) => ({
              ...(doc.data() || {}), restaurantSlug: doc.ref.parent.parent?.id || String(doc.data()?.restaurantSlug || '')
            }));
          const openInvoices = invoiceRows.filter((invoice: any) => invoice.status === 'open' && !(Number(invoice.dueAt || 0) > 0 && Number(invoice.dueAt) <= aggregationTime));
          const overdueInvoices = invoiceRows.filter((invoice: any) => invoice.status === 'overdue' || (invoice.status === 'open' && Number(invoice.dueAt || 0) > 0 && Number(invoice.dueAt) <= aggregationTime));
          const upcomingInvoices = invoiceRows.filter((invoice: any) => invoice.status === 'open' && Number(invoice.dueAt || 0) > aggregationTime && Number(invoice.dueAt) <= aggregationTime + 30 * 24 * 60 * 60 * 1000);
          const sumInvoiceAmounts = (items: any[]) => items.reduce((total, invoice) => total + (Number.isSafeInteger(invoice.amountFcfa) ? invoice.amountFcfa : 0), 0);
          const subscriptionPaymentDocs = paymentFinancialSnap.docs.filter((doc: any) =>
            doc.ref.parent.parent?.parent?.id === 'restaurantSubscriptions'
          );
          const collectedAmountFcfa = subscriptionPaymentDocs.reduce((total: number, doc: any) => {
            const payment = doc.data() || {};
            return total + (Number.isSafeInteger(payment.amountFcfa) ? payment.amountFcfa : 0);
          }, 0);
          financialSummary = {
            openInvoicesCount: openInvoices.length, openAmountFcfa: sumInvoiceAmounts(openInvoices),
            overdueInvoicesCount: overdueInvoices.length, overdueAmountFcfa: sumInvoiceAmounts(overdueInvoices),
            collectedAmountFcfa, upcomingDueCount: upcomingInvoices.length,
            upcomingDueAmountFcfa: sumInvoiceAmounts(upcomingInvoices),
            invoicesScanned: invoiceRows.length, paymentsScanned: subscriptionPaymentDocs.length,
            asOf: aggregationTime
          };
        }
        const summary = {
          financialSummary,
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
          monthlyRecurringRevenueFcfa: canReadFinancials ? monthlyRecurringRevenueFcfa : null,
          recurringRevenueFcfa: canReadFinancials ? monthlyRecurringRevenueFcfa : null
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
        await db.collection('admin_audit_logs').add({
          action: body.status === 'suspended' ? 'suspend_restaurant' : 'reactivate_restaurant',
          restaurantSlug: slug, previousStatus: String(restaurantSnap.data()?.status || 'unknown'),
          newStatus: String(body.status), outcome: 'success', actorUid: user.uid, createdAt: now
        });
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
        if (['active', 'trial'].includes(validation.subscription.status) && validation.subscription.nextBillingAt <= now) {
          return json(res, 409, { success: false, error: 'Une formule active ou en essai doit avoir une prochaine échéance future. Aucune facturation rétroactive ne sera déclenchée sans validation explicite.' });
        }
        const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
        const currentSubscriptionSnap = await subscriptionRef.get();
        const currentSubscription = currentSubscriptionSnap.exists
          ? currentSubscriptionSnap.data() || {}
          : (restaurantSnap.data()?.subscription && typeof restaurantSnap.data()?.subscription === 'object' ? restaurantSnap.data().subscription : {});
        const platformConfigSnap = await db.collection('platform_config').doc('global').get();
        const configuredPlans = Array.isArray(platformConfigSnap.data()?.plans) ? platformConfigSnap.data().plans : [];
        if (configuredPlans.length) {
          const requestedPlanId = String(body.subscription?.planId || '').trim();
          const selectedPlan = configuredPlans.find((plan: any) => requestedPlanId
            ? String(plan?.id || planIdentifier(String(plan?.name || ''))) === requestedPlanId && String(plan?.name || '') === validation.subscription.planName
            : String(plan?.name || '') === validation.subscription.planName
          );
          const existingPlanName = String(currentSubscription.planName || '');
          if (requestedPlanId && !selectedPlan) {
            return json(res, 400, { success: false, error: 'L’identifiant de formule ne correspond pas au nom de l’offre sélectionnée.' });
          }
          if (!selectedPlan && validation.subscription.planName !== existingPlanName) {
            return json(res, 400, { success: false, error: 'Choisissez une formule existante dans le catalogue. Une formule historique peut être conservée, mais ne peut pas être réattribuée.' });
          }
          if (selectedPlan) {
            if (selectedPlan.active !== true) return json(res, 400, { success: false, error: 'Cette formule est désactivée et ne peut plus être attribuée.' });
            const monthlyPrice = Number(selectedPlan.priceMonthlyFcfa || 0);
            if (validation.subscription.billingCycle !== 'custom') {
              const multiplier = validation.subscription.billingCycle === 'quarterly' ? 3 :
                validation.subscription.billingCycle === 'yearly' ? 12 : 1;
              if (validation.subscription.priceFcfa !== monthlyPrice * multiplier) {
                return json(res, 400, { success: false, error: 'Le tarif ne correspond pas au prix mensuel configuré pour cette formule et sa périodicité.' });
              }
            }
          }
        }
        const requestedNotes = typeof body.subscription?.notes === 'string'
          ? body.subscription.notes.trim().slice(0, 500) : '';
        const preservedNotes = requestedNotes || String(currentSubscription.notes || '');
        const requestedPlanId = String(body.subscription?.planId || '').trim();
        const selectedPlan = configuredPlans.find((plan: any) => requestedPlanId
          ? String(plan?.id || planIdentifier(String(plan?.name || ''))) === requestedPlanId && String(plan?.name || '') === validation.subscription.planName
          : String(plan?.name || '') === validation.subscription.planName
        );
        const cycleMultiplier = validation.subscription.billingCycle === 'quarterly' ? 3 :
          validation.subscription.billingCycle === 'yearly' ? 12 : 1;
        const selectedPlanId = selectedPlan
          ? String(selectedPlan.id || planIdentifier(String(selectedPlan.name || '')))
          : String(currentSubscription.planId || 'legacy');
        const selectedPlanFeatures = selectedPlan && selectedPlan.features && typeof selectedPlan.features === 'object'
          ? Object.fromEntries(['kitchenScreen', 'advancedReports', 'inventoryRecipes', 'loyalty', 'dishImages'].map(key => [key, selectedPlan.features[key] === true]))
          : (currentSubscription.planFeatures && typeof currentSubscription.planFeatures === 'object' ? currentSubscription.planFeatures : {});
        const selectedMonthlyPrice = selectedPlan ? Number(selectedPlan.priceMonthlyFcfa || 0) : Number(currentSubscription.planPriceMonthlyFcfa || 0);
        const effectivePrice = selectedPlan && validation.subscription.billingCycle !== 'custom' && selectedMonthlyPrice > 0
          ? selectedMonthlyPrice * cycleMultiplier : validation.subscription.priceFcfa;
        const updatedSubscription = {
          ...validation.subscription,
          planId: selectedPlanId,
          planFeatures: selectedPlanFeatures,
          planPriceMonthlyFcfa: selectedMonthlyPrice,
          planSnapshotAt: now,
          priceFcfa: effectivePrice,
          gracePeriodOverride: body.subscription?.gracePeriodOverride === false ? false : true,
          notes: preservedNotes, updatedAt: now, updatedBy: user.uid,
          version: Number(currentSubscription.version || 0) + 1
        };
        const auditRef = db.collection('admin_audit_logs').doc();
        const historyRef = subscriptionRef.collection('history').doc();
        const batch = db.batch();
        batch.set(subscriptionRef, updatedSubscription);
        if (restaurantSnap.data()?.subscription !== undefined) batch.update(restaurantRef, { subscription: FieldValue.delete() });
        batch.create(historyRef, {
          restaurantSlug: slug, version: updatedSubscription.version,
          previous: Object.keys(currentSubscription).length ? currentSubscription : null,
          next: updatedSubscription, actorUid: user.uid, createdAt: now,
          billingAction: 'subscription_changed_no_invoice'
        });
        batch.set(auditRef, {
          action: 'update_restaurant_subscription', restaurantSlug: slug, actorUid: user.uid,
          previousPlanName: String(currentSubscription.planName || ''),
          newPlanName: validation.subscription.planName, planId: selectedPlanId,
          planName: validation.subscription.planName,
          previousStatus: String(currentSubscription.status || 'unknown'),
          newStatus: validation.subscription.status,
          priceFcfa: effectivePrice, billingCycle: validation.subscription.billingCycle,
          subscriptionStatus: validation.subscription.status,
          outcome: 'success', endsAt: validation.subscription.endsAt,
          invoiceCreated: false, billingPolicy: 'next_scheduled_cycle_only', createdAt: now
        });
        await batch.commit();
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
    if (action === 'staff_list' && ['full', 'support'].includes(String(await getPlatformAdminRole(db, user, mfaSessionValid) || ''))) {
      const canSeeFullAccountDetails = await getPlatformAdminRole(db, user, mfaSessionValid) === 'full';
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
      const accounts = await Promise.all([...byUid.values()].map(async ({ emailValues, ...account }) => {
        const email = String(account.email || '');
        const maskedEmail = email.includes('@') ? email.replace(/^(.).+(@.+)$/, '$1•••$2') : '';
        try {
          const authUser = await getAuth().getUser(account.uid);
          const authActive = authUser.disabled !== true;
          return {
            ...account, email: canSeeFullAccountDetails ? email : maskedEmail,
            active: account.activeKnown ? account.active && authActive : authActive,
            activeKnown: true, accountLinked: true, readOnly: true
          };
        } catch {
          return {
            ...account, email: canSeeFullAccountDetails ? email : maskedEmail,
            active: false, activeKnown: false, accountLinked: false, readOnly: true
          };
        }
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
    const diagnostic = {
      action: String(action || 'unknown').slice(0, 80),
      code: String(code || 'unknown').slice(0, 80),
      message: String(error?.message || 'unknown').replace(/[\\r\\n]+/g, ' ').slice(0, 500)
    };
    console.error('[RestauMax Admin]', diagnostic);
    return json(res, 500, { success: false, error: message });
  }
}
