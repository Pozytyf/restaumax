/**
 * Seed non destructif du restaurant Chez Awa dans Firebase Preview uniquement.
 * Cible immuable : restaumax-demo / (default).
 * Aucun document n'est supprimé. Toute collision d'identité interrompt l'import.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CHEZ_AWA_RESTAURANT, CHEZ_AWA_MENU_ITEMS } from './seed-catalog.mjs';

const TARGET = Object.freeze({
  projectId: 'restaumax-demo',
  databaseId: '(default)',
  restaurantSlug: 'chez-awa',
});

export function validateDemoSeedTarget(env = process.env, credentials = {}) {
  if (env.FIREBASE_PROJECT_ID !== TARGET.projectId ||
      env.FIRESTORE_DATABASE_ID !== TARGET.databaseId) {
    throw new Error('Import refusé : seule la cible restaumax-demo / (default) est autorisée.');
  }
  if (credentials.project_id !== TARGET.projectId) {
    throw new Error('Import refusé : le compte de service doit appartenir à restaumax-demo.');
  }
}

export async function seedChezAwaDemo(db, { apply = false } = {}) {
  if (db.databaseId !== TARGET.databaseId || db.app?.options?.projectId !== TARGET.projectId) {
    throw new Error('Import refusé : instance Firestore hors cible Démo.');
  }

  const restaurantRef = db.collection('restaurants').doc(TARGET.restaurantSlug);
  const restaurantSnap = await restaurantRef.get();
  if (restaurantSnap.exists) {
    const existing = restaurantSnap.data() || {};
    if (existing.slug !== TARGET.restaurantSlug ||
        existing.name !== CHEZ_AWA_RESTAURANT.name) {
      throw new Error('Collision : restaurants/chez-awa existe avec une identité différente. Aucune écriture effectuée.');
    }
  }

  const menuRef = restaurantRef.collection('menuItems');
  const collisions = [];
  for (const item of CHEZ_AWA_MENU_ITEMS) {
    const snap = await menuRef.doc(item.id).get();
    if (snap.exists && snap.data()?.restaurantSlug !== TARGET.restaurantSlug) collisions.push(item.id);
  }
  if (collisions.length) {
    throw new Error(`Collision de catalogue (restaurantSlug différent) : ${collisions.join(', ')}. Aucune écriture effectuée.`);
  }

  const summary = {
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    restaurant: TARGET.restaurantSlug,
    restaurantExists: restaurantSnap.exists,
    menuItems: CHEZ_AWA_MENU_ITEMS.length,
    mode: apply ? 'apply' : 'dry-run',
    destructiveDeletes: 0,
  };
  if (!apply) return summary;

  const batch = db.batch();
  batch.set(restaurantRef, {
    ...CHEZ_AWA_RESTAURANT,
    status: 'active',
    isActive: true,
  }, { merge: true });
  for (const item of CHEZ_AWA_MENU_ITEMS) {
    batch.set(menuRef.doc(item.id), item, { merge: true });
  }
  await batch.commit();

  const [restaurantAfter, menuAfter] = await Promise.all([restaurantRef.get(), menuRef.get()]);
  const expectedIds = new Set(CHEZ_AWA_MENU_ITEMS.map(item => item.id));
  const verified = menuAfter.docs.filter(doc =>
    expectedIds.has(doc.id) && doc.data()?.restaurantSlug === TARGET.restaurantSlug &&
    doc.data()?.available === true
  ).length;
  if (!restaurantAfter.exists || restaurantAfter.data()?.status !== 'active' ||
      restaurantAfter.data()?.isActive === false || verified !== CHEZ_AWA_MENU_ITEMS.length) {
    throw new Error(`Vérification après écriture incomplète : ${verified}/${CHEZ_AWA_MENU_ITEMS.length} articles valides.`);
  }
  return { ...summary, status: 'written-and-verified', verifiedMenuItems: verified };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some(arg => arg !== '--apply')) {
    throw new Error('Seule l’option --apply est acceptée.');
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON absent de l’environnement GitHub demo.');
  const credentials = JSON.parse(raw);
  validateDemoSeedTarget(process.env, credentials);
  const app = initializeApp({ credential: cert(credentials), projectId: TARGET.projectId }, 'chez-awa-preview-seed');
  const db = getFirestore(app, TARGET.databaseId);
  const result = await seedChezAwaDemo(db, { apply });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1]?.endsWith('/seed-chez-awa-demo.mjs')) {
  main().catch(error => {
    process.stderr.write(`Seed Chez Awa interrompu : ${error.message}\n`);
    process.exitCode = 1;
  });
}
