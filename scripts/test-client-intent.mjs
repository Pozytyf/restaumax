/**
 * RESTAUMAX — Tests Automatisés de Persistance de l'Intention Client (sessionStorage)
 *
 * Vérifie :
 * 1. Sauvegarde conforme de l'intention avant soumission (cart, key, restaurantSlug, orderMode, table, note).
 * 2. Restauration exacte après rechargement du navigateur (simulation reload).
 * 3. Préservation stricte de la même clé d'idempotence et du panier lors d'une défaillance réseau / 5xx.
 * 4. Nettoyage strict de l'intention lors d'une confirmation de commande (200).
 * 5. Conservation de l'intention en état incertain lors d'un conflit d'intégrité (409), pour éviter un doublon.
 * 6. Résilience face à un stockage corrompu ou mal formé (Fail-Safe).
 * 7. Annulation explicite par l'utilisateur avec avertissement et réinitialisation.
 */

import {
  savePendingOrderIntent,
  loadPendingOrderIntent,
  clearPendingOrderIntent,
  updatePendingOrderIntentUncertainty,
  ORDER_INTENT_STORAGE_KEY
} from '../src/utils/orderIntentStorage.ts';

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

// Mock standard de sessionStorage pour l'environnement Node.js
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

// Initialisation de l'environnement global window
global.window = {
  sessionStorage: new MockSessionStorage()
};

