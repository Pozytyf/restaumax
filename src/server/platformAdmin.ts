import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

const PERMISSIONS = [
  'menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'orders.serve',
  'orders.cancel', 'payments.refund', 'tables.view', 'tables.manage', 'pos.access',
  'kitchen.access', 'cash.view', 'cash.manage', 'reports.view', 'reports.cash.view',
  'customers.view', 'customers.manage', 'inventory.view', 'inventory.manage',
  'staff.view', 'staff.manage', 'settings.view', 'settings.manage'
] as const;

type Permission = typeof PERMISSIONS[number];
type RestaurantRole = 'owner' | 'manager' | 'cashier' | 'server' | 'kitchen';

const ROLE_PERMISSION_CEILINGS: Record<RestaurantRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'orders.serve',
    'tables.view', 'tables.manage', 'pos.access', 'kitchen.access', 'cash.view',
    'cash.manage', 'reports.view', 'customers.view', 'customers.manage',
    'inventory.view', 'inventory.manage', 'staff.view', 'staff.manage', 'settings.view'
  ],
  cashier: [
    'orders.view', 'tables.view', 'pos.access', 'cash.view', 'cash.manage',
    'orders.cancel', 'payments.refund', 'reports.cash.view'
  ],
  server: ['orders.view', 'tables.view', 'pos.access', 'orders.serve'],
  kitchen: ['orders.view', 'kitchen.access']
};

const ROLE_BASE_PERMISSIONS: Record<RestaurantRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: ROLE_PERMISSION_CEILINGS.manager,
  cashier: ['orders.view', 'tables.view', 'pos.access', 'cash.view', 'cash.manage'],
  server: ROLE_PERMISSION_CEILINGS.server,
  kitchen: ROLE_PERMISSION_CEILINGS.kitchen
};

function parseRestaurantRole(value: unknown): RestaurantRole | null {
  return ['manager', 'cashier', 'server', 'kitchen'].includes(String(value))
    ? value as RestaurantRole
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

function isSuperAdmin(user: DecodedIdToken) {
  return user.role === 'super_admin' ||
    (typeof user.email === 'string' && configuredSuperAdmins().includes(user.email.toLowerCase()));
}

export function canManageStaffMember(actorRole: 'owner' | 'manager', targetRole: string): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return ['manager', 'cashier', 'server', 'kitchen', 'staff'].includes(targetRole);
  return ['cashier', 'server', 'kitchen', 'staff'].includes(targetRole);
}

async function requireOwner(db: any, user: DecodedIdToken, slug: string) {
   const snap = await db.collection('restaurants').doc(slug).get();
  if (!snap.exists) return null;
  const restaurant = snap.data();
  if (restaurant.status !== 'active' || restaurant.deletedAt) return null;
  const membership = await db.collection('managers').doc(user.uid).get();
  const member = membership.exists ? membership.data() : null;
  if (restaurant.ownerUid !== user.uid || member?.role !== 'owner' || member?.restaurantSlug !== slug || member?.active !== true) return null;
  if (Number(user.sessionVersion || 0) !== Number(member?.sessionVersion || 0)) return null;
  return { role: 'owner', restaurant };
}

