/**
 * RESTAUMAX — Tests de sécurité des règles Firestore.
 * Ces tests utilisent le véritable émulateur et le SDK client : contrairement aux
 * tests Admin SDK, ils passent réellement par les Security Rules.
 */
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc
} from 'firebase/firestore';

const appletConfig = JSON.parse(fs.readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const firebaseConfig = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const configuredFirestore = Array.isArray(firebaseConfig.firestore)
  ? firebaseConfig.firestore.find((entry) => entry.database === appletConfig.firestoreDatabaseId)
  : firebaseConfig.firestore;

if (!configuredFirestore || configuredFirestore.database !== appletConfig.firestoreDatabaseId) {
  throw new Error('firebase.json ne cible pas la base Firestore nommée utilisée par le serveur.');
}
if (configuredFirestore.rules !== 'firestore.rules') {
  throw new Error('La base Firestore de production doit utiliser firestore.rules.');
}

const projectId = 'demo-restaumax';
const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const port = Number(rawPort || 8080);
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

let total = 0;
let passed = 0;

async function expectSucceeds(operation, label) {
  total++;
  try {
    await assertSucceeds(operation);
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}: ${error.message}`);
    throw error;
  }
}

async function expectFails(operation, label) {
  total++;
  try {
    await assertFails(operation);
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}: ${error.message}`);
    throw error;
  }
}

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host, port, rules }
});

try {
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'restaurants', 'chez-awa'), {
      slug: 'chez-awa', name: 'Chez Awa', isOpen: true
    });
    await setDoc(doc(db, 'restaurants/chez-awa/menuItems', 'dish-1'), {
      id: 'dish-1', restaurantSlug: 'chez-awa', name: 'Poulet braisé',
      category: 'grillades', price: 9500, available: true
    });
    await setDoc(doc(db, 'restaurants/chez-awa/tables', 'table-4'), {
      id: 'table-4', tableNumber: '4', capacity: 4, isActive: true
    });
    await setDoc(doc(db, 'restaurants/chez-awa/orders', 'ord_private_123'), {
      id: 'ord_private_123', orderNumber: '#CMD-123456',
      restaurantSlug: 'chez-awa', orderMode: 'sur_place',
      tableNumber: '4', items: [{ id: 'line-1', name: 'Poulet braisé', quantity: 1 }],
      totalAmount: 9500, status: 'pending'
    });
    await setDoc(doc(db, 'managers', 'manager-doc-only'), {
      uid: 'manager-doc-only', role: 'manager', restaurantSlug: 'chez-awa', restaurants: []
    });
  });

  const publicDb = env.unauthenticatedContext().firestore();
  const managerDb = env.authenticatedContext('manager-chez-awa', {
    role: 'manager', restaurantSlug: 'chez-awa'
  }).firestore();
  const otherManagerDb = env.authenticatedContext('manager-other', {
    role: 'manager', restaurantSlug: 'autre-restaurant'
  }).firestore();
  const documentManagerDb = env.authenticatedContext('manager-doc-only').firestore();
  const unrelatedUserDb = env.authenticatedContext('unrelated-user').firestore();

  console.log('\nRESTAUMAX — VALIDATION DES RÈGLES FIRESTORE');
  await expectSucceeds(
    getDoc(doc(publicDb, 'restaurants', 'chez-awa')),
    'Le menu public peut lire la fiche publique du restaurant'
  );
  await expectSucceeds(
    getDocs(collection(publicDb, 'restaurants/chez-awa/menuItems')),
    'Le menu public peut lister les plats'
  );
  await expectFails(
    getDocs(collection(publicDb, 'restaurants/chez-awa/tables')),
    'Un visiteur anonyme ne peut pas lister les tables'
  );
  await expectFails(
    getDoc(doc(publicDb, 'restaurants/chez-awa/orders', 'ord_private_123')),
    'Un visiteur anonyme ne peut pas lire une commande'
  );
  await expectSucceeds(
    getDocs(collection(managerDb, 'restaurants/chez-awa/tables')),
    'Le gestionnaire du restaurant peut lister ses tables'
  );
  await expectSucceeds(
    getDoc(doc(documentManagerDb, 'managers', 'manager-doc-only')),
    'Un gestionnaire peut lire son propre document d’habilitation'
  );
  await expectSucceeds(
    getDocs(collection(documentManagerDb, 'restaurants/chez-awa/tables')),
    'Le document d’habilitation autorise le gestionnaire sur son restaurant'
  );
  await expectFails(
    getDoc(doc(unrelatedUserDb, 'managers', 'manager-doc-only')),
    'Un utilisateur ne peut pas lire le document d’habilitation d’un autre utilisateur'
  );
  await expectFails(
    getDoc(doc(publicDb, 'managers', 'manager-doc-only')),
    'Un visiteur anonyme ne peut pas lire un document d’habilitation'
  );
  await expectFails(
    setDoc(doc(documentManagerDb, 'managers', 'manager-doc-only'), {
      uid: 'manager-doc-only', role: 'admin', restaurantSlug: 'autre-restaurant'
    }),
    'Un gestionnaire ne peut pas modifier son propre document d’habilitation'
  );
  await expectSucceeds(
    getDoc(doc(managerDb, 'restaurants/chez-awa/orders', 'ord_private_123')),
    'Le gestionnaire du restaurant peut lire une commande'
  );
  await expectFails(
    getDocs(collection(otherManagerDb, 'restaurants/chez-awa/tables')),
    'Un gestionnaire d’un autre restaurant ne peut pas lire les tables'
  );
  await expectFails(
    getDoc(doc(otherManagerDb, 'restaurants/chez-awa/orders', 'ord_private_123')),
    'Un gestionnaire d’un autre restaurant ne peut pas lire une commande'
  );
  await expectFails(
    setDoc(doc(managerDb, 'restaurants/chez-awa/menuItems', 'dish-mismatch'), {
      id: 'dish-other', restaurantSlug: 'chez-awa', name: 'Plat',
      category: 'plats', price: 1000, available: true
    }),
    'Un plat ne peut pas être écrit sous un ID différent de son champ id'
  );
  await expectFails(
    setDoc(doc(managerDb, 'restaurants/chez-awa/tables', 'table-mismatch'), {
      id: 'another-table', tableNumber: '9', capacity: 4, isActive: true
    }),
    'Une table ne peut pas être écrite sous un ID différent de son champ id'
  );

  console.log(`\nBILAN : ${passed}/${total} contrôles des règles Firestore validés.`);
  if (passed !== total) process.exitCode = 1;
} finally {
  await env.cleanup();
}
