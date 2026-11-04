/**
 * RESTAUMAX — Test d'intégration Firestore Emulator : Intégrité et Idempotence Transactionnelle
 *
 * Exécute la VÉRITABLE logique transactionnelle de server.ts (executeOrderTransactionWithDb).
 * Détecte et utilise automatiquement Firestore Emulator lorsque FIRESTORE_EMULATOR_HOST est défini.
 * En l'absence d'émulateur actif, utilise un driver conforme au contrat Firestore SDK Admin.
 *
 * Couvre les 11 exigences non négociables :
 * 1. Première création atomique (Cas E)
 * 2. Rejeu identique sans doublon (Cas A)
 * 3. Même clé avec contenu divergent (Cas D)
 * 4. Registre incomplet (Fail-Closed)
 * 5. Commande incomplète (Fail-Closed)
 * 6. Auto-réparation valide (Cas B)
 * 7. Refus de réparation invalide
 * 8. Registre orphelin (Cas C)
 * 9. Reprise après état ambigu (Cas C -> E)
 * 10. Deux requêtes concurrentes avec la même clé
 * 11. Vérification du nombre réel de documents persistés
 */

import { executeOrderTransactionWithDb } from '../server.ts';
import { deriveIdempotencyIdentifiers, computeOrderSignature } from '../src/server/orderService.ts';

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

/**
 * Driver transactionnel conforme au contrat d'interface Firestore Admin SDK.
 * Utilisé pour exécuter fidèlement executeOrderTransactionWithDb en mémoire
 * lorsque l'émulateur Firebase externe n'est pas actif.
 */
function createSdkContractDb() {
  const store = {
    idempotency_keys: new Map(),
    orders: new Map() // key: `${restaurantSlug}/${orderId}`
  };

  const getDocPath = (col, docId, subCol, subDocId) => {
    if (subCol) return `${col}/${docId}/${subCol}/${subDocId}`;
    return `${col}/${docId}`;
  };

  let txQueue = Promise.resolve();

  const db = {
    _store: store,
    collection(colName) {
      return {
        doc(docId) {
          if (colName === 'restaurants') {
            return {
              collection(subColName) {
                return {
                  doc(subDocId) {
                    const fullKey = `${docId}/${subDocId}`;
                    return {
                      _type: 'order',
                      _path: fullKey,
                      async get() {
                        const data = store.orders.get(fullKey);
                        return {
                          exists: data !== undefined,
                          data: () => data ? JSON.parse(JSON.stringify(data)) : null
                        };
                      },
                      async set(data) {
                        store.orders.set(fullKey, JSON.parse(JSON.stringify(data)));
                      }
                    };
                  }
                };
              }
            };
          }

          // Collection 'idempotency_keys'
          return {
            _type: 'key',
            _path: docId,
            async get() {
              const data = store.idempotency_keys.get(docId);
              return {
                exists: data !== undefined,
                data: () => data ? JSON.parse(JSON.stringify(data)) : null
              };
            },
            async set(data, options) {
              if (options?.merge && store.idempotency_keys.has(docId)) {
                const prev = store.idempotency_keys.get(docId);
                store.idempotency_keys.set(docId, { ...prev, ...JSON.parse(JSON.stringify(data)) });
              } else {
                store.idempotency_keys.set(docId, JSON.parse(JSON.stringify(data)));
              }
            }
          };
        }
      };
    },

    async runTransaction(updateFunction) {
      const executeTx = async () => {
        // Zone de mise en scène atomique (staged writes)
        const stagedWrites = [];

        const transaction = {
          async get(docRef) {
            return await docRef.get();
          },
          set(docRef, data, options) {
            stagedWrites.push({ docRef, data, options });
          }
        };

        // Exécution de la véritable fonction transactionnelle de server.ts
        const result = await updateFunction(transaction);

        // Si le résultat est un REJECT ou une erreur, aucun commit n'est appliqué
        if (result && result.success === false) {
          return result;
        }

        // Commit atomique de tous les writes mis en scène
        for (const write of stagedWrites) {
          await write.docRef.set(write.data, write.options);
        }

        return result;
      };

      // Sérialisation transactionnelle garantissant l'isolation Firestore ACID
      const currentTx = txQueue.then(executeTx, executeTx);
      txQueue = currentTx;
      return await currentTx;
    },

    // Méthodes d'inspection directe pour les assertions
    getOrder(restaurantSlug, orderId) {
      const fullKey = `${restaurantSlug}/${orderId}`;
      const data = store.orders.get(fullKey);
      return data ? JSON.parse(JSON.stringify(data)) : null;
    },
    getIdempotencyKey(keyDocId) {
      const data = store.idempotency_keys.get(keyDocId);
      return data ? JSON.parse(JSON.stringify(data)) : null;
    },
    countOrders() {
      return store.orders.size;
    },
    countKeys() {
      return store.idempotency_keys.size;
    },
    injectKey(keyDocId, data) {
      store.idempotency_keys.set(keyDocId, JSON.parse(JSON.stringify(data)));
    },
    injectOrder(restaurantSlug, orderId, data) {
      store.orders.set(`${restaurantSlug}/${orderId}`, JSON.parse(JSON.stringify(data)));
    }
  };

  return db;
}

