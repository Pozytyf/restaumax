/**
 * Import non destructif du catalogue RESTO Sweet and Hot dans RestauMax Démo.
 *
 * Cible imposée :
 *   Firebase project: gen-lang-client-0138815290
 *   Firestore DB: ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf
 *   Restaurant: restaurants/restaumax-demo/menuItems
 *
 * Dry-run par défaut. L'écriture exige explicitement --apply.
 * Credentials attendus dans FIREBASE_SERVICE_ACCOUNT_JSON (secret CI), jamais dans Git.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAppletFirebaseConfig,
  validateServiceAccountCredentials,
  initAdminApp,
  initAdminFirestore,
} from './firebase-admin-config.mjs';

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0138815290',
  databaseId: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
  restaurantSlug: 'restaumax-demo',
  restaurantName: 'RestauMax Démo',
});

const sizes = (entries) => entries.map(([name, price], index) => ({
  id: `format-${index + 1}`,
  name,
  extraPrice: price - entries[0][1],
  isDefault: index === 0,
}));

const item = (id, name, category, prices) => ({
  id: `sweet-hot-${id}`,
  restaurantSlug: TARGET.restaurantSlug,
  name,
  category,
  price: prices[0][1],
  description: `${name}, spécialité de la carte RESTO Sweet and Hot.`,
  imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80',
  available: true,
  prepTimeMinutes: 20,
  tags: ['Menu test', 'Sweet and Hot'],
  ...(prices.length > 1 ? {
    optionGroups: [{
      id: `formats-${id}`,
      name: 'Choisir le format',
      required: true,
      options: sizes(prices),
    }],
  } : {}),
});

export const SWEET_AND_HOT_DEMO_MENU_ITEMS = [
  // En soupe / Kédjénou (12)
  item('marmite-pecheur', 'La Marmite du Pêcheur', 'plats', [['2 à 3 personnes', 8000], ['4 à 6 personnes', 15000]]),
  item('kedjenou-pintade', 'Kédjénou de pintade', 'plats', [['Petit format', 6500], ['Grand format', 12000]]),
  item('kedjenou-lapin', 'Kédjénou de lapin', 'plats', [['Portion', 12000]]),
  item('kedjenou-poulet-africain', 'Kédjénou de poulet africain / pondeuse', 'plats', [['Petit format', 4500], ['Grand format', 8000]]),
  item('kedjenou-poulet-chair', 'Kédjénou de poulet de chair', 'plats', [['Petit format', 3500], ['Grand format', 6000]]),
  item('kedjenou-caille', 'Kédjénou de caille', 'plats', [['Portion', 6000]]),
  item('kedjenou-carpe', 'Kédjénou de carpe', 'plats', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('kedjenou-okoyo', 'Kédjénou d’Okoyo (poisson zèbre)', 'plats', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('kedjenou-saint-pierre', 'Kédjénou de Saint-Pierre', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-arrale', 'Kédjénou d’Arrale', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-machoiron', 'Kédjenou de mâchoiron', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-merou', 'Kédjenou de mérou', 'plats', [['Petit format', 15000], ['Moyen format', 20000], ['Grand format', 25000]]),

  // À la braise (9)
  item('poulet-qg', 'Poulet QG (miel & épices)', 'grillades', [['Demi-poulet', 2500], ['Poulet entier', 5000]]),
  item('caille-braisee', 'Caille braisée', 'grillades', [['Pièce', 2500]]),
  item('pintade-braisee', 'Pintade braisée', 'grillades', [['Demi-pintade', 6000], ['Pintade entière', 10000]]),
  item('cotelettes-echine-porc', 'Côtelettes / échine de porc', 'grillades', [['Portion', 6000]]),
  item('lapin-braise', 'Lapin braisé', 'grillades', [['Portion', 12000]]),
  item('carpe-braisee', 'Carpe braisée', 'grillades', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('machoiron-braise', 'Mâchoiron braisé', 'grillades', [['Petit format', 8000], ['Moyen format', 10000], ['Grand format', 15000]]),
  item('sole-braisee', 'Sole braisée', 'grillades', [['Petit format', 7000], ['Moyen format', 10000], ['Grand format', 15000]]),
  item('merou-braise', 'Mérou braisé', 'grillades', [['Petit format', 15000], ['Moyen format', 20000], ['Grand format', 25000]]),

  // Brochettes (7)
  item('brochette-gambas', 'Brochette de gambas', 'grillades', [['Brochette', 5000]]),
  item('brochette-merou', 'Brochette de mérou', 'grillades', [['Brochette', 2500]]),
  item('brochette-filet-boeuf', 'Brochette de filet de bœuf', 'grillades', [['Brochette', 1500]]),
  item('brochette-escargots', 'Brochette d’escargots', 'grillades', [['Brochette', 1500]]),
  item('brochette-gesiers', 'Brochette de gésiers', 'grillades', [['Brochette', 1500]]),
  item('brochette-ecrevisses', 'Brochette d’écrevisses', 'grillades', [['Brochette', 1500]]),
  item('brochette-langue-boeuf', 'Brochette de langue de bœuf', 'grillades', [['Brochette', 1500]]),

  // Accompagnements (1)
  item('accompagnement', 'Frites, alloco, attiéké, igname ou riz', 'accompagnements', [['Portion', 500]]),
];

export function validateTarget(config, env = process.env) {
  if (config.projectId !== TARGET.projectId || config.firestoreDatabaseId !== TARGET.databaseId) {
    throw new Error('Cible Firebase incorrecte : import annulé. Le projet et la base doivent correspondre exactement à la cible Démo autorisée.');
  }
  if (env.FIREBASE_PROJECT_ID?.trim() !== TARGET.projectId ||
      env.FIRESTORE_DATABASE_ID?.trim() !== TARGET.databaseId) {
    throw new Error('Définis explicitement FIREBASE_PROJECT_ID et FIRESTORE_DATABASE_ID sur la cible Démo avant de lancer le script.');
  }
  return true;
}

export async function seedSweetAndHotDemo(db, { apply = false } = {}) {
  if (db.databaseId !== TARGET.databaseId) throw new Error('Instance Firestore incorrecte : aucune écriture effectuée.');
  const restaurantRef = db.collection('restaurants').doc(TARGET.restaurantSlug);
  const restaurantSnap = await restaurantRef.get();
  if (!restaurantSnap.exists) throw new Error('Le restaurant cible restaumax-demo est introuvable.');
  const restaurant = restaurantSnap.data();
  if (restaurant.slug !== TARGET.restaurantSlug || restaurant.name !== TARGET.restaurantName) {
    throw new Error('Identité du restaurant cible inattendue : import annulé.');
  }

  const menuRef = restaurantRef.collection('menuItems');
  const existing = await menuRef.get();
  const ids = new Set(SWEET_AND_HOT_DEMO_MENU_ITEMS.map((entry) => entry.id));
  const collisions = existing.docs.filter((doc) => !ids.has(doc.id)).length;
  const matching = existing.docs.filter((doc) => ids.has(doc.id)).length;

  const summary = {
    projectId: TARGET.projectId,
    databaseId: TARGET.databaseId,
    restaurantSlug: TARGET.restaurantSlug,
    itemCount: SWEET_AND_HOT_DEMO_MENU_ITEMS.length,
    alreadyPresent: matching,
    unrelatedExistingItemsPreserved: collisions,
    mode: apply ? 'apply' : 'dry-run',
  };
  if (!apply) return summary;

  const batch = db.batch();
  for (const entry of SWEET_AND_HOT_DEMO_MENU_ITEMS) {
    batch.set(menuRef.doc(entry.id), entry, { merge: true });
  }
  await batch.commit();

  const verification = await menuRef.get();
  const verifiedIds = new Set(verification.docs.map((doc) => doc.id));
  const missing = SWEET_AND_HOT_DEMO_MENU_ITEMS.filter((entry) => !verifiedIds.has(entry.id));
  if (missing.length) throw new Error(`Vérification après import échouée : ${missing.length} article(s) manquant(s).`);
  return { ...summary, status: 'written-and-verified', verifiedCount: SWEET_AND_HOT_DEMO_MENU_ITEMS.length };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
    throw new Error('Seule l’option --apply est acceptée. Sans cette option, le script effectue un dry-run.');
  }
  const config = getAppletFirebaseConfig();
  validateTarget(config);
  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) throw new Error('Secret FIREBASE_SERVICE_ACCOUNT_JSON manquant.');
  const credentials = validateServiceAccountCredentials(JSON.parse(rawCredentials), TARGET.projectId);
  const app = initAdminApp(credentials, TARGET.projectId, 'sweet-hot-demo-seed');
  const db = initAdminFirestore(app, TARGET.databaseId);
  const result = await seedSweetAndHotDemo(db, { apply });
  console.log(JSON.stringify(result, null, 2));
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  main().catch((error) => {
    console.error('Import catalogue interrompu :', error.message);
    process.exitCode = 1;
  });
}
