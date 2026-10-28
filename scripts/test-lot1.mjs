/**
 * RESTAUMAX — Tests unitaires et d'intégration en mémoire pour le LOT 1
 *
 * Ce fichier teste rigoureusement les trois volets de durcissement :
 * - Section 1 : Configuration et intégrité de l'environnement (getAppletFirebaseConfig)
 * - Section 2 : Validation stricte des identifiants (validateServiceAccountCredentials)
 * - Section 3 : Cycle de vie et réutilisation sécurisée de Firebase Admin (initAdminApp & initAdminFirestore)
 * - Section 4 : Analyse des arguments du seed CLI (parseSeedArgs)
 * - Section 5 : Comportement non-destructif du seed du catalogue (seedCatalog sur mock Firestore)
 *
 * GARANTIES DE SÉCURITÉ DU TESTEUR :
 * - Aucune clé privée réelle de service n'est utilisée (génération locale d'une clé RSA temporaire en mémoire).
 * - Aucune connexion réseau externe ni projet Firebase réel n'est sollicité.
 * - Aucune écriture n'est effectuée sur une base de données de production.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initializeApp, cert, deleteApp, getApps } from 'firebase-admin/app';
import { 
  getAppletFirebaseConfig,
  validateServiceAccountCredentials, 
  initAdminApp,
  initAdminFirestore,
  DEFAULT_ADMIN_APP_NAME
} from './firebase-admin-config.mjs';
import { 
  parseSeedArgs, 
  seedCatalog,
  CHEZ_AWA_RESTAURANT,
  CHEZ_AWA_MENU_ITEMS 
} from './seed-catalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Génération d'une vraie paire de clés RSA en mémoire pour valider la signature syntaxique de Firebase Admin cert()
const { privateKey: validPemKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

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
  const EXPECTED_DB = 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf';
  const tmpDir = os.tmpdir();

  // ==========================================================================
  // SECTION 1 : getAppletFirebaseConfig
  // ==========================================================================
  console.log('--- SECTION 1 : Validation de getAppletFirebaseConfig() ---');

  // Test 1.1: Fichier de configuration réel par défaut
  const defaultCfg = getAppletFirebaseConfig();
  assert(defaultCfg.projectId === EXPECTED_PROJECT, `Lit correctement le projectId par défaut : ${defaultCfg.projectId}`);
  assert(defaultCfg.firestoreDatabaseId === EXPECTED_DB, `Lit correctement la base Firestore dédiée : ${defaultCfg.firestoreDatabaseId}`);

  // Test 1.2: Fichier de configuration introuvable
  assertThrows(
    () => getAppletFirebaseConfig('/tmp/config-introuvable-restaumax.json'),
    'Fichier de configuration Firebase introuvable',
    'Rejette un fichier de configuration inexistant'
  );

  // Test 1.3: Fichier JSON mal formé
  const malformedConfigFile = path.join(tmpDir, `config-malformed-${Date.now()}.json`);
  fs.writeFileSync(malformedConfigFile, '{ invalid-json ::');
  try {
    assertThrows(
      () => getAppletFirebaseConfig(malformedConfigFile),
      'Impossible de lire ou parser',
      'Rejette un fichier JSON syntaxiquement mal formé'
    );
  } finally {
    if (fs.existsSync(malformedConfigFile)) fs.unlinkSync(malformedConfigFile);
  }

  // Test 1.4: Fichier contenant un JSON non-objet (tableau)
  const arrayConfigFile = path.join(tmpDir, `config-array-${Date.now()}.json`);
  fs.writeFileSync(arrayConfigFile, '["element1"]');
  try {
    assertThrows(
      () => getAppletFirebaseConfig(arrayConfigFile),
      'ne contient pas un objet JSON valide',
      'Rejette un JSON racine qui n\'est pas un objet'
    );
  } finally {
    if (fs.existsSync(arrayConfigFile)) fs.unlinkSync(arrayConfigFile);
  }

  // Test 1.5: projectId manquant dans la configuration
  const missingProjFile = path.join(tmpDir, `config-missing-proj-${Date.now()}.json`);
  fs.writeFileSync(missingProjFile, JSON.stringify({ firestoreDatabaseId: EXPECTED_DB }));
  try {
    assertThrows(
      () => getAppletFirebaseConfig(missingProjFile),
      "'projectId' est manquant ou vide",
      "Rejette une configuration où 'projectId' est absent"
    );
  } finally {
    if (fs.existsSync(missingProjFile)) fs.unlinkSync(missingProjFile);
  }

  // Test 1.6: projectId vide ou uniquement composé d'espaces
  const emptyProjFile = path.join(tmpDir, `config-empty-proj-${Date.now()}.json`);
  fs.writeFileSync(emptyProjFile, JSON.stringify({ projectId: '   ', firestoreDatabaseId: EXPECTED_DB }));
  try {
    assertThrows(
      () => getAppletFirebaseConfig(emptyProjFile),
      "'projectId' est manquant ou vide",
      "Rejette une configuration où 'projectId' est composé uniquement d'espaces"
    );
  } finally {
    if (fs.existsSync(emptyProjFile)) fs.unlinkSync(emptyProjFile);
  }

  // Test 1.7: firestoreDatabaseId manquant dans la configuration
  const missingDbFile = path.join(tmpDir, `config-missing-db-${Date.now()}.json`);
  fs.writeFileSync(missingDbFile, JSON.stringify({ projectId: EXPECTED_PROJECT }));
  try {
    assertThrows(
      () => getAppletFirebaseConfig(missingDbFile),
      "'firestoreDatabaseId' explicite est manquant ou vide",
      "Rejette une configuration où 'firestoreDatabaseId' est absent"
    );
  } finally {
    if (fs.existsSync(missingDbFile)) fs.unlinkSync(missingDbFile);
  }

  // Test 1.8: firestoreDatabaseId vide ou uniquement composé d'espaces
  const emptyDbFile = path.join(tmpDir, `config-empty-db-${Date.now()}.json`);
  fs.writeFileSync(emptyDbFile, JSON.stringify({ projectId: EXPECTED_PROJECT, firestoreDatabaseId: '   ' }));
  try {
    assertThrows(
      () => getAppletFirebaseConfig(emptyDbFile),
      "'firestoreDatabaseId' explicite est manquant ou vide",
      "Rejette une configuration où 'firestoreDatabaseId' est composé d'espaces"
    );
  } finally {
    if (fs.existsSync(emptyDbFile)) fs.unlinkSync(emptyDbFile);
  }

  // ==========================================================================
  // SECTION 2 : validateServiceAccountCredentials
  // ==========================================================================
  console.log('\n--- SECTION 2 : Validation stricte du compte de service ---');

  const validCreds = {
    type: 'service_account',
    project_id: EXPECTED_PROJECT,
    private_key_id: 'test-key-id-999',
    private_key: validPemKey,
    client_email: `firebase-adminsdk@${EXPECTED_PROJECT}.iam.gserviceaccount.com`,
  };

  // Test 2.1: Identifiants valides sous forme d'objet
  const resValidObj = validateServiceAccountCredentials(validCreds, EXPECTED_PROJECT);
  assert(resValidObj.project_id === EXPECTED_PROJECT, 'Accepte des identifiants valides avec le bon projectId');

  // Test 2.2: Normalisation (.trim())
  const resTrim = validateServiceAccountCredentials(
    { ...validCreds, project_id: `  ${EXPECTED_PROJECT}  ` },
    `  ${EXPECTED_PROJECT}  `
  );
  assert(resTrim.project_id.trim() === EXPECTED_PROJECT, 'Normalise et compare correctement après trim()');

  // Test 2.3: Rejet si serviceAccountInput absent ou non défini
  assertThrows(
    () => validateServiceAccountCredentials(null, EXPECTED_PROJECT),
    'Identifiants de compte de service manquants',
    'Rejette un serviceAccountInput null ou non défini'
  );

  // Test 2.4: Rejet si chemin de fichier inexistant
  assertThrows(
    () => validateServiceAccountCredentials('/tmp/fichier-inexistant-restaumax.json', EXPECTED_PROJECT),
    'introuvable',
    'Rejette un chemin de fichier inexistant'
  );

  // Test 2.5: Rejet si chemin vide
  assertThrows(
    () => validateServiceAccountCredentials('   ', EXPECTED_PROJECT),
    'Le chemin des identifiants spécifié est vide',
    'Rejette un chemin composé uniquement d’espaces'
  );

  // Test 2.6: Fichier JSON mal formé
  const malformedCredFile = path.join(tmpDir, `creds-malformed-${Date.now()}.json`);
  fs.writeFileSync(malformedCredFile, '{ non-valid json :::');
  try {
    assertThrows(
      () => validateServiceAccountCredentials(malformedCredFile, EXPECTED_PROJECT),
      "n'est pas un JSON valide",
      'Rejette un fichier JSON de clé syntaxiquement mal formé'
    );
  } finally {
    if (fs.existsSync(malformedCredFile)) fs.unlinkSync(malformedCredFile);
  }

  // Test 2.7: Rejet strict si project_id absent du compte de service
  const noProjectIdCreds = {
    type: 'service_account',
    client_email: 'test@example.com',
    private_key: validPemKey,
  };
  assertThrows(
    () => validateServiceAccountCredentials(noProjectIdCreds, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette formellement un compte de service sans champ 'project_id'"
  );

  // Test 2.8: Rejet strict si project_id vide
  assertThrows(
    () => validateServiceAccountCredentials({ ...noProjectIdCreds, project_id: '' }, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette un project_id vide"
  );

  // Test 2.9: Rejet strict si project_id composé d'espaces
  assertThrows(
    () => validateServiceAccountCredentials({ ...noProjectIdCreds, project_id: '   ' }, EXPECTED_PROJECT),
    "ne contient pas de champ 'project_id' valide et non vide",
    "Rejette un project_id composé uniquement d’espaces"
  );

  // Test 2.10: Rejet strict si project_id ne correspond pas à expectedProjectId
  const mismatchedCreds = {
    ...validCreds,
    project_id: 'pirate-foreign-project-999',
  };
  assertThrows(
    () => validateServiceAccountCredentials(mismatchedCreds, EXPECTED_PROJECT),
    'Incohérence de projet critique détectée',
    'Rejette un compte de service ciblant un autre projet'
  );

  // Test 2.11: Rejet strict si expectedProjectId vide
  assertThrows(
    () => validateServiceAccountCredentials(validCreds, ''),
    "L'identifiant de projet attendu ('expectedProjectId') est manquant",
    'Rejette un expectedProjectId vide'
  );

  // Test 2.12: Rejet strict si expectedProjectId null
  assertThrows(
    () => validateServiceAccountCredentials(validCreds, null),
    "L'identifiant de projet attendu ('expectedProjectId') est manquant",
    'Rejette un expectedProjectId null'
  );

  // Test 2.13: Vérification de l'absence de fuite de secret dans les messages d'erreur
  let errorWithoutLeak = true;
  try {
    validateServiceAccountCredentials(
      {
        project_id: 'autre-projet',
        private_key: 'CONFIDENTIAL_RSA_PRIVATE_KEY_NEVER_DISCLOSE',
        private_key_id: 'KEY_ID_TOP_SECRET',
      },
      EXPECTED_PROJECT
    );
  } catch (err) {
    if (err.message.includes('CONFIDENTIAL') || err.message.includes('KEY_ID_TOP_SECRET')) {
      errorWithoutLeak = false;
    }
  }
  assert(errorWithoutLeak, 'Aucune clé privée ni secret n’apparaît dans le message d’erreur');

  // Test 2.14: Validation sur fichier physique temporaire
  const validFile = path.join(tmpDir, `test-valid-creds-${Date.now()}.json`);
  fs.writeFileSync(validFile, JSON.stringify(validCreds));
  try {
    const fromFile = validateServiceAccountCredentials(validFile, EXPECTED_PROJECT);
    assert(fromFile.project_id === EXPECTED_PROJECT, 'Valide avec succès un fichier de credentials sur disque');
  } finally {
    if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
  }

  // ==========================================================================
  // SECTION 3 : initAdminApp & initAdminFirestore
  // ==========================================================================
  console.log('\n--- SECTION 3 : Cycle de vie et durcissement de Firebase Admin & Firestore ---');

  // Test 3.1: initAdminApp rejette un projectId vide
  assertThrows(
    () => initAdminApp(validCreds, ''),
    "'projectId' est manquant ou vide",
    "initAdminApp rejette un projectId vide"
  );

  // Test 3.2: Cas 1 — Application existante avec le bon projet
  const goodAppName = `test-good-app-${Date.now()}`;
  const appGood = initializeApp({ credential: cert(validCreds), projectId: EXPECTED_PROJECT }, goodAppName);
  try {
    const appFound = initAdminApp(validCreds, EXPECTED_PROJECT, goodAppName);
    assert(appFound === appGood, "Application existante avec le bon projet : réutilisation exacte sans doublon");
  } finally {
    await deleteApp(appGood);
  }

  // Test 3.3: Cas 2 — Application existante avec un autre projet
  const badAppName = `test-bad-proj-app-${Date.now()}`;
  const appBad = initializeApp({ credential: cert(validCreds), projectId: 'autre-projet-incompatible' }, badAppName);
  try {
    assertThrows(
      () => initAdminApp(validCreds, EXPECTED_PROJECT, 'nouvelle-app'),
      'Conflit d\'application Firebase Admin détecté',
      'Application existante avec un autre projet : rejet immédiat avec erreur explicite'
    );
  } finally {
    await deleteApp(appBad);
  }

  // Test 3.4: Cas 3 — Application existante sans projectId dans options
  const noProjAppName = `test-no-proj-app-${Date.now()}`;
  const appNoProj = initializeApp({ credential: cert(validCreds) }, noProjAppName);
  try {
    assertThrows(
      () => initAdminApp(validCreds, EXPECTED_PROJECT, 'nouvelle-app'),
      "ne possède pas d'identifiant 'projectId' valide ou non vide dans ses options",
      'Application existante sans projectId : rejet strict pour éviter toute ambiguïté'
    );
  } finally {
    await deleteApp(appNoProj);
  }

  // Test 3.5: Cas 4 — Application existante avec un projectId vide ou composé d'espaces
  const emptyProjAppName = `test-empty-proj-app-${Date.now()}`;
  const appEmptyProj = initializeApp({ credential: cert(validCreds), projectId: '   ' }, emptyProjAppName);
  try {
    assertThrows(
      () => initAdminApp(validCreds, EXPECTED_PROJECT, 'nouvelle-app'),
      "ne possède pas d'identifiant 'projectId' valide ou non vide dans ses options",
      'Application existante avec projectId vide : rejet strict'
    );
  } finally {
    await deleteApp(appEmptyProj);
  }

  // Test 3.6: Cas 5 — Réutilisation de l'application compatible par défaut
  const testAppName = `test-app-${Date.now()}`;
  const createdApp = initAdminApp(validCreds, EXPECTED_PROJECT, testAppName);
  const reusedApp = initAdminApp(validCreds, EXPECTED_PROJECT, testAppName);
  assert(createdApp === reusedApp, 'Réutilisation confirmée : aucune initialisation en double');

  // Test 3.7 : initAdminFirestore avec databaseId manquant
  assertThrows(
    () => initAdminFirestore(createdApp, null),
    "L'identifiant de base de données Firestore ('databaseId') est manquant ou vide",
    "initAdminFirestore rejette un databaseId null"
  );

  // Test 3.8 : initAdminFirestore avec databaseId vide
  assertThrows(
    () => initAdminFirestore(createdApp, ''),
    "L'identifiant de base de données Firestore ('databaseId') est manquant ou vide",
    "initAdminFirestore rejette un databaseId vide"
  );

  // Test 3.9 : initAdminFirestore avec databaseId composé uniquement d'espaces
  assertThrows(
    () => initAdminFirestore(createdApp, '   '),
    "L'identifiant de base de données Firestore ('databaseId') est manquant ou vide",
    "initAdminFirestore rejette un databaseId composé uniquement d'espaces"
  );

  // Test 3.10 : initAdminFirestore avec base valide retournée
  const adminDb = initAdminFirestore(createdApp, EXPECTED_DB);
  assert(adminDb.databaseId === EXPECTED_DB, `initAdminFirestore initialise bien la base ciblée : ${adminDb.databaseId}`);

  // Test 3.11 : initAdminFirestore - détection de discordance de l'instance via appel réel
  assertThrows(
    () => initAdminFirestore(createdApp, EXPECTED_DB, () => ({ databaseId: 'mauvaise-base-inattendue' })),
    "Erreur critique d'intégrité Firestore",
    "initAdminFirestore : rejette formellement toute instance retournée dont le databaseId est discordant"
  );

  await deleteApp(createdApp);

  // ==========================================================================
  // SECTION 4 : parseSeedArgs
  // ==========================================================================
  console.log('\n--- SECTION 4 : Validation des arguments du seed CLI ---');

  // Test 4.1: Aucun argument -> isMerge = false
  const argsDefault = parseSeedArgs([]);
  assert(argsDefault.isMerge === false, 'Sans argument : isMerge est à false');

  // Test 4.2: Option --merge -> isMerge = true
  const argsMerge = parseSeedArgs(['--merge']);
  assert(argsMerge.isMerge === true, 'Avec --merge : isMerge est à true');

  // Test 4.3: Option --force explicitement rejetée
  assertThrows(
    () => parseSeedArgs(['--force']),
    "Option '--force' désactivée",
    'Rejette --force et oriente explicitement vers --merge'
  );

  // Test 4.4: Option inconnue (avec tiret)
  assertThrows(
    () => parseSeedArgs(['--supprimer-tout']),
    'Argument non reconnu : "--supprimer-tout"',
    'Rejette une option inconnue avec préfixe tiret'
  );

  // Test 4.5: Argument positionnel inattendu sans tiret
  assertThrows(
    () => parseSeedArgs(['chez-awa']),
    'Argument non reconnu : "chez-awa"',
    'Rejette un argument positionnel inattendu sans tiret (ex: nom de restaurant)'
  );

  // Test 4.6: Autre argument positionnel inattendu sans tiret
  assertThrows(
    () => parseSeedArgs(['--merge', 'extra-arg']),
    'Argument non reconnu : "extra-arg"',
    'Rejette un argument positionnel inattendu placé après --merge'
  );

  // ==========================================================================
  // SECTION 5 : Comportement non-destructif de seedCatalog sur Mock Firestore
  // ==========================================================================
  console.log('\n--- SECTION 5 : Comportement non-destructif du seed (Mock Firestore) ---');

  function createMockFirestore() {
    const store = new Map();

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
      databaseId: EXPECTED_DB,
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

  // Test 5.1: Base vide -> création complète (seeded)
  const mockDb1 = createMockFirestore();
  const seedResult1 = await seedCatalog(mockDb1, { isMerge: false });
  assert(seedResult1.status === 'seeded', 'Base vide : seed exécuté avec succès (status: seeded)');
  assert(seedResult1.count === CHEZ_AWA_MENU_ITEMS.length, `Insère les ${CHEZ_AWA_MENU_ITEMS.length} plats du catalogue`);
  assert(mockDb1._store.has(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`), 'Le restaurant a été créé dans la base');
  assert(mockDb1._store.has(`restaurants/${CHEZ_AWA_RESTAURANT.slug}/menuItems/${CHEZ_AWA_MENU_ITEMS[0].id}`), 'Les plats ont été créés');

  // Test 5.2: Restaurant déjà existant, sans --merge -> aucun écrasement (status: skipped)
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

  // Test 5.3: Restaurant déjà existant, avec --merge -> mise à jour sans écrasement
  const seedResult3 = await seedCatalog(mockDb2, { isMerge: true });
  assert(seedResult3.status === 'merged', 'Restaurant déjà présent avec --merge : mise à jour effectuée (status: merged)');

  // Test 5.4: Non-destruction des documents supplémentaires existants
  const mockDb3 = createMockFirestore();
  mockDb3._store.set(`restaurants/${CHEZ_AWA_RESTAURANT.slug}`, CHEZ_AWA_RESTAURANT);
  
  // Plat personnalisé préexistant dans la sous-collection menuItems
  const customDishPath = `restaurants/${CHEZ_AWA_RESTAURANT.slug}/menuItems/dish-custom-du-chef`;
  mockDb3._store.set(customDishPath, {
    id: 'dish-custom-du-chef',
    name: 'Spécialité secrète du Chef',
    price: 25000,
  });

  // Autre document préexistant dans une autre collection
  const otherDocPath = `restaurants/autre-restaurant-partenaire`;
  mockDb3._store.set(otherDocPath, { slug: 'autre-restaurant-partenaire', name: 'Autre Resto' });

  // Exécution du seed avec --merge
  await seedCatalog(mockDb3, { isMerge: true });

  assert(
    mockDb3._store.has(customDishPath),
    'Garantie non-destructive : Le plat personnalisé "dish-custom-du-chef" est TOUJOURS présent après le seed'
  );
  assert(
    mockDb3._store.get(customDishPath).price === 25000,
    'Garantie non-destructive : Les données du plat personnalisé sont strictement intactes'
  );
  assert(
    mockDb3._store.has(otherDocPath),
    'Garantie non-destructive : Les documents d’autres collections sont strictement intacts'
  );

  // ==========================================================================
  // BILAN GÉNÉRAL
  // ==========================================================================
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
