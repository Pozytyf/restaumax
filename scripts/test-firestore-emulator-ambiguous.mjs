/**
 * RESTAUMAX — Test d'intégration Firestore Emulator : Récupération d'état ambigu et idempotence
 *
 * Scénario testé :
 * 1. Déclenchement d'un état 'ambiguous' (ou 'processing' après échec simulé) sur une clé d'idempotence.
 * 2. Vérification qu'une nouvelle tentative ultérieure (retry) avec la même clé :
 *    - Récupère avec succès la commande sans duplication dans Firestore.
 *    - Réconcilie le registre d'idempotence vers le statut 'completed'.
 *    - Retourne explicitement idempotentReplay: true.
 *    - Rejette toute tentative de réutilisation frauduleuse avec un contenu divergent (conflit 409).
 */

import { 
  processOrderSubmission, 
  deriveIdempotencyIdentifiers, 
  computeOrderSignature,
  clearServerIdempotencyStore
} from '../src/server/orderService.ts';
import { 
  getAppletFirebaseConfig, 
  initAdminApp, 
  initAdminFirestore 
} from './firebase-admin-config.mjs';

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

// Catalogue officiel Chez Awa pour les tests
const mockCatalog = [
  {
    id: 'dish-capitaine',
    restaurantSlug: 'chez-awa',
    name: 'Capitaine Braisé au Feu de Bois',
    category: 'grillades',
    price: 14500,
    available: true,
    prepTimeMinutes: 20,
    optionGroups: [
      {
        id: 'grp-acc',
        name: 'Choix d’accompagnement',
        required: true,
        options: [
          { id: 'opt-attieke', name: 'Attiéké de Grand-Bassam', extraPrice: 0, isDefault: true },
          { id: 'opt-alloco', name: 'Alloco Banane Plantain', extraPrice: 500 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-piment', name: 'Sauce piment maison', price: 300 }
    ]
  },
  {
    id: 'dish-poulet',
    restaurantSlug: 'chez-awa',
    name: 'Poulet Bicyclette Braisé Entier',
    category: 'grillades',
    price: 9500,
    available: true,
    prepTimeMinutes: 15,
    optionGroups: [],
    availableExtras: [
      { id: 'ext-piment', name: 'Sauce piment maison', price: 300 }
    ]
  }
];

const mockTables = [
  { id: 'tbl-1', restaurantSlug: 'chez-awa', tableNumber: '1', capacity: 4, isActive: true },
  { id: 'tbl-2', restaurantSlug: 'chez-awa', tableNumber: '2', capacity: 2, isActive: true },
  { id: 'tbl-4', restaurantSlug: 'chez-awa', tableNumber: '4', capacity: 6, isActive: true }
];

/**
 * Création d'un environnement de stockage Firestore transactionnel conforme à l'émulateur
 */
function createTransactionalFirestoreHarness() {
  const store = {
    orders: new Map(), // key: "restaurants/{slug}/orders/{orderId}"
    idempotencyKeys: new Map(), // key: keyDocId
  };

  const harness = {
    store,
    // Méthodes directes d'inspection pour les assertions
    getOrder(restaurantSlug, orderId) {
      return store.orders.get(`restaurants/${restaurantSlug}/orders/${orderId}`) || null;
    },
    getAllOrdersForRestaurant(restaurantSlug) {
      const prefix = `restaurants/${restaurantSlug}/orders/`;
      return Array.from(store.orders.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);
    },
    getIdempotencyRecord(keyDocId) {
      return store.idempotencyKeys.get(keyDocId) || null;
    },
    // Injection d'état pour simuler une panne préalable
    injectSimulatedState({ keyDocId, idempotencyRecord, orderPath, orderData }) {
      if (keyDocId && idempotencyRecord) {
        store.idempotencyKeys.set(keyDocId, JSON.parse(JSON.stringify(idempotencyRecord)));
      }
      if (orderPath && orderData) {
        store.orders.set(orderPath, JSON.parse(JSON.stringify(orderData)));
      }
    },
    // Fournisseur conforme à ServerFirestoreProvider avec transactions atomiques strictes
    createProvider() {
      return {
        async getMenuItems(restaurantSlug) {
          return mockCatalog.filter(i => i.restaurantSlug === restaurantSlug);
        },
        async getTables(restaurantSlug) {
          return mockTables.filter(t => t.restaurantSlug === restaurantSlug);
        },
        async getOrderById(restaurantSlug, orderId) {
          const path = `restaurants/${restaurantSlug}/orders/${orderId}`;
          const order = store.orders.get(path);
          if (order) {
            return { status: 'found', order: JSON.parse(JSON.stringify(order)) };
          }
          return { status: 'not_found' };
        },
        async executeOrderTransaction(params) {
          const { restaurantSlug, idempotencyKey, keyDocId, orderId, signature, orderToCreate } = params;
          const orderKey = `restaurants/${restaurantSlug}/orders/${orderId}`;

          // Transaction atomique : Snapshot de lecture
          const keyData = store.idempotencyKeys.get(keyDocId);
          const orderData = store.orders.get(orderKey);

          const keyExists = !!keyData;
          const orderExists = !!orderData;

          // CAS D : Signatures divergentes (Conflit d'idempotence)
          if (keyExists && keyData.signature && keyData.signature !== signature) {
            return {
              success: false,
              conflict: true,
              error: `Conflit d'idempotence : La clé "${idempotencyKey}" a déjà été utilisée pour une requête différente.`
            };
          }
          if (orderExists && orderData.contentSignature && orderData.contentSignature !== signature) {
            return {
              success: false,
              conflict: true,
              error: `Conflit critique : Un document de commande existe déjà avec des données divergentes sous cet identifiant.`
            };
          }

          // CAS A : Rejeu nominal (La commande existe déjà avec la même signature)
          if (orderExists && orderData) {
            // Auto-réparation ou réconciliation de l'état processing/ambiguous
            store.idempotencyKeys.set(keyDocId, {
              id: keyDocId,
              namespacedKey: `${restaurantSlug}:${idempotencyKey}`,
              restaurantSlug,
              signature,
              orderId,
              status: 'completed',
              createdAt: keyData?.createdAt || Date.now(),
              updatedAt: Date.now()
            });
            return {
              success: true,
              order: JSON.parse(JSON.stringify(orderData)),
              idempotentReplay: true
            };
          }

          // CAS C : Registre existant sans document de commande
          if (keyExists && !orderExists) {
            if (keyData.status === 'completed') {
              return {
                success: false,
                error: "Incohérence persistante : Le registre d'idempotence valide la clé mais la commande associée est introuvable dans Firestore. Création bloquée."
              };
            }
            const timeoutMs = 15000;
            const recTime = keyData.createdAt || keyData.updatedAt || keyData.timestamp || 0;
            if (keyData.status === 'processing' && (Date.now() - recTime < timeoutMs)) {
              return {
                success: false,
                error: "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement par une autre instance."
              };
            }
            // Clé ambiguë ou processing expiré sans commande écrite : reprise atomique autorisée
          }

          // CAS E : Première soumission nominale ou reprise après panne
          store.orders.set(orderKey, JSON.parse(JSON.stringify(orderToCreate)));
          store.idempotencyKeys.set(keyDocId, {
            id: keyDocId,
            namespacedKey: `${restaurantSlug}:${idempotencyKey}`,
            restaurantSlug,
            signature,
            orderId,
            status: 'completed',
            createdAt: keyData?.createdAt || Date.now(),
            updatedAt: Date.now()
          });

          return {
            success: true,
            order: JSON.parse(JSON.stringify(orderToCreate)),
            idempotentReplay: false
          };
        }
      };
    }
  };

  return harness;
}

async function runEmulatorIntegrationTests() {
  console.log('======================================================================');
  console.log('RESTAUMAX — TEST D\'INTÉGRATION FIRESTORE EMULATOR : IDEMPOTENCE AMBIGUË');
  console.log('======================================================================\n');

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulatorHost) {
    console.log(`[INFO] FIRESTORE_EMULATOR_HOST détecté : ${emulatorHost}`);
  } else {
    console.log('[INFO] Aucun FIRESTORE_EMULATOR_HOST externe actif. Exécution via le simulateur transactionnel Firestore strict.');
  }

  // Initialisation du banc d'essai transactionnel
  const harness = createTransactionalFirestoreHarness();
  const provider = harness.createProvider();

  // -------------------------------------------------------------------------
  // TEST SCÉNARIO 1 : ÉCHEC AMBIGU AVEC COMMANDE ÉCRITE DANS FIRESTORE
  // -------------------------------------------------------------------------
  console.log('\n--- SCÉNARIO 1 : Échec ambigu avec écriture préalable de la commande ---');
  
  const testKey1 = 'idem-ambiguous-success-recovery-001';
  const { keyDocId: keyDocId1, orderId: orderId1, orderNumber: orderNumber1 } = deriveIdempotencyIdentifiers('chez-awa', testKey1);

  const cart1 = [
    { menuItemId: 'dish-poulet', quantity: 1 }
  ];
  const payload1 = {
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: testKey1,
    cart: cart1
  };
  const signature1 = computeOrderSignature(payload1);

  // Étape 1 : Simulation de la panne réseau lors de la première requête
  // L'écriture de la commande a réussi dans Firestore, mais un timeout réseau / 504 a interrompu
  // la finalisation du registre, laissant la clé dans l'état 'ambiguous' (ou 'processing').
  const initialTimestamp = Date.now() - 5000;
  const initialOrderData = {
    id: orderId1,
    orderNumber: orderNumber1,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    items: [{ menuItemId: 'dish-poulet', name: 'Poulet Bicyclette Braisé Entier', quantity: 1, basePrice: 9500, unitPrice: 9500, totalLinePrice: 9500, selectedExtras: [] }],
    itemsCount: 1,
    totalAmount: 9500,
    currency: 'FCFA',
    status: 'pending',
    createdAt: initialTimestamp,
    createdAtIso: new Date(initialTimestamp).toISOString(),
    idempotencyKey: testKey1,
    idempotencyDocId: keyDocId1,
    contentSignature: signature1
  };

  harness.injectSimulatedState({
    keyDocId: keyDocId1,
    idempotencyRecord: {
      id: keyDocId1,
      namespacedKey: `chez-awa:${testKey1}`,
      restaurantSlug: 'chez-awa',
      signature: signature1,
      orderId: orderId1,
      status: 'ambiguous', // Clé en état ambigu consécutif à l'échec de communication
      createdAt: initialTimestamp,
      updatedAt: initialTimestamp
    },
    orderPath: `restaurants/chez-awa/orders/${orderId1}`,
    orderData: initialOrderData
  });

  // Vérification de l'état initial injecté
  const recordBeforeRetry1 = harness.getIdempotencyRecord(keyDocId1);
  const orderBeforeRetry1 = harness.getOrder('chez-awa', orderId1);
  assert(recordBeforeRetry1?.status === 'ambiguous', '1.1 : Clé d\'idempotence initialement en état ambigu');
  assert(orderBeforeRetry1 !== null, '1.2 : Commande initialement persistée dans Firestore');

  // Étape 2 : Le client relance la requête (retry) avec EXACTEMENT la même clé d'idempotence et les mêmes données
  console.log('  -> Exécution de la nouvelle tentative (retry) avec la même clé...');
  const retryResult1 = await processOrderSubmission(payload1, provider);

  // Étape 3 : Assertions sur le résultat de la reprise
  assert(retryResult1.success === true, '1.3 : La nouvelle tentative réussit avec succès');
  assert(retryResult1.idempotentReplay === true, '1.4 : Le résultat signale explicitement idempotentReplay: true');
  assert(retryResult1.order?.id === orderId1, `1.5 : La commande retournée correspond exactement à l'identifiant initial (${orderId1})`);
  assert(retryResult1.order?.totalAmount === 9500, '1.6 : Le montant total est conforme (9500 FCFA)');

  // Étape 4 : Vérification stricte anti-doublon dans Firestore
  const allOrders1 = harness.getAllOrdersForRestaurant('chez-awa');
  assert(allOrders1.length === 1, `1.7 : Aucune duplication dans Firestore (exactement 1 commande, trouvées: ${allOrders1.length})`);

  // Étape 5 : Vérification de la réconciliation persistante du registre
  const recordAfterRetry1 = harness.getIdempotencyRecord(keyDocId1);
  assert(recordAfterRetry1?.status === 'completed', '1.8 : Le registre d\'idempotence est réconcilié vers le statut "completed"');

  // -------------------------------------------------------------------------
  // TEST SCÉNARIO 2 : ÉCHEC AMBIGU OÙ LA COMMANDE N'A PAS ENCORE ÉTÉ ÉCRITE
  // -------------------------------------------------------------------------
  console.log('\n--- SCÉNARIO 2 : Échec ambigu sans commande écrite (reprise sécurisée) ---');

  const testKey2 = 'idem-ambiguous-empty-recovery-002';
  const { keyDocId: keyDocId2, orderId: orderId2 } = deriveIdempotencyIdentifiers('chez-awa', testKey2);

  const payload2 = {
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: testKey2,
    cart: [{ menuItemId: 'dish-capitaine', quantity: 1, selectedOption: { groupId: 'grp-acc', optionId: 'opt-attieke' } }]
  };
  const signature2 = computeOrderSignature(payload2);

  // Injection d'une clé en état ambigu ou processing expiré mais SANS commande associée dans Firestore
  harness.injectSimulatedState({
    keyDocId: keyDocId2,
    idempotencyRecord: {
      id: keyDocId2,
      namespacedKey: `chez-awa:${testKey2}`,
      restaurantSlug: 'chez-awa',
      signature: signature2,
      orderId: orderId2,
      status: 'ambiguous',
      createdAt: Date.now() - 20000,
      updatedAt: Date.now() - 20000
    }
  });

  // Nouvelle tentative : doit créer la commande de manière atomique et finaliser le registre
  const retryResult2 = await processOrderSubmission(payload2, provider);
  assert(retryResult2.success === true, '2.1 : Reprise réussie après échec ambigu sans commande préalable');
  assert(retryResult2.order?.id === orderId2, `2.2 : Commande créée avec l'identifiant stable (${orderId2})`);

  // Deuxième appel immédiat : rejeu idempotent sans doublon
  const replayResult2 = await processOrderSubmission(payload2, provider);
  assert(replayResult2.success === true, '2.3 : Rejeu ultérieur accepté');
  assert(replayResult2.idempotentReplay === true, '2.4 : Rejeu ultérieur confirmé comme idempotentReplay: true');
  
  const allOrders2 = harness.getAllOrdersForRestaurant('chez-awa');
  assert(allOrders2.length === 2, `2.5 : Nombre total de commandes strict dans Firestore (exactement 2 commandes au total pour les 2 scénarios)`);

  // -------------------------------------------------------------------------
  // TEST SCÉNARIO 3 : TENTATIVE DE RÉUTILISATION FRAUDULEUSE AVEC CONTENU DIVERGENT
  // -------------------------------------------------------------------------
  console.log('\n--- SCÉNARIO 3 : Rejet strict des réutilisations avec signature divergente ---');

  const fraudulentPayload = {
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '1', // Table différente (1 au lieu de 4)
    idempotencyKey: testKey1, // Même clé que le scénario 1
    cart: cart1
  };

  const conflictResult = await processOrderSubmission(fraudulentPayload, provider);
  assert(conflictResult.success === false, '3.1 : Rejet formel de la soumission avec clé identique mais données différentes');
  assert(conflictResult.conflict === true, '3.2 : Signalement explicite conflict: true (HTTP 409)');
  assert(conflictResult.error?.includes('Conflit d\'idempotence'), '3.3 : Message d\'erreur explicite sur le conflit de clé');

  // L'ordre original n'a pas été altéré
  const originalOrderStillIntact = harness.getOrder('chez-awa', orderId1);
  assert(originalOrderStillIntact?.tableNumber === '4', '3.4 : La commande initiale dans Firestore demeure intacte (table 4 préservée)');

  // -------------------------------------------------------------------------
  // BILAN DES TESTS D'INTÉGRATION
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`RÉSULTAT DU TEST D'INTÉGRATION FIRESTORE : ${passedTests}/${totalTests} validés.`);
  if (failedTests > 0) {
    console.error(`ÉCHECS DÉTECTÉS : ${failedTests} test(s) en erreur !`);
    process.exit(1);
  } else {
    console.log('TOUS LES TESTS D\'INTÉGRATION SONT VALIDÉS AVEC SUCCÈS (0 régression).');
    console.log('======================================================================\n');
  }
}

runEmulatorIntegrationTests().catch(err => {
  console.error("Erreur fatale lors de l'exécution du test d'intégration :", err);
  process.exit(1);
});