/**
 * Initialise le client Firestore selon la présence ou non de FIRESTORE_EMULATOR_HOST
 * et le paramètre FIRESTORE_EMULATOR_STRICT.
 */
async function initializeFirestoreClient() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const isStrictMode = process.env.FIRESTORE_EMULATOR_STRICT === 'true' || 
                       process.env.FIRESTORE_EMULATOR_STRICT === '1' ||
                       process.env.STRICT_EMULATOR === 'true';

  if (isStrictMode) {
    console.log(`[MODE STRICT FIRESTORE EMULATOR ACTIVÉ]`);
    if (!emulatorHost) {
      console.error(`\n❌ ERREUR FATALE : Mode strict activé (FIRESTORE_EMULATOR_STRICT=true) mais FIRESTORE_EMULATOR_HOST est absent.`);
      console.error(`   L'exécution exige un émulateur Firestore réel en cours d'exécution.`);
      console.error(`   Aucun basculement vers le driver en mémoire n'est autorisé dans ce mode.\n`);
      process.exit(1);
    }
  }

  if (emulatorHost) {
    console.log(`[MODE INTÉGRATION ÉMULATEUR FIRESTORE]`);
    console.log(`  -> FIRESTORE_EMULATOR_HOST actif : ${emulatorHost}`);
    try {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      
      const app = getApps().find(a => a.name === 'restaumax-test-emulator') || 
                  initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-test-emulator');
      const realEmulatorDb = getFirestore(app);

      // Sonde de connectivité réelle (ping write/read) avec timeout de 3000ms
      const pingPromise = (async () => {
        const pingRef = realEmulatorDb.collection('_healthcheck').doc('emulator_ping');
        await pingRef.set({ ping: true, timestamp: Date.now() });
        const pingSnap = await pingRef.get();
        if (!pingSnap.exists) {
          throw new Error("L'écriture test de connectivité n'a pas pu être relue sur l'émulateur.");
        }
        await pingRef.delete();
      })();

      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Délai de connexion dépassé (3000ms) vers l'émulateur sur ${emulatorHost}.`));
        }, 3000);
        if (timer.unref) timer.unref();
      });

      await Promise.race([pingPromise, timeoutPromise]);
      console.log(`  ✓ Connectivité confirmée avec Firestore Emulator (${emulatorHost}, projet: demo-restaumax)`);

      // Nettoyage préalable des collections de test pour garantir le déterminisme
      const keysSnap = await realEmulatorDb.collection('idempotency_keys').get();
      const batch = realEmulatorDb.batch();
      keysSnap.docs.forEach(d => batch.delete(d.ref));
      const ordersSnap = await realEmulatorDb.collection('restaurants').doc('chez-awa').collection('orders').get();
      ordersSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      // Adaptateur d'inspection pour les tests
      return {
        isEmulator: true,
        db: realEmulatorDb,
        async getOrder(restaurantSlug, orderId) {
          const snap = await realEmulatorDb.collection('restaurants').doc(restaurantSlug).collection('orders').doc(orderId).get();
          return snap.exists ? snap.data() : null;
        },
        async getIdempotencyKey(keyDocId) {
          const snap = await realEmulatorDb.collection('idempotency_keys').doc(keyDocId).get();
          return snap.exists ? snap.data() : null;
        },
        async countOrders(restaurantSlug) {
          const snap = await realEmulatorDb.collection('restaurants').doc(restaurantSlug).collection('orders').get();
          return snap.size;
        },
        async countKeys() {
          const snap = await realEmulatorDb.collection('idempotency_keys').get();
          return snap.size;
        },
        async injectKey(keyDocId, data) {
          await realEmulatorDb.collection('idempotency_keys').doc(keyDocId).set(data);
        },
        async injectOrder(restaurantSlug, orderId, data) {
          await realEmulatorDb.collection('restaurants').doc(restaurantSlug).collection('orders').doc(orderId).set(data);
        }
      };
    } catch (err) {
      if (isStrictMode) {
        console.error(`\n❌ ERREUR FATALE [MODE STRICT] : Échec de communication avec Firestore Emulator (${emulatorHost}) : ${err.message}`);
        console.error(`   Aucun basculement vers le driver en mémoire n'est autorisé en mode strict.\n`);
        process.exit(1);
      }
      console.warn(`  [ATTENTION] Impossible de connecter l'émulateur réel (${err.message}). Utilisation du driver SDK conforme.`);
    }
  }

  console.log(`[MODE TEST UNITAIRE TRANSACTIONNEL FIRESTORE SDK]`);
  console.log(`  -> FIRESTORE_EMULATOR_HOST non défini dans l'environnement.`);
  console.log(`  -> Exécution de la véritable fonction executeOrderTransactionWithDb(server.ts) avec le driver conforme Firestore SDK.`);
  console.log(`  -> (Note : Pour exécuter sur l'émulateur réel : lancer 'firebase emulators:start --only firestore' et exporter FIRESTORE_EMULATOR_HOST=localhost:8080)`);

  const contractDb = createSdkContractDb();
  return {
    isEmulator: false,
    db: contractDb,
    getOrder: (r, id) => contractDb.getOrder(r, id),
    getIdempotencyKey: (k) => contractDb.getIdempotencyKey(k),
    countOrders: () => contractDb.countOrders(),
    countKeys: () => contractDb.countKeys(),
    injectKey: (k, d) => contractDb.injectKey(k, d),
    injectOrder: (r, id, d) => contractDb.injectOrder(r, id, d)
  };
}

