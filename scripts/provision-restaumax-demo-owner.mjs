/**
 * Provisionne le compte propriétaire déjà existant dans RestauMax Démo.
 * Cible immuable : restaumax-demo / (default) / restaurants/restaumax-demo.
 * Dry-run par défaut ; --apply exige une confirmation explicite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from 'firebase-admin/auth';
import {
  getAppletFirebaseConfig,
  initAdminApp,
  initAdminFirestore,
} from './firebase-admin-config.mjs';

const TARGET = Object.freeze({
  projectId: 'restaumax-demo',
  databaseId: '(default)',
  slug: 'restaumax-demo',
  restaurantName: 'RestauMax Démo',
  ownerUid: 'DCL1JQ9KJydgkdDkEBVl5DKoLms1',
  ownerEmail: 'restaumax@hp-logistics.net',
  confirmation: 'PROVISION_RESTAUMAX_DEMO_OWNER',
});

const OWNER_PERMISSIONS = [
  'menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'orders.serve',
  'orders.cancel', 'payments.refund', 'tables.view', 'tables.manage', 'pos.access',
  'kitchen.access', 'cash.view', 'cash.manage', 'reports.view', 'reports.cash.view',
  'customers.view', 'customers.manage', 'inventory.view', 'inventory.manage',
  'staff.view', 'staff.manage', 'settings.view', 'settings.manage',
];

export function validateProvisionTarget(config, env = process.env) {
  if (config.projectId !== TARGET.projectId || config.firestoreDatabaseId !== TARGET.databaseId ||
      env.FIREBASE_PROJECT_ID?.trim() !== TARGET.projectId ||
      env.FIRESTORE_DATABASE_ID?.trim() !== TARGET.databaseId) {
    throw new Error('Cible Firebase incorrecte : seule la base restaumax-demo/(default) est autorisée.');
  }
  return true;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function provisionExistingDemoOwner({ auth, db, apply = false, confirmation = '' }) {
  assert(db.databaseId === TARGET.databaseId, 'Base Firestore inattendue : opération annulée.');
  const owner = await auth.getUser(TARGET.ownerUid);
  assert(owner.uid === TARGET.ownerUid, 'UID propriétaire inattendu.');
  assert(String(owner.email || '').toLowerCase() === TARGET.ownerEmail, 'Adresse e-mail propriétaire inattendue.');
  assert(owner.disabled !== true, 'Le compte propriétaire Firebase est désactivé.');

  const claims = owner.customClaims || {};
  assert(!['admin', 'super_admin'].includes(String(claims.role || '')),
    'Un compte administrateur plateforme ne peut pas devenir propriétaire.');
  assert(!(typeof claims.restaurantSlug === 'string' && claims.restaurantSlug.trim()),
    'Le compte propriétaire possède déjà une affectation restaurant.');

  const restaurantRef = db.collection('restaurants').doc(TARGET.slug);
  const [restaurantSnap, membershipSnap, staffSnap, ownershipSnap, legacyStaffSnap] = await Promise.all([
    restaurantRef.get(),
    db.collection('managers').doc(TARGET.ownerUid).get(),
    restaurantRef.collection('staff').doc(TARGET.ownerUid).get(),
    restaurantRef.collection('private').doc('ownership').get(),
    db.collectionGroup('staff').where('uid', '==', TARGET.ownerUid).limit(1).get(),
  ]);

  if (restaurantSnap.exists && membershipSnap.exists && staffSnap.exists && ownershipSnap.exists) {
    const restaurant = restaurantSnap.data() || {};
    const membership = membershipSnap.data() || {};
    const staff = staffSnap.data() || {};
    const ownership = ownershipSnap.data() || {};
    const alreadyCorrect =
      restaurant.slug === TARGET.slug && restaurant.name === TARGET.restaurantName && restaurant.status === 'active' &&
      ownership.ownerUid === TARGET.ownerUid && ownership.ownerEmail === TARGET.ownerEmail &&
      membership.uid === TARGET.ownerUid && membership.role === 'owner' &&
      membership.restaurantSlug === TARGET.slug && membership.active === true &&
      staff.uid === TARGET.ownerUid && staff.role === 'owner' && staff.active === true &&
      claims.role === 'owner' && claims.restaurantSlug === TARGET.slug;
    assert(alreadyCorrect, 'Provisionnement partiel ou incohérent détecté : intervention manuelle requise, aucune écriture effectuée.');
    return { mode: apply ? 'apply' : 'dry-run', status: 'already-provisioned-and-verified', projectId: TARGET.projectId, databaseId: TARGET.databaseId, restaurantSlug: TARGET.slug, ownerUid: TARGET.ownerUid };
  }

  assert(!restaurantSnap.exists, 'Le slug restaurants/restaumax-demo existe déjà : aucune donnée ne sera écrasée.');
  assert(!membershipSnap.exists && !staffSnap.exists && !ownershipSnap.exists && legacyStaffSnap.empty,
    'Une affectation propriétaire ou staff existe déjà : rattachement automatique refusé.');

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    restaurantPath: `restaurants/${TARGET.slug}`,
    ownerUid: TARGET.ownerUid,
    ownerEmail: TARGET.ownerEmail,
    action: 'create-restaurant-and-bind-existing-auth-user',
  };
  if (!apply) return { ...summary, status: 'preflight-passed-no-writes' };
  assert(confirmation === TARGET.confirmation, 'Confirmation explicite de provisionnement absente ou incorrecte.');

  const now = Date.now();
  const ownerName = String(owner.displayName || 'Propriétaire RestauMax Démo').trim();
  let reservationCreated = false;
  let claimsChanged = false;
  try {
    await restaurantRef.create({
      slug: TARGET.slug,
      name: TARGET.restaurantName,
      status: 'provisioning',
      createdAt: now,
    });
    reservationCreated = true;

    await auth.setCustomUserClaims(TARGET.ownerUid, {
      ...claims,
      role: 'owner',
      restaurantSlug: TARGET.slug,
    });
    claimsChanged = true;

    const batch = db.batch();
    batch.set(restaurantRef, {
      slug: TARGET.slug,
      name: TARGET.restaurantName,
      isOpen: false,
      status: 'active',
      createdAt: now,
      tagline: '',
      address: '',
      city: '',
      phone: '',
      bannerUrl: '',
      logoUrl: '',
      openingHours: '',
      currency: 'FCFA',
      country: "Côte d'Ivoire",
    });
    batch.set(restaurantRef.collection('private').doc('ownership'), {
      ownerUid: TARGET.ownerUid,
      ownerName,
      ownerEmail: TARGET.ownerEmail,
      createdBy: 'github-demo-provisioning-workflow',
      createdAt: now,
    });
    batch.set(db.collection('managers').doc(TARGET.ownerUid), {
      uid: TARGET.ownerUid,
      email: TARGET.ownerEmail,
      displayName: ownerName,
      role: 'owner',
      restaurantSlug: TARGET.slug,
      permissions: OWNER_PERMISSIONS,
      active: true,
      createdAt: now,
      createdBy: 'github-demo-provisioning-workflow',
    });
    batch.set(restaurantRef.collection('staff').doc(TARGET.ownerUid), {
      uid: TARGET.ownerUid,
      email: TARGET.ownerEmail,
      displayName: ownerName,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
      active: true,
      createdAt: now,
    });
    batch.set(db.collection('admin_audit_logs').doc(), {
      action: 'create_restaurant',
      restaurantSlug: TARGET.slug,
      ownerUid: TARGET.ownerUid,
      ownerEmail: TARGET.ownerEmail,
      ownerAccountReused: true,
      actorUid: 'github-demo-provisioning-workflow',
      createdAt: now,
    });
    await batch.commit();

    const [finalRestaurant, finalOwnership, finalMembership, finalStaff, finalOwner] = await Promise.all([
      restaurantRef.get(),
      restaurantRef.collection('private').doc('ownership').get(),
      db.collection('managers').doc(TARGET.ownerUid).get(),
      restaurantRef.collection('staff').doc(TARGET.ownerUid).get(),
      auth.getUser(TARGET.ownerUid),
    ]);
    assert(finalRestaurant.exists && finalRestaurant.data()?.status === 'active', 'Vérification finale restaurant échouée.');
    assert(finalOwnership.data()?.ownerUid === TARGET.ownerUid, 'Vérification finale ownership échouée.');
    assert(finalMembership.data()?.role === 'owner' && finalMembership.data()?.active === true, 'Vérification finale manager échouée.');
    assert(finalStaff.data()?.role === 'owner' && finalStaff.data()?.active === true, 'Vérification finale staff échouée.');
    assert(finalOwner.customClaims?.role === 'owner' && finalOwner.customClaims?.restaurantSlug === TARGET.slug, 'Vérification finale des custom claims échouée.');

    return { ...summary, status: 'created-and-verified', ownerName, verified: ['restaurant', 'private-ownership', 'manager-membership', 'staff-profile', 'firebase-custom-claims'] };
  } catch (error) {
    if (claimsChanged) await auth.setCustomUserClaims(TARGET.ownerUid, claims).catch(() => undefined);
    if (reservationCreated) await restaurantRef.delete().catch(() => undefined);
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
    throw new Error('Seule l’option --apply est acceptée. Sans cette option, le script effectue un dry-run.');
  }
  const config = getAppletFirebaseConfig();
  validateProvisionTarget(config);
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Authentification Google absente : GitHub OIDC/ADC est obligatoire.');
  }
  const app = initAdminApp(null, TARGET.projectId, 'restaumax-demo-owner-provisioning');
  const auth = getAuth(app);
  const db = initAdminFirestore(app, TARGET.databaseId);
  const result = await provisionExistingDemoOwner({
    auth,
    db,
    apply,
    confirmation: process.env.PROVISION_CONFIRMATION || '',
  });
  console.log(JSON.stringify(result, null, 2));
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  main().catch((error) => {
    console.error('Provisionnement Démo interrompu :', error.message);
    process.exitCode = 1;
  });
}
