/**
 * Provisionnement idempotent des six accès publics de démonstration RestauMax.
 * Cible immuable : restaumax-demo / (default) / restaurants/chez-awa.
 * Les identifiants sont volontairement publics et ne doivent JAMAIS être utilisés
 * dans un environnement autre que Preview. Aucun document métier n'est supprimé.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const TARGET = Object.freeze({
  projectId: 'restaumax-demo',
  databaseId: '(default)',
  restaurantSlug: 'chez-awa',
});
const DEMO_PASSWORD = 'Demo-RestauMax-2026!';
const OWNER_PERMISSIONS = [
  'menu.view','menu.manage','orders.view','orders.manage','orders.serve','orders.cancel',
  'payments.refund','tables.view','tables.manage','pos.access','kitchen.access','cash.view',
  'cash.manage','reports.view','reports.cash.view','customers.view','customers.manage',
  'inventory.view','inventory.manage','staff.view','staff.manage','settings.view','settings.manage'
];
const PROFILES = [
  { key:'super_admin', email:'superadmin@restaumax.test', displayName:'Super-administrateur Démo', role:'super_admin' },
  { key:'owner', email:'proprietaire@restaumax.test', displayName:'Propriétaire Démo', role:'owner', permissions:OWNER_PERMISSIONS },
  { key:'manager', email:'manager@restaumax.test', displayName:'Manager Démo', role:'manager', permissions:[
    'menu.view','menu.manage','orders.view','orders.manage','orders.serve','tables.view','tables.manage',
    'pos.access','kitchen.access','cash.view','cash.manage','orders.cancel','payments.refund','reports.view',
    'customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view'
  ]},
  { key:'cashier', email:'caissier@restaumax.test', displayName:'Caissier Démo', role:'cashier', permissions:[
    'orders.view','tables.view','pos.access','cash.view','cash.manage','reports.cash.view'
  ]},
  { key:'server', email:'serveur@restaumax.test', displayName:'Serveur Démo', role:'server', permissions:[
    'orders.view','tables.view','pos.access','orders.serve'
  ]},
  { key:'kitchen', email:'cuisine@restaumax.test', displayName:'Cuisine / Bar Démo', role:'kitchen', permissions:[
    'orders.view','kitchen.access'
  ]},
];

export function validatePublicDemoTarget(env = process.env, credentials = {}) {
  if (env.FIREBASE_PROJECT_ID !== TARGET.projectId || env.FIRESTORE_DATABASE_ID !== TARGET.databaseId) {
    throw new Error('Refus : seule la cible restaumax-demo / (default) est autorisée.');
  }
  if (credentials.project_id !== TARGET.projectId) {
    throw new Error('Refus : le compte de service doit appartenir à restaumax-demo.');
  }
  if (env.GITHUB_REF && env.GITHUB_REF !== 'refs/heads/feat/public-preview-demo-access') {
    throw new Error('Refus : exécution autorisée uniquement depuis la branche dédiée Preview.');
  }
}

export function getPublicDemoProfiles() {
  return PROFILES.map(({ key, email, displayName, role, permissions }) => ({
    key, email, displayName, role, permissions: permissions ? [...permissions] : []
  }));
}

export async function provisionPublicDemo({ auth, db, apply = false }) {
  if (db.databaseId !== TARGET.databaseId) throw new Error('Base Firestore hors cible Démo.');
  const restaurantRef = db.collection('restaurants').doc(TARGET.restaurantSlug);
  const restaurantSnap = await restaurantRef.get();
  if (!restaurantSnap.exists || restaurantSnap.data()?.slug !== TARGET.restaurantSlug ||
      restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt) {
    throw new Error('Chez Awa doit exister et être actif dans Preview avant de créer les accès.');
  }

  const owner = PROFILES.find(p => p.role === 'owner');
  const ownershipRef = restaurantRef.collection('private').doc('ownership');
  const ownershipSnap = await ownershipRef.get();
  const currentOwnerUid = ownershipSnap.exists ? ownershipSnap.data()?.ownerUid : restaurantSnap.data()?.ownerUid;
  let ownerExisting = null;
  try { ownerExisting = await auth.getUserByEmail(owner.email); } catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
  if (currentOwnerUid && (!ownerExisting || currentOwnerUid !== ownerExisting.uid)) {
    throw new Error('Conflit : Chez Awa est déjà rattaché à un autre propriétaire. Aucun changement effectué.');
  }

  const existing = {};
  for (const profile of PROFILES) {
    try {
      const user = await auth.getUserByEmail(profile.email);
      if (user.customClaims?.demoAccess !== true) {
        throw new Error(`Conflit : ${profile.email} existe déjà et n'est pas un compte Démo géré par ce workflow.`);
      }
      existing[profile.key] = user;
    } catch (e) {
      if (e?.code !== 'auth/user-not-found') throw e;
      existing[profile.key] = null;
    }
  }
  const summary = {
    projectId: TARGET.projectId, databaseId: TARGET.databaseId, restaurantSlug: TARGET.restaurantSlug,
    mode: apply ? 'apply' : 'dry-run', profiles: PROFILES.map(p => ({ role:p.role, email:p.email, exists:!!existing[p.key] })),
    writes: apply ? PROFILES.length + 1 : 0, destructiveDeletes: 0
  };
  if (!apply) return summary;

  const created = {};
  for (const profile of PROFILES) {
    const user = existing[profile.key] || await auth.createUser({
      email: profile.email, password: DEMO_PASSWORD, displayName: profile.displayName, emailVerified: true, disabled: false
    });
    if (existing[profile.key]) {
      await auth.updateUser(user.uid, { password: DEMO_PASSWORD, displayName: profile.displayName, emailVerified: true, disabled: false });
    }
    const claims = {
      ...(user.customClaims || {}),
      demoAccess: true,
      role: profile.role,
      sessionVersion: 1,
      ...(profile.role === 'super_admin' ? {} : {
        restaurantSlug: TARGET.restaurantSlug,
        permissions: profile.permissions
      })
    };
    await auth.setCustomUserClaims(user.uid, claims);
    created[profile.key] = { ...profile, uid:user.uid };
  }

  const batch = db.batch();
  for (const profile of PROFILES.filter(p => p.role !== 'super_admin')) {
    const user = created[profile.key];
    batch.set(db.collection('managers').doc(user.uid), {
      uid:user.uid, email:profile.email, displayName:profile.displayName, role:profile.role,
      restaurantSlug:TARGET.restaurantSlug, active:true, permissions:profile.permissions,
      sessionVersion:1, demoAccess:true, grantedAt:FieldValue.serverTimestamp()
    }, { merge:true });
  }
  const ownerUser = created.owner;
  batch.set(ownershipRef, {
    ownerUid:ownerUser.uid, ownerName:ownerUser.displayName, ownerEmail:ownerUser.email,
    demoAccess:true, updatedAt:FieldValue.serverTimestamp()
  }, { merge:true });
  await batch.commit();

  const verified = [];
  for (const profile of PROFILES) {
    const user = await auth.getUser(created[profile.key].uid);
    if (user.customClaims?.demoAccess !== true || user.customClaims?.role !== profile.role) {
      throw new Error(`Vérification Auth échouée pour ${profile.email}.`);
    }
    if (profile.role !== 'super_admin') {
      const member = await db.collection('managers').doc(user.uid).get();
      if (!member.exists || member.data()?.active !== true || member.data()?.restaurantSlug !== TARGET.restaurantSlug ||
          member.data()?.role !== profile.role) throw new Error(`Vérification membership échouée pour ${profile.email}.`);
    }
    verified.push(profile.email);
  }
  const ownershipAfter = await ownershipRef.get();
  if (ownershipAfter.data()?.ownerUid !== ownerUser.uid) throw new Error('Vérification propriétaire Chez Awa échouée.');
  return { ...summary, status:'created-and-verified', verifiedProfiles:verified, publicPassword:DEMO_PASSWORD };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Option inconnue.');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON absent de l’environnement GitHub demo.');
  const credentials = JSON.parse(raw);
  validatePublicDemoTarget(process.env, credentials);
  const appName = 'restaumax-public-demo-provisioning';
  const app = getApps().find(item => item.name === appName) ||
    initializeApp({ credential:cert(credentials), projectId:TARGET.projectId }, appName);
  const db = getFirestore(app, TARGET.databaseId);
  const result = await provisionPublicDemo({ auth:getAuth(app), db, apply });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1]?.endsWith('/provision-public-demo-safe.mjs')) {
  main().catch(error => { process.stderr.write(`Provisionnement interrompu : ${error.message}\n`); process.exitCode = 1; });
}
