import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

const PERMISSIONS = [
  'menu.view', 'menu.manage', 'orders.view', 'orders.manage',
  'tables.view', 'tables.manage', 'pos.access', 'kitchen.access',
  'cash.view', 'cash.manage', 'reports.view', 'staff.view', 'staff.manage',
  'settings.view', 'settings.manage'
] as const;

type Permission = typeof PERMISSIONS[number];

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

async function requireOwner(db: any, user: DecodedIdToken, slug: string) {
  if (isSuperAdmin(user)) return { role: 'super_admin', restaurant: null };
  const snap = await db.collection('restaurants').doc(slug).get();
  if (!snap.exists) return null;
  const restaurant = snap.data();
  if (restaurant.status === 'suspended') return null;
  const membership = await db.collection('managers').doc(user.uid).get();
  const member = membership.exists ? membership.data() : null;
  if (restaurant.ownerUid !== user.uid || member?.role !== 'owner' || member?.restaurantSlug !== slug) return null;
  return { role: 'owner', restaurant };
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

  try {
    // Global platform administration: allowlisted super-admin or trusted custom claim only.
    if (action === 'overview' || action === 'create_restaurant' || action === 'set_restaurant_status') {
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
        if ((await restaurantRef.get()).exists) return json(res, 409, { success: false, error: 'Ce slug de restaurant existe déjà.' });

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
            currency: 'FCFA', country: "Côte d'Ivoire"
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
          throw error;
        }
      }

      if (action === 'set_restaurant_status') {
        const slug = String(body.slug || '');
        if (!slug || !['active', 'suspended'].includes(body.status)) return json(res, 400, { success: false, error: 'Paramètres de statut invalides.' });
        await db.collection('restaurants').doc(slug).set({ status: body.status, updatedAt: Date.now(), updatedBy: user.uid }, { merge: true });
        return json(res, 200, { success: true });
      }
    }

    // Owner-only personnel management, scoped to the authenticated owner's restaurant.
    if (action === 'staff_list' || action === 'create_staff' || action === 'update_staff' || action === 'disable_staff') {
      const slug = String(req.method === 'GET' ? req.query?.slug || '' : body.slug || '');
      if (!slug) return json(res, 400, { success: false, error: 'Restaurant manquant.' });
      const owner = await requireOwner(db, user, slug);
      if (!owner || owner.role !== 'owner') return json(res, 403, { success: false, error: 'Seul le propriétaire de ce restaurant peut gérer son personnel.' });

      const staffRef = db.collection('restaurants').doc(slug).collection('staff');
      if (action === 'staff_list') {
        const snap = await staffRef.get();
        return json(res, 200, { success: true, staff: snap.docs.map((d: any) => d.data()) });
      }

      if (action === 'create_staff') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const role = body.role === 'manager' ? 'manager' : 'staff';
        const permissions = Array.isArray(body.permissions)
          ? [...new Set(body.permissions.filter((p: unknown): p is Permission => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)))]
          : [];
        if (!name || !validEmail(email) || password.length < 10 || permissions.length > PERMISSIONS.length) {
          return json(res, 400, { success: false, error: 'Nom, e-mail, mot de passe (10 caractères minimum) ou autorisations invalides.' });
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

      const staffUid = String(body.uid || '');
      if (!staffUid || staffUid === user.uid) return json(res, 400, { success: false, error: 'Compte personnel invalide.' });
      const memberRef = staffRef.doc(staffUid);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists || memberSnap.data()?.role === 'owner') return json(res, 404, { success: false, error: 'Membre introuvable.' });
      if (action === 'disable_staff') {
        await getAuth().updateUser(staffUid, { disabled: true });
        await getAuth().revokeRefreshTokens(staffUid);
        await memberRef.set({ active: false, updatedAt: Date.now() }, { merge: true });
        await db.collection('managers').doc(staffUid).set({ active: false }, { merge: true });
        return json(res, 200, { success: true });
      }
      if (action === 'update_staff') {
        const role = body.role === 'manager' ? 'manager' : 'staff';
        const permissions = Array.isArray(body.permissions)
          ? [...new Set(body.permissions.filter((p: unknown): p is Permission => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)))]
          : [];
        await getAuth().setCustomUserClaims(staffUid, { role, restaurantSlug: slug, permissions });
        await memberRef.set({ role, permissions, updatedAt: Date.now() }, { merge: true });
        await db.collection('managers').doc(staffUid).set({ role, permissions }, { merge: true });
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