async function runClientIntentTests() {
  console.log('======================================================================');
  console.log('RESTAUMAX — TESTS DE CONSERVATION DE L\'INTENTION DE COMMANDE CLIENT');
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Sauvegarde nominale avant soumission
  // -------------------------------------------------------------------------
  console.log('--- 1. Sauvegarde de l\'intention client ---');
  window.sessionStorage.clear();

  const testCart = [
    {
      id: 'cart-1',
      menuItemId: 'dish-poulet',
      name: 'Poulet Braisé Entier',
      quantity: 2,
      basePrice: 9500,
      unitPrice: 9500,
      totalLinePrice: 19000
    }
  ];

  const intent1 = {
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    cart: testCart,
    idempotencyKey: 'intent-key-client-alpha-001',
    customerNote: 'Bien cuit et sauce à part',
    timestamp: Date.now(),
    isUncertain: false
  };

  const savedOk = savePendingOrderIntent(intent1);
  assert(savedOk === true, '1.1 : Sauvegarde réussie dans sessionStorage');

  const rawStorage = window.sessionStorage.getItem(ORDER_INTENT_STORAGE_KEY);
  assert(rawStorage !== null, '1.2 : Clé de stockage présente dans sessionStorage');

  // -------------------------------------------------------------------------
  // 1.B Stockage indisponible : la sauvegarde doit échouer explicitement
  // -------------------------------------------------------------------------
  console.log('\n--- 1.B Stockage indisponible ---');
  const originalStorage = window.sessionStorage;
  window.sessionStorage = null;
  const unavailableSave = savePendingOrderIntent(intent1);
  assert(unavailableSave === false, '1.B.1 : Sauvegarde refusée si sessionStorage est indisponible');
  window.sessionStorage = originalStorage;

  // -------------------------------------------------------------------------
  // 2. Restauration de l'intention après rechargement du navigateur
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Restauration après rechargement (simulation F5 / reload) ---');
  const restored = loadPendingOrderIntent();

  assert(restored !== null, '2.1 : L\'intention est restaurée depuis sessionStorage');
  assert(restored?.idempotencyKey === 'intent-key-client-alpha-001', '2.2 : Clé d\'idempotence identique préservée');
  assert(restored?.restaurantSlug === 'chez-awa', '2.3 : Restaurant préservé (chez-awa)');
  assert(restored?.tableNumber === '4', '2.4 : Numéro de table préservé (Table 4)');
  assert(restored?.customerNote === 'Bien cuit et sauce à part', '2.5 : Note client préservée');
  assert(restored?.cart.length === 1, '2.6 : Nombre d\'articles préservé (1 article)');
  assert(restored?.cart[0].quantity === 2, '2.7 : Quantité de ligne préservée (2)');

  // -------------------------------------------------------------------------
  // 3. Gestion de l'état incertain (panne réseau / timeout)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Défaillance réseau et conservation de l\'état incertain ---');
  updatePendingOrderIntentUncertainty(true);

  const restoredUncertain = loadPendingOrderIntent();
  assert(restoredUncertain?.isUncertain === true, '3.1 : État incertain persisté dans sessionStorage');
  assert(restoredUncertain?.idempotencyKey === 'intent-key-client-alpha-001', '3.2 : Clé d\'idempotence rigoureusement inchangée');
  assert(restoredUncertain?.cart.length === 1, '3.3 : Panier verrouillé intact');

  // -------------------------------------------------------------------------
  // 4. Confirmation réussie (200 OK) : nettoyage complet
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Confirmation de commande (200 OK) : nettoyage strict ---');
  clearPendingOrderIntent();

  const restoredAfterConfirm = loadPendingOrderIntent();
  assert(restoredAfterConfirm === null, '4.1 : L\'intention est purgée de sessionStorage lors du succès confirmé');
  assert(window.sessionStorage.getItem(ORDER_INTENT_STORAGE_KEY) === null, '4.2 : Clé sessionStorage supprimée');

  // -------------------------------------------------------------------------
  // 5. Conflit d'intégrité (409) : conservation de l'intention
  // -------------------------------------------------------------------------
  console.log("\n--- 5. Conflit d'intégrité (409) : conservation de l'intention ---");
  savePendingOrderIntent({
    ...intent1,
    idempotencyKey: 'conflict-key-002',
    isUncertain: false
  });
  assert(loadPendingOrderIntent() !== null, '5.1 : Intention avant conflit présente');

  // Un conflit peut signaler qu'une commande antérieure existe déjà : ne jamais purger ni renouveler la clé automatiquement.
  updatePendingOrderIntentUncertainty(true);
  const afterConflict = loadPendingOrderIntent();
  assert(afterConflict !== null, '5.2 : Intention conservée après conflit 409');
  assert(afterConflict?.idempotencyKey === 'conflict-key-002', '5.3 : Clé d’idempotence inchangée après conflit 409');
  assert(afterConflict?.isUncertain === true, '5.4 : Intention verrouillée en état incertain après conflit 409');

  // -------------------------------------------------------------------------
  // 6. Résilience aux données corrompues (Fail-Safe)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Résilience aux corruptions de stockage (Fail-Safe) ---');
  // Cas 6.A : JSON invalide
  window.sessionStorage.setItem(ORDER_INTENT_STORAGE_KEY, 'invalid-json{{{');
  const fromCorruptedJson = loadPendingOrderIntent();
  assert(fromCorruptedJson === null, '6.1 : JSON corrompu renvoie null sans lancer d\'exception');
  assert(window.sessionStorage.getItem(ORDER_INTENT_STORAGE_KEY) === null, '6.2 : Clé corrompue automatiquement purgée');

  // Cas 6.B : Objet sans clé d'idempotence
  window.sessionStorage.setItem(ORDER_INTENT_STORAGE_KEY, JSON.stringify({ cart: [] }));
  const fromMissingKey = loadPendingOrderIntent();
  assert(fromMissingKey === null, '6.3 : Intention sans clé d\'idempotence rejetée');

  // Cas 6.C : Objet avec panier non array
  window.sessionStorage.setItem(ORDER_INTENT_STORAGE_KEY, JSON.stringify({ idempotencyKey: 'valid-k', cart: 'not-an-array' }));
  const fromInvalidCart = loadPendingOrderIntent();
  assert(fromInvalidCart === null, '6.4 : Intention avec panier corrompu rejetée');

  // -------------------------------------------------------------------------
  // 7. Abandon explicite par l'utilisateur
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Abandon volontaire par l\'utilisateur ---');
  savePendingOrderIntent({
    ...intent1,
    idempotencyKey: 'intent-to-abandon-007',
    isUncertain: true
  });
  assert(loadPendingOrderIntent()?.isUncertain === true, '7.1 : Intention incertaine active');

  // L'utilisateur clique sur "Abandonner et recommencer un nouveau panier"
  clearPendingOrderIntent();
  assert(loadPendingOrderIntent() === null, '7.2 : Intention purgée après confirmation d\'abandon');

  // -------------------------------------------------------------------------
  // BILAN
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`RÉSULTATS DE LA PERSISTANCE DE L'INTENTION : ${passedTests}/${totalTests} validés.`);
  if (failedTests > 0) {
    console.error(`ÉCHECS : ${failedTests} test(s) en erreur !`);
    process.exit(1);
  } else {
    console.log('TOUS LES TESTS DE PERSISTANCE DE L\'INTENTION CLIENT SONT VALIDÉS.');
    console.log('======================================================================\n');
  }
}

runClientIntentTests().catch(err => {
  console.error('Erreur inattendue dans les tests d\'intention :', err);
  process.exit(1);
});
