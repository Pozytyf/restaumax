import {
  processOrderSubmission,
  deriveIdempotencyIdentifiers,
  computeOrderSignature
} from '../src/server/orderService.ts';

let total = 0;
let passed = 0;

function assert(condition, message) {
  total++;
  if (!condition) {
    console.error(`  ✗ ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

const payload = {
  restaurantSlug: 'chez-awa',
  orderMode: 'a_emporter',
  tableNumber: null,
  idempotencyKey: 'order-errors-test-key-001',
  cart: [{ menuItemId: 'dish-test', quantity: 1 }]
};

const validProvider = {
  async getMenuItems() {
    return [{
      id: 'dish-test',
      restaurantSlug: 'chez-awa',
      name: 'Plat de test',
      category: 'plats',
      price: 2500,
      available: true,
      optionGroups: [],
      availableExtras: []
    }];
  },
  async getTables() {
    return [];
  }
};

console.log('\nRESTAUMAX — CLASSIFICATION DES RÉPONSES DE COMMANDE');

const replaySignature = computeOrderSignature(payload);
const replayIds = deriveIdempotencyIdentifiers(payload.restaurantSlug, payload.idempotencyKey);
const persistedOrder = {
  id: replayIds.orderId,
  orderNumber: replayIds.orderNumber,
  restaurantSlug: payload.restaurantSlug,
  idempotencyKey: payload.idempotencyKey,
  contentSignature: replaySignature,
  idempotencyDocId: replayIds.keyDocId,
  orderMode: payload.orderMode,
  tableNumber: null,
  items: [{ id: 'line-1', menuItemId: 'dish-test', name: 'Plat de test', quantity: 1, unitPrice: 2500, subtotal: 2500 }],
  totalAmount: 2500,
  status: 'pending',
  createdAt: Date.now()
};
let catalogReadDuringReplay = false;
const replay = await processOrderSubmission(payload, {
  ...validProvider,
  async getIdempotencyRecord() {
    return {
      id: replayIds.keyDocId,
      namespacedKey: `${payload.restaurantSlug}:${payload.idempotencyKey}`,
      restaurantSlug: payload.restaurantSlug,
      signature: replaySignature,
      orderId: replayIds.orderId,
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },
  async getOrderById() { return { status: 'found', order: persistedOrder }; },
  async getMenuItems() {
    catalogReadDuringReplay = true;
    return []; // Le plat a été désactivé après la création initiale.
  },
  async executeOrderTransaction(params) {
    return { success: true, order: params.orderToCreate, idempotentReplay: true };
  }
});
assert(
  replay.success === true && replay.idempotentReplay === true && catalogReadDuringReplay === false,
  'Une commande déjà persistée est rejouée même si le catalogue a changé depuis le premier envoi'
);

const rejected = await processOrderSubmission(payload, {
  ...validProvider,
  async getMenuItems() { return []; },
  async executeOrderTransaction() { throw new Error('must not be called'); }
});
assert(rejected.success === false && rejected.uncertain !== true, 'Un rejet de validation du catalogue est définitif et ne verrouille pas le panier');

const uncertainTransaction = await processOrderSubmission(payload, {
  ...validProvider,
  async executeOrderTransaction() { throw new Error('simulated connection reset'); }
});
assert(uncertainTransaction.success === false && uncertainTransaction.uncertain === true, 'Une erreur pendant la transaction est considérée comme incertaine');

const inProgress = await processOrderSubmission(payload, {
  ...validProvider,
  async executeOrderTransaction() {
    return { success: false, uncertain: true, error: 'already processing' };
  }
});
assert(inProgress.success === false && inProgress.uncertain === true, 'Une transaction concurrente en cours conserve la même intention');

console.log(`BILAN : ${passed}/${total} contrôles validés.\n`);
