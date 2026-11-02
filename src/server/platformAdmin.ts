import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

const PERMISSIONS = [
  'menu.view', 'menu.manage', 'orders.view', 'orders.manage',
  'tables.view', 'tables.manage', 'pos.access', 'kitchen.access',
  'cash.view', 'cash.manage', 'reports.view', 'customers.view', 'customers.manage', 'inventory.view', 'inventory.manage', 'staff.view', 'staff.manage',
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
    (user.email_verified === true && typeof user.email === 'string' && configuredSuperAdmins().includes(user.email.toLowerCase()));
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

  // Promote only explicitly allowlisted identities to a durable global custom claim.
  if (
    user.email_verified === true &&
    typeof user.email === 'string' &&
    configuredSuperAdmins().includes(user.email.toLowerCase()) &&
    user.role !== 'super_admin'
  ) {
    await getAuth().setCustomUserClaims(user.uid, { role: 'super_admin' });
  }

  const body = req.body || {};
  const action = req.method === 'GET' ? String(req.query?.action || 'overview') : String(body.action || '');

  try {
    // Public registration is authenticated with Firebase Auth, but grants no privileges.
    if (action === 'register_restaurant_request') {
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const ownerName = String(body.ownerName || '').trim();
      const restaurantName = String(body.restaurantName || '').trim();
      const city = String(body.city || '').trim();
      const phone = String(body.phone || '').trim();
      const email = String(user.email || '').trim().toLowerCase();
      if (!user.email_verified || !validEmail(email)) {
        return json(res, 403, { success: false, error: 'Veuillez confirmer votre adresse e-mail avant de soumettre votre demande.' });
      }
      if (!ownerName || ownerName.length > 160 || !restaurantName || restaurantName.length > 200 ||
          !city || city.length > 120 || !phone || phone.length > 40) {
        return json(res, 400, { success: false, error: 'Veuillez renseigner tous les champs avec des valeurs valides.' });
      }
      const existingMembership = await db.collection('managers').doc(user.uid).get();
      if (existingMembership.exists) {
        return json(res, 409, { success: false, error: 'Ce compte possède déjà un accès de gestion.' });
      }
      const requestRef = db.collection('registrationRequests').doc(user.uid);
      const existingRequest = await requestRef.get();
      if (existingRequest.exists) {
        const status = existingRequest.data()?.status;
        return json(res, 409, { success: false, error: status === 'rejected'
          ? 'Cette demande a été refusée. Contactez RestauMax pour obtenir de l’aide.'
          : 'Une demande existe déjà pour ce compte.' });
      }
      const now = Date.now();
      await requestRef.create({
        uid: user.uid, email, ownerName, restaurantName, city, phone,
        status: 'pending', createdAt: now, updatedAt: now
      });
      return json(res, 201, { success: true, status: 'pending' });
    }

    // Registration requests are visible and actionable only to a super-administrator.
    if (action === 'registration_requests' || action === 'approve_registration' || action === 'reject_registration') {
      if (!isSuperAdmin(user)) return json(res, 403, { success: false, error: 'Accès super-administrateur refusé.' });
      if (action === 'registration_requests') {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
        const snap = await db.collection('registrationRequests').where('status', '==', 'pending').limit(100).get();
        const requests = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
        return json(res, 200, { success: true, requests });
      }
      if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Méthode non autorisée.' });
      const requestUid = String(body.uid || '');
      if (!requestUid || requestUid.length > 128) return json(res, 400, { success: false, error: 'Demande invalide.' });
      const requestRef = db.collection('registrationRequests').doc(requestUid);
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists || requestSnap.data()?.status !== 'pending') {
        return json(res, 404, { success: false, error: 'Demande en attente introuvable.' });
      }
      const registration = requestSnap.data();
      if (action === 'reject_registration') {
        await requestRef.set({ status: 'rejected', reviewedAt: Date.now(), reviewedBy: user.uid }, { merge: true });
        return json(res, 200, { success: true });
      }
      const applicant = await getAuth().getUser(requestUid);
      if (!applicant.emailVerified || applicant.disabled || applicant.email?.toLowerCase() !== String(registration.email).toLowerCase()) {
        return json(res, 409, { success: false, error: 'Le compte doit être actif et son adresse e-mail vérifiée avant approbation.' });
      }
      const existingMembership = await db.collection('managers').doc(requestUid).get();
      if (existingMembership.exists) return json(res, 409, { success: false, error: 'Ce compte possède déjà un rôle de gestion.' });
      const slug = slugify(registration.restaurantName);
      if (!slug) return json(res, 400, { success: false, error: 'Nom de restaurant invalide.' });
      const restaurantRef = db.collection('restaurants').doc(slug);
      try {
        await restaurantRef.create({
          slug, name: registration.restaurantName, isOpen: false, status: 'active',
          ownerUid: requestUid, ownerName: registration.ownerName, ownerEmail: registration.email,
          city: registration.city, phone: registration.phone, createdAt: Date.now(), createdBy: user.uid,
          tagline: '', address: '', bannerUrl: '', logoUrl: '', openingHours: '',
          currency: 'FCFA', country: "Côte d'Ivoire"
        });
      } catch (error: any) {
        if (error?.code === 6 || error?.code === 'already-exists') {
          return json(res, 409, { success: false, error: 'Un restaurant utilise déjà ce nom. Demandez au restaurateur de choisir un autre nom.' });
        }
        throw error;
      }
      try {
        const now = Date.now();
        const permissions = [...PERMISSIONS];
        await getAuth().setCustomUserClaims(requestUid, { role: 'owner', restaurantSlug: slug });
        const batch = db.batch();
        batch.set(db.collection('managers').doc(requestUid), {
          uid: requestUid, email: registration.email, displayName: registration.ownerName,
          role: 'owner', restaurantSlug: slug, permissions, active: true, createdAt: now, createdBy: user.uid
        });
        batch.set(restaurantRef.collection('staff').doc(requestUid), {
          uid: requestUid, email: registration.email, displayName: registration.ownerName,
          role: 'owner', permissions, active: true, createdAt: now
        });
        batch.set(requestRef, { status: 'approved', restaurantSlug: slug, reviewedAt: now, reviewedBy: user.uid }, { merge: true });
        await batch.commit();
      } catch (error) {
        await restaurantRef.delete().catch(() => undefined);
        await getAuth().setCustomUserClaims(requestUid, {}).catch(() => undefined);
        throw error;
      }
      return json(res, 200, { success: true, restaurant: { slug, name: registration.restaurantName } });
    }
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
        const slug = String(body.slug || '');
        if (!slug || !['active', 'suspended'].includes(body.status)) return json(res, 400, { success: false, error: 'Paramètres de statut invalides.' });
        await db.collection('restaurants').doc(slug).set({ status: body.status, ...(body.status === 'suspended' ? { isOpen: false } : {}), updatedAt: Date.now(), updatedBy: user.uid }, { merge: true });
        return json(res, 200, { success: true });
      }
    }

    // Owner-only personnel management, scoped to the authenticated owner's restaurant.
    if (action === 'staff_list' || action === 'create_staff' || action === 'update_staff' || action === 'disable_staff') {
      const slug = String(req.method === 'GET' ? req.query?.slug || '' : body.slug || '');
      if (!slug) return json(res, 400, { success: false, error: 'Restaurant manquant.' });
      const owner = await requireOwner(db, user, slug);
      if (!owner || (owner.role !== 'owner' && owner.role !== 'super_admin')) return json(res, 403, { success: false, error: 'Accès propriétaire ou super-administrateur requis.' });

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
        // Every restaurant manager must be able to manage tables and generate QR codes.
        if (role === 'manager' && !permissions.includes('tables.manage')) {
          permissions.push('tables.manage');
        }
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
        // Every restaurant manager must be able to manage tables and generate QR codes.
        if (role === 'manager' && !permissions.includes('tables.manage')) {
          permissions.push('tables.manage');
        }
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
