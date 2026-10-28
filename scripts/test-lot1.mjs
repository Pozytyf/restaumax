/**
 * RESTAUMAX — Tests unitaires et d'intégration en mémoire pour le LOT 1
 *
 * Couvre :
 * - Section A : Validation stricte du compte de service (validateServiceAccountCredentials)
 * - Section B : Sécurisation de la réutilisation de Firebase Admin (initAdminApp)
 * - Section C : Validation des arguments et comportement non-destructif du seed (parseSeedArgs, seedCatalog)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { 
  validateServiceAccountCredentials, 
  initAdminApp,
  getAppletFirebaseConfig 
} from './firebase-admin-config.mjs';
import { 
  parseSeedArgs, 
  seedCatalog,
  CHEZ_AWA_RESTAURANT,
  CHEZ_AWA_MENU_ITEMS 
} from './seed-catalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Génération d'une vraie clé RSA PEM valide pour les tests de syntaxe Firebase Admin
const { privateKey: validPemKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Helper assertions
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ ÉCHEC : ${message}`);
  }
}

function assertThrows(fn, expectedSubstr, message) {
  totalTests++;
  try {
    fn();
    failedTests++;
    console.error(`  ✗ ÉCHEC (aucune exception levée) : ${message}`);
  } catch (err) {
    if (!expectedSubstr || err.message.includes(expectedSubstr)) {
      passedTests++;
      console.log(`  ✓ ${message} (erreur interceptée : "${err.message.split('\n')[0]}")`);
    } else {
      failedTests++;
      console.error(`  ✗ ÉCHEC (message inattendu) : ${message}\n    Attendu: "${expectedSubstr}"\n    Reçu: "${err.message}"`);
    }
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('RESTAUMAX — EXÉCUTION DE LA SUITE DE TESTS DU LOT 1');
  console.log('====================================================\n');

  const EXPECTED_PROJECT = 'gen-lang-client-0138815290';

  // --------------------------------------------------------------------------
  // SECTION A : validateServiceAccountCredentials
  // --------------------------------------------------------------------------
  console.log('--- TEST SECTION A : Validation stricte du compte de service ---');

  // Test A1: Credentials valides en objet
  const validCreds = {
    type: 'service_account',
    project_id: EXPECTED_PROJECT,
    private_key_id: 'test-key-id-999',
    private_key: validPemKey,
    client_email: `firebase-adminsdk@${EXPECTED_PROJECT}.iam.gserviceaccount.com`,
  };

  const resValidObj = validateServiceAccountCredentials(validCreds, EXPECTED_PROJECT);
  assert(resValidObj.project_id === EXPECTED_PROJECT, 'Accepte des identifiants valides avec le bon projectId');

  // Test A2: Normalisation avec espaces (trim)
  const resTrim = validateServiceAccountCredentials(
    { ...validCreds, project_id: `  ${EXPECTED_PROJECT}  ` },
    `  ${EXPECTED_PROJECT}  `
  );
  assert(resTrim.project_id.trim() === EXPECTED_PROJECT, 'Normalise et compare correctement après trim()');

  // Test A3: Rejet si serviceAccountInput absent
  assertThrows(
    () => validateServiceAccountCredentials(null, EXPECTED_PROJECT),
    'Identifiants de compte de service manquants',
    'Rejette un serviceAccountInput null ou non défini'
  );

  // Test A4: Rejet si fichier introuvable
  assertThrows(
    () => validateServiceAccountCredentials('/tmp/fichier-inexistant-restaumax.json', EXPECTED_PROJECT),
    'introuvable',
    'Rejette un chemin de fichier inexistant'
  );

  // Test A5: Rejet si chemin vide
  assertThrows(
    () => validateServiceAccountCredentials('   ', EXPECTED_PROJECT),
    'Le chemin des identifiants spécifié est vide',
    'Rejette un chemin composé uniquement d’espaces'
  );

  // Test A6: Fichier mal formé (JSON invalide)
  const tmpDir = os.tmpdir();
  const malformedFile = path.join(tmpDir, `test-malformed-${Date.now()}.json`);
  fs.writeFileSync(malformedFile, '{ non-valid json :::');
  try {
    assertThrows(
      () => validateServiceAccountCredentials(malformedFile, EXPECTED_PROJECT),
      "n'est pas un JSON valide",
      'Rejette un fichier JSON syntaxiquement mal formé'
    );
  } finally {
    if (fs.existsSync(malformedFile)) fs.unlinkSync(malformedFile);
  }

  // Test A7: Rejet strict si project_id absent du compte de service
  const noProjectIdCreds = {
    type: 'service_account',
    client_email: 'test@example.com',
    private_key: 'dummy-secret',
  };
  assertThrows(
    () => validateServiceAccountCredentials(noProjectIdCreds, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette formellement un compte de service sans champ 'project_id'"
  );

  // Test A8: Rejet strict si project_id vide ou composé d'espaces
  assertThrows(
    () => validateServiceAccountCredentials({ ...noProjectIdCreds, project_id: '' }, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette un project_id vide"
  );
  assertThrows(
    () => validateServiceAccountCredentials({ ...noProjectIdCreds, project_id: '   ' }, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette un project_id composé uniquement d’espaces"
  );

  // Test A9: Rejet strict si project_id incompatible avec expectedProjectId
  const mismatchedCreds = {
    ...validCreds,
    project_id: 'pirate-foreign-project-999',
  };
  assertThrows(
    () => validateServiceAccountCredentials(mismatchedCreds, EXPECTED_PROJECT),
    'Incohérence de projet critique détectée',
    'Rejette un compte de service ciblant un autre projet'
  );

  // Test A10: Rejet strict si expectedProjectId invalide ou manquant
  assertThrows(
    () => validateServiceAccountCredentials(validCreds, ''),
    "L'identifiant de projet attendu ('expectedProjectId') est manquant",
    'Rejette un expectedProjectId vide'
  );
  assertThrows(
    () => validateServiceAccountCredentials(validCreds, null),
    "L'identifiant de projet attendu ('expectedProjectId') est manquant",
    'Rejette un expectedProjectId null'
  );

  // Test A11: Absence de fuite de clé privée dans les erreurs
  let errorWithoutLeak = true;
  try {
    validateServiceAccountCredentials(
      {
        project_id: 'autre-projet',
        private_key: 'SUPER_SECRET_PRIVATE_KEY_NEVER_LOG_ME',
        private_key_id: 'SECRET_KEY_ID_123',
      },
      EXPECTED_PROJECT
    );
  } catch (err) {
    if (err.message.includes('SUPER_SECRET') || err.message.includes('SECRET_KEY_ID_123')) {
      errorWithoutLeak = false;
    }
  }
  assert(errorWithoutLeak, 'Aucune clé privée ni secret n’apparaît dans le message d’erreur');

  // Test A12: Validation avec fichier réel valide temporaire
  const validFile = path.join(tmpDir, `test-valid-creds-${Date.now()}.json`);
  fs.writeFileSync(validFile, JSON.stringify(validCreds));
  try {
    const fromFile = validateServiceAccountCredentials(validFile, EXPECTED_PROJECT);
    assert(fromFile.project_id === EXPECTED_PROJECT, 'Valide avec succès un fichier de credentials sur disque');
  } finally {
    if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
  }

  console.log('\n--- TEST SECTION B : Réutilisation sécurisée de Firebase Admin ---');

  // Test B1: Rejet si projectId manquant
  assertThrows(
    () => initAdminApp(validCreds, ''),
    "'projectId' est manquant ou vide",
    'initAdminApp rejette un projectId vide'
  );

  // Test B2: Initialisation de l'application avec nom dédié
  const testAppName = `test-app-${Date.now()}`;
  const app1 = initAdminApp(validCreds, EXPECTED_PROJECT, testAppName);
  assert(app1 && app1.name === testAppName, `Initialise avec succès l'application '${testAppName}'`);
  assert(app1.options.projectId === EXPECTED_PROJECT, 'L’application a bien le projectId configuré');

  // Test B3: Réutilisation sécurisée de la même application
  const app1Reused = initAdminApp(validCreds, EXPECTED_PROJECT, testAppName);
  assert(app1Reused === app1, 'Réutilise l’instance existante sans recréation concurrente');

  // Test B4: Détection et rejet explicite de conflit si le projectId attendu change
  assertThrows(
    () => initAdminApp(validCreds, 'autre-projet-incompatible', testAppName),
    'Conflit d\'application Firebase Admin',
    'Lève une erreur explicite en cas de conflit avec une application existante'
  );

  console.log('\n--- TEST SECTION C : Arguments et comportement non-destructif du seed ---');

  // Test C1: parseSeedArgs par défaut
  const argsDefault = parseSeedArgs([]);
  assert(argsDefault.isMerge === false, 'Sans argument : isMerge est à false');

  // Test C2: parseSeedArgs avec --merge
  const argsMerge = parseSeedArgs(['--merge']);
  assert(argsMerge.isMerge === true, 'Avec --merge : isMerge est à true');

  // Test C3: parseSeedArgs avec --force rejeté avec message explicatif
  assertThrows(
    () => parseSeedArgs(['--force']),
    "Option '--force' désactivée",
    'Rejette --force et oriente explicitement vers --merge'
  );

  // Test C4: parseSeedArgs avec argument inconnu
  assertThrows(
    () => parseSeedArgs(['--supprimer-tout']),
    'Option non reconnue',
    'Rejette tout argument inconnu avec aide d\'utilisation'
  );

  // --------------------------------------------------------------------------
  // Tests de seedCatalog sur Mock Firestore en mémoire
  // --------------------------------------------------------------------------
  console.log('\n--- TEST SECTION C (suite) : Comportement non-destructif de seedCatalog ---');

  // Création d'un mock Firestore in-memory simulant fidèlement l'API Firestore Admin
  function createMockFirestore() {
    const store = new Map(); // key: "restaurants/chez-awa" or "restaurants/chez-awa/menuItems/dish-1"

    function getDocRef(collectionName, docId) {
      const docPath = `${collectionName}/${docId}`;
      return {
        id: docId,
        path: docPath,
        async get() {
          const exists = store.has(docPath);
          return {
            exists,
            id: docId,
            data: () => (exists ? JSON.parse(JSON.stringify(store.get(docPath))) : undefined),
          };
        },
        collection(subCollectionName) {
          return {
            doc(subDocId) {
              return getDocRef(`${docPath}/${subCollectionName}`, subDocId);
            },
          };
        },
      };
    }

    return {
      databaseId: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
      _store: store,
      collection(collectionName) {
        return {
          doc(docId) {
            return getDocRef(collectionName, docId);
          },
        };
      },
      batch() {
        const operations = [];
        return {
          set(docRef, data, options = {}) {
            operations.push({ docRef, data, options });
          },
          async commit() {
            for (const op of operations) {
              if (op.options && op.options.merge && store.has(op.docRef.path)) {
                const existing = store.get(op.docRef.path);
                store.set(op.docRef.path, { ...existing, ...op.data });
              } else {
                store.set(op.docRef.path, JSON.parse(JSON.stringify(op.data)));
              }
            }
          },
        };
      },
    };
  }

  // Test C5 : Base vide -> insertion complète (status: 'seeded')
  const mockDb1 = createMockFirestore();
  const seedResult1 = await seedCatalog(mockDb1, { isMerge: false });
  assert(seedResult1.status === 'seeded', 'Base vide : seed exécuté avec succès (status: seeded)');
  assert(seedResult1.count === CHEZ_AWA_MENU_ITEMS.length, `Insère les ${CHEZ_AWA_MENU_ITEMS.length} plats du catalogue`);
  assert(mockDb1._store.has(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`), 'Le restaurant a été créé dans la base');
  assert(mockDb1._store.has(`restaurants/${CHEZ_AWA_RESTAURANT.slug}/menuItems/${CHEZ_AWA_MENU_ITEMS[0].id}`), 'Les plats ont été créés');

  // Test C6 : Restaurant déjà existant, sans --merge -> aucun écrasement (status: 'skipped')
  const mockDb2 = createMockFirestore();
  mockDb2._store.set(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`, {
    ...CHEZ_AWA_RESTAURANT,
    name: 'Version Personnalisée Chez Awa',
  });
  const seedResult2 = await seedCatalog(mockDb2, { isMerge: false });
  assert(seedResult2.status === 'skipped', 'Restaurant déjà présent sans --merge : opération ignorée (status: skipped)');
  assert(
    mockDb2._store.get(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`).name === 'Version Personnalisée Chez Awa',
    'Les données existantes n’ont pas été modifiées'
  );

  // Test C7 : Restaurant déjà existant, avec --merge -> mise à jour sans écrasement destructif
  const seedResult3 = await seedCatalog(mockDb2, { isMerge: true });
  assert(seedResult3.status === 'merged', 'Restaurant déjà présent avec --merge : mise à jour effectuée (status: merged)');

  // Test C8 : Non-destruction des documents supplémentaires existants
  // Ajoutons un plat personnalisé préexistant dans la collection du restaurant
  const mockDb4 = createMockFirestore();
  // Données initiales personnalisées
  mockDb4._store.set(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`, CHEZ_AWA_RESTAURANT);
  const customDishPath = `restaurants/${CHEZ_AWA_RESTAURANT.slug}/menuItems/dish-custom-du-chef`;
  mockDb4._store.set(customDishPath, {
    id: 'dish-custom-du-chef',
    name: 'Spécialité secrète du Chef',
    price: 25000,
  });
  // Ajoutons également un autre document dans une autre collection
  const otherDocPath = `restaurants/autre-restaurant-partenaire`;
  mockDb4._store.set(otherDocPath, { slug: 'autre-restaurant-partenaire', name: 'Autre Resto' });

  // Exécution du seed avec --merge
  await seedCatalog(mockDb4, { isMerge: true });

  assert(
    mockDb4._store.has(customDishPath),
    'Garantie non-destructive : Le plat personnalisé "dish-custom-du-chef" est TOUJOURS présent après le seed'
  );
  assert(
    mockDb4._store.get(customDishPath).price === 25000,
    'Garantie non-destructive : Les données du document personnalisé sont strictement intactes'
  );
  assert(
    mockDb4._store.has(otherDocPath),
    'Garantie non-destructive : Les documents d’autres collections sont strictement intacts'
  );

  // --------------------------------------------------------------------------
  // Bilan
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`RÉSULTATS : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erreur inattendue durant la suite de tests :', err);
  process.exit(1);
});