async function requireStaffAdministrator(db: any, user: DecodedIdToken, slug: string) {
  const [restaurantSnap, membershipSnap] = await Promise.all([
    db.collection('restaurants').doc(slug).get(),
    db.collection('managers').doc(user.uid).get()
  ]);
  if (!restaurantSnap.exists || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt) return null;
  if (!membershipSnap.exists) return null;
  const member = membershipSnap.data();
  if (member?.active !== true || member?.restaurantSlug !== slug ||
      Number(user.sessionVersion || 0) !== Number(member?.sessionVersion || 0)) return null;
  if (member.role === 'owner' && restaurantSnap.data()?.ownerUid === user.uid) {
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

  // Promote only explicitly allowlisted identities to a durable global custom claim.
  if (
    typeof user.email === 'string' &&
    configuredSuperAdmins().includes(user.email.toLowerCase()) &&
    user.role !== 'super_admin'
  ) {
    await getAuth().setCustomUserClaims(user.uid, { role: 'super_admin' });
  }

  const body = req.body || {};
  const action = req.method === 'GET' ? String(req.query?.action || 'overview') : String(body.action || '');

  try {
    // Global platform administration: allowlisted super-admin or trusted custom claim only.
    if (action === 'overview' || action === 'create_restaurant' || action === 'set_restaurant_status' || action === 'delete_restaurant') {
      if (!isSuperAdmin(user)) return json(res, 403, { success: false, error: 'Accès super-administrateur refusé.' });

      if (action === 'overview') {
        const snap = await db.collection('restaurants').get();
        const restaurants = snap.docs.map((d: any) => ({ slug: d.id, ...d.data() }));
        return json(res, 200, { success: true, restaurants, total: restaurants.length });
      }

      if (action === 'create_restaurant') {
        const name = String(body.name || '').trim();
        const slug = slugify(String(body.slug || name));
        const ownerName = String(body.ownerName || '').trim();
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        const ownerPassword = String(body.ownerPassword || '');
        if (!name || name.length > 200 || !slug || !ownerName || !validEmail(ownerEmail) || ownerPassword.length < 10) {
          return json(res, 400, { success: false, error: 'Renseignez le restaurant, le propriétaire, un e-mail valide et un mot de passe temporaire de 10 caractères minimum.' });
        }
        const restaurantRef = db.collection('restaurants').doc(slug);
        let reservationCreated = false;
        try {
          await restaurantRef.create({ slug, name, status: 'provisioning', createdAt: Date.now(), createdBy: user.uid });
          reservationCreated = true;
        } catch (reservationError: any) {
          if (reservationError?.code === 6 || reservationError?.code === 'already-exists') {
            return json(res, 409, { success: false, error: 'Ce slug de restaurant existe déjà.' });
          }
          throw reservationError;
        }

        const auth = getAuth();
        let ownerUser: any = null;
        try {
          ownerUser = await auth.createUser({
            email: ownerEmail, password: ownerPassword, displayName: ownerName, disabled: false
          });
          await auth.setCustomUserClaims(ownerUser.uid, { role: 'owner', restaurantSlug: slug });
          const now = Date.now();
          const batch = db.batch();
          batch.set(restaurantRef, {
            slug, name, isOpen: false, ownerUid: ownerUser.uid, ownerName, ownerEmail,
            status: 'active', createdAt: now, createdBy: user.uid,
            tagline: '', address: '', city: '', phone: '', bannerUrl: '', logoUrl: '',
            openingHours: '', currency: 'FCFA', country: "Côte d'Ivoire"
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
          await batch.commit();
          return json(res, 201, { success: true, restaurant: { slug, name }, owner: { uid: ownerUser.uid, email: ownerEmail } });
        } catch (error: any) {
          if (ownerUser?.uid) await auth.deleteUser(ownerUser.uid).catch(() => undefined);
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
            suspendedBy: user.uid,
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
            suspendedBy: null
          }),
          updatedAt: now, updatedBy: user.uid
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

      if (action === 'delete_restaurant') {
        const slug = String(body.slug || '').trim();
        const confirmation = String(body.confirmation || '');
        if (!slug || confirmation !== slug) return json(res, 400, { success: false, error: 'Confirmation du nom technique du restaurant requise.' });
        const restaurantRef = db.collection('restaurants').doc(slug);
        const restaurantSnap = await restaurantRef.get();
        if (!restaurantSnap.exists) return json(res, 404, { success: false, error: 'Restaurant introuvable.' });
        const now = Date.now();
        // Tombstone first: all authorization paths must fail before cleanup begins.
        await restaurantRef.set({ status: 'deleted', isOpen: false, tableSessionVersion: Number(restaurantSnap.data()?.tableSessionVersion || 0) + 1, deletedAt: restaurantSnap.data()?.deletedAt || now, deletedBy: user.uid, updatedAt: now, updatedBy: user.uid }, { merge: true });

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

    // Owner and authorized manager staff administration, strictly scoped to one active restaurant.
    if (action === 'staff_list' || action === 'create_staff' || action === 'update_staff' || action === 'disable_staff' || action === 'set_staff_status' || action === 'delete_staff') {
      const slug = String(req.method === 'GET' ? req.query?.slug || '' : body.slug || '');
      if (!slug) return json(res, 400, { success: false, error: 'Restaurant manquant.' });
      const actor = await requireStaffAdministrator(db, user, slug);
      if (!actor) return json(res, 403, { success: false, error: 'Gestion du personnel non autorisée pour ce restaurant.' });

      const staffRef = db.collection('restaurants').doc(slug).collection('staff');
      if (action === 'staff_list') {
        const snap = await staffRef.get();
        return json(res, 200, { success: true, actorRole: actor.role, staff: snap.docs.map((d: any) => d.data()) });
      }

      if (action === 'create_staff') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const role = parseRestaurantRole(body.role);
        if (!role) return json(res, 400, { success: false, error: 'Rôle invalide. Choisissez manager, cashier, server ou kitchen.' });
        if (actor.role === 'manager' && role === 'manager') return json(res, 403, { success: false, error: 'Un manager ne peut pas créer un autre manager.' });
        const permissions = resolveRolePermissions(role, body.permissions, actor.role === 'owner');
        if (!name || !validEmail(email) || password.length < 10 || !permissions) {
          return json(res, 400, { success: false, error: 'Nom, e-mail, mot de passe (10 caractères minimum) ou permissions hors plafond du rôle.' });
        }
        const auth = getAuth();
        let newUser: any = null;
        try {
          newUser = await auth.createUser({ email, password, displayName: name, disabled: false });
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
        if (member.role === 'owner' && restaurantSnap.data()?.ownerUid === staffUid) {
          batch.set(db.collection('restaurants').doc(slug), { ownerUid: null, ownerName: null, ownerEmail: null, ownerRemovedAt: now, ownerRemovedBy: user.uid }, { merge: true });
        }
        await batch.commit();
        await db.collection('admin_audit_logs').add({ action: 'delete_user_account', restaurantSlug: slug, targetUid: staffUid, targetRole: member.role, actorUid: user.uid, createdAt: now, businessHistoryPreserved: true });
        return json(res, 200, { success: true, deleted: true });
      }
      if (action === 'update_staff') {
        const role = parseRestaurantRole(body.role);
        if (!role) return json(res, 400, { success: false, error: 'Rôle invalide.' });
        if (actor.role === 'manager' && role === 'manager') return json(res, 403, { success: false, error: 'Un manager ne peut pas promouvoir ou administrer un autre manager.' });
        const permissions = resolveRolePermissions(role, body.permissions, actor.role === 'owner');
        if (!permissions) return json(res, 400, { success: false, error: 'Permissions incompatibles avec le plafond du rôle.' });
        const currentAuthUser = await getAuth().getUser(staffUid);
        const sessionVersion = currentSessionVersion;
        await getAuth().setCustomUserClaims(staffUid, { ...(currentAuthUser.customClaims || {}), role, restaurantSlug: slug, permissions, sessionVersion });
        await memberRef.set({ role, permissions, sessionVersion, updatedAt: Date.now() }, { merge: true });
        await db.collection('managers').doc(staffUid).set({ role, permissions, sessionVersion }, { merge: true });
        return json(res, 200, { success: true });
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