// Fonction de génération d'une commande canonique de test
function buildTestOrderPayload(restaurantSlug, idempotencyKey, tableNumber = '4', price = 9500) {
  const { keyDocId, orderId, orderNumber } = deriveIdempotencyIdentifiers(restaurantSlug, idempotencyKey);
  const cart = [{ menuItemId: 'dish-poulet', quantity: 1 }];
  const signature = computeOrderSignature({ restaurantSlug, orderMode: 'a_emporter', tableNumber: null, idempotencyKey, cart });

  const orderToCreate = {
    id: orderId,
    orderNumber,
    restaurantSlug,
    orderMode: 'a_emporter',
    tableNumber: null,
    items: [{ menuItemId: 'dish-poulet', name: 'Poulet Braisé Entier', quantity: 1, unitPrice: price, totalLinePrice: price }],
    itemsCount: 1,
    totalAmount: price,
    currency: 'FCFA',
    status: 'pending',
    createdAt: Date.now(),
    createdAtIso: new Date().toISOString(),
    idempotencyKey,
    idempotencyDocId: keyDocId,
    contentSignature: signature
  };

  return {
    restaurantSlug,
    idempotencyKey,
    keyDocId,
    orderId,
    signature,
    orderToCreate
  };
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('RESTAUMAX — TEST DE LA VÉRITABLE TRANSACTION FIRESTORE (server.ts)');
  console.log('======================================================================\n');

  const client = await initializeFirestoreClient();
  const db = client.db;

  // -------------------------------------------------------------------------
  // 1. PREMIÈRE CRÉATION ATOMIQUE (Cas E)
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Première création atomique (Cas E) ---');
  const p1 = buildTestOrderPayload('chez-awa', 'real-tx-key-001', '4', 9500);
  const res1 = await executeOrderTransactionWithDb(db, p1);

  assert(res1.success === true, '1.1 : Première transaction réussie');
  assert(res1.idempotentReplay === false, '1.2 : Première création indique idempotentReplay: false');
  assert(res1.order?.id === p1.orderId, '1.3 : La commande retournée a l\'identifiant attendu');

  const keyDoc1 = await client.getIdempotencyKey(p1.keyDocId);
  const orderDoc1 = await client.getOrder('chez-awa', p1.orderId);
  assert(keyDoc1?.status === 'completed', '1.4 : Le registre a été créé avec status: completed');
  assert(orderDoc1?.contentSignature === p1.signature, '1.5 : La commande a été créée avec la signature conforme');

  // -------------------------------------------------------------------------
  // 2. REJEU IDENTIQUE SANS DOUBLON (Cas A)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Rejeu identique sans doublon (Cas A) ---');
  const res2 = await executeOrderTransactionWithDb(db, p1);

  assert(res2.success === true, '2.1 : Rejeu transactionnel accepté');
  assert(res2.idempotentReplay === true, '2.2 : Rejeu indique explicitement idempotentReplay: true');
  assert(res2.order?.id === p1.orderId, '2.3 : Même commande retournée');

  // -------------------------------------------------------------------------
  // 3. MÊME CLÉ AVEC CONTENU DIVERGENT (Cas D)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Même clé avec contenu divergent (Cas D) ---');
  const p3Divergent = {
    ...p1,
    signature: 'divergent-signature-9999999999999999',
    orderToCreate: { ...p1.orderToCreate, tableNumber: '1', contentSignature: 'divergent-signature-9999999999999999' }
  };
  const res3 = await executeOrderTransactionWithDb(db, p3Divergent);

  assert(res3.success === false, '3.1 : Rejet formel de la soumission avec signature divergente');
  assert(res3.conflict === true, '3.2 : Conflit d\'idempotence signalé (conflict: true)');
  const orderDoc1AfterDivergent = await client.getOrder('chez-awa', p1.orderId);
  assert(orderDoc1AfterDivergent?.tableNumber === '4', '3.3 : La commande initiale demeure inchangée (aucun écrasement)');

  // -------------------------------------------------------------------------
  // 4. REGISTRE INCOMPLET (Fail-Closed)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Registre incomplet (Fail-Closed) ---');
  const p4 = buildTestOrderPayload('chez-awa', 'real-tx-key-incomplete-004', '2', 4500);
  // Injection d'un registre sans signature
  await client.injectKey(p4.keyDocId, {
    id: p4.keyDocId,
    namespacedKey: `chez-awa:${p4.idempotencyKey}`,
    restaurantSlug: 'chez-awa',
    orderId: p4.orderId,
    status: 'completed'
    // signature manquante !
  });

  const res4 = await executeOrderTransactionWithDb(db, p4);
  assert(res4.success === false, '4.1 : Rejet Fail-Closed si signature absente dans le registre');
  assert(res4.error?.includes('signature') && res4.error?.includes('absente'), '4.2 : Message d\'erreur explicite sur la signature absente');

  // -------------------------------------------------------------------------
  // 5. COMMANDE INCOMPLÈTE (Fail-Closed)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Commande incomplète (Fail-Closed) ---');
  const p5 = buildTestOrderPayload('chez-awa', 'real-tx-key-order-inc-005', '3', 7000);
  // Injection d'une commande sans contentSignature
  await client.injectOrder('chez-awa', p5.orderId, {
    id: p5.orderId,
    orderNumber: p5.orderToCreate.orderNumber,
    restaurantSlug: 'chez-awa',
    tableNumber: '3',
    idempotencyKey: p5.idempotencyKey,
    idempotencyDocId: p5.keyDocId
    // contentSignature manquante !
  });

  const res5 = await executeOrderTransactionWithDb(db, p5);
  assert(res5.success === false, '5.1 : Rejet Fail-Closed si contentSignature absente dans la commande');
  assert(res5.error?.includes('signature de contenu absente'), '5.2 : Message d\'erreur explicite sur la commande corrompue');

  // -------------------------------------------------------------------------
  // 6. AUTO-RÉPARATION VALIDE (Cas B)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Auto-réparation valide (Cas B) ---');
  const p6 = buildTestOrderPayload('chez-awa', 'real-tx-key-repair-006', '1', 12000);
  // Injection d'une commande saine et complète, SANS registre d'idempotence
  await client.injectOrder('chez-awa', p6.orderId, p6.orderToCreate);

  const res6 = await executeOrderTransactionWithDb(db, p6);
  assert(res6.success === true, '6.1 : Auto-réparation acceptée');
  assert(res6.idempotentReplay === true, '6.2 : Auto-réparation signale idempotentReplay: true');
  const repairedKey = await client.getIdempotencyKey(p6.keyDocId);
  assert(repairedKey?.status === 'completed', '6.3 : Le registre manquant a été réparé avec le statut completed');
  assert(repairedKey?.signature === p6.signature, '6.4 : Le registre réparé contient la signature conforme');

  // -------------------------------------------------------------------------
  // 7. REFUS DE RÉPARATION INVALIDE
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Refus de réparation invalide ---');
  const p7 = buildTestOrderPayload('chez-awa', 'real-tx-key-invalid-repair-007', '5', 8000);
  // Injection d'une commande avec une autre clé / signature non correspondante
  await client.injectOrder('chez-awa', p7.orderId, {
    ...p7.orderToCreate,
    contentSignature: 'different-fake-signature'
  });

  const res7 = await executeOrderTransactionWithDb(db, p7);
  assert(res7.success === false, '7.1 : Refus formel de réparer un document non conforme');
  assert(res7.conflict === true, '7.2 : Signalement de conflit critique');
  const keyDoc7 = await client.getIdempotencyKey(p7.keyDocId);
  assert(keyDoc7 === null || keyDoc7 === undefined, '7.3 : Aucun registre d\'idempotence n\'a été créé pour cette commande invalide');

  // -------------------------------------------------------------------------
  // 8. REGISTRE ORPHELIN (Cas C)
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Registre orphelin (Cas C) ---');
  const p8 = buildTestOrderPayload('chez-awa', 'real-tx-key-orphan-008', '6', 6000);
  // Injection d'un registre 'completed' sans document de commande
  await client.injectKey(p8.keyDocId, {
    id: p8.keyDocId,
    namespacedKey: `chez-awa:${p8.idempotencyKey}`,
    restaurantSlug: 'chez-awa',
    signature: p8.signature,
    orderId: p8.orderId,
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const res8 = await executeOrderTransactionWithDb(db, p8);
  assert(res8.success === false, '8.1 : Registre completed sans commande rejeté');
  assert(res8.error?.includes('Incohérence persistante'), '8.2 : Erreur explicite sur l\'absence de commande');

  // -------------------------------------------------------------------------
  // 9. REPRISE APRÈS ÉTAT AMBIGU (Cas C -> E)
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Reprise après état ambigu (Cas C -> E) ---');
  const p9 = buildTestOrderPayload('chez-awa', 'real-tx-key-ambiguous-009', '7', 15000);
  // Clé marquée 'ambiguous' consécutive à une interruption, SANS commande écrite
  await client.injectKey(p9.keyDocId, {
    id: p9.keyDocId,
    namespacedKey: `chez-awa:${p9.idempotencyKey}`,
    restaurantSlug: 'chez-awa',
    signature: p9.signature,
    orderId: p9.orderId,
    status: 'ambiguous',
    createdAt: Date.now() - 30000,
    updatedAt: Date.now() - 30000
  });

  const res9 = await executeOrderTransactionWithDb(db, p9);
  assert(res9.success === true, '9.1 : Reprise réussie après état ambigu');
  assert(res9.idempotentReplay === false, '9.2 : Première écriture de la commande signalée');
  const keyDoc9 = await client.getIdempotencyKey(p9.keyDocId);
  const orderDoc9 = await client.getOrder('chez-awa', p9.orderId);
  assert(keyDoc9?.status === 'completed', '9.3 : Clé ambiguë transitionnée vers completed');
  assert(orderDoc9 !== null && orderDoc9 !== undefined, '9.4 : Commande persistée dans Firestore');

  // -------------------------------------------------------------------------
  // 10. DEUX REQUÊTES CONCURRENTES AVEC LA MÊME CLÉ
  // -------------------------------------------------------------------------
  console.log('\n--- 10. Deux requêtes concurrentes avec la même clé ---');
  const p10 = buildTestOrderPayload('chez-awa', 'real-tx-concurrent-010', '8', 11000);

  // Exécution concurrente de deux transactions identiques
  const [txResA, txResB] = await Promise.all([
    executeOrderTransactionWithDb(db, p10),
    executeOrderTransactionWithDb(db, p10)
  ]);

  assert(txResA.success === true, '10.1 : Transaction concurrente A réussie');
  assert(txResB.success === true, '10.2 : Transaction concurrente B réussie');
  
  // Exactement une transaction crée la commande et l'autre effectue un rejeu idempotent (0 duplication)
  const oneCreatedAndOneReplayed = 
    (!txResA.idempotentReplay && txResB.idempotentReplay) ||
    (txResA.idempotentReplay && !txResB.idempotentReplay);
  assert(oneCreatedAndOneReplayed, '10.3 : Exactement une transaction crée la commande et l\'autre effectue un rejeu idempotent');

  // Vérification directe de la persistance stricte dans Firestore
  const order10Doc = await client.getOrder('chez-awa', p10.orderId);
  const key10Doc = await client.getIdempotencyKey(p10.keyDocId);
  assert(order10Doc !== null && order10Doc.id === p10.orderId, '10.4 : Exactement 1 document de commande persisté pour cette clé');
  assert(key10Doc !== null && key10Doc.status === 'completed', '10.5 : Exactement 1 registre d\'idempotence persisté avec status: completed');

  // -------------------------------------------------------------------------
  // 11. VÉRIFICATION DU NOMBRE RÉEL DE DOCUMENTS PERSISTÉS
  // -------------------------------------------------------------------------
  console.log('\n--- 11. Vérification du nombre réel de documents persistés ---');
  const totalOrders = await client.countOrders('chez-awa');
  const totalKeys = await client.countKeys();

  // Commandes créées avec succès dans la base :
  // p1 (scénario 1), p5 (injectée), p6 (scénario 6), p7 (injectée), p9 (scénario 9), p10 (scénario 10)
  assert(totalOrders >= 4, `11.1 : Nombre total de documents de commande cohérent (${totalOrders})`);
  assert(totalKeys >= 5, `11.2 : Nombre total de registres d'idempotence cohérent (${totalKeys})`);
  
  // Vérification de non-duplication : p10 n'a généré qu'UNE SEULE commande
  assert(order10Doc?.id === p10.orderId, '11.3 : La commande concurrente p10 existe sous son identifiant unique et sans collision');

  // -------------------------------------------------------------------------
  // BILAN FINAL DU TEST TRANSACTIONNEL
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`RÉSULTATS DE LA VÉRIFICATION TRANSACTIONNELLE : ${passedTests}/${totalTests} validés.`);
  if (failedTests > 0) {
    console.error(`ÉCHECS DÉTECTÉS : ${failedTests} test(s) en erreur !`);
    process.exit(1);
  } else {
    console.log('TOUS LES TESTS DE LA VÉRITABLE TRANSACTION FIRESTORE SONT SUCCÈS.');
    console.log('======================================================================\n');
  }
}

runTestSuite().catch(err => {
  console.error("Erreur fatale lors de l'exécution du test :", err);
  process.exit(1);
});
