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

let catalogReadAfterRegistryFailure = false;
const registryFailure = await processOrderSubmission(payload, {
  ...validProvider,
  async getIdempotencyRecord() { throw new Error('simulated registry read failure'); },
  async getOrderById() { return { status: 'not_found' }; },
  async getMenuItems() {
    catalogReadAfterRegistryFailure = true;
    return [];
  },
  async executeOrderTransaction() { throw new Error('must not be called'); }
});
assert(
  registryFailure.success === false && catalogReadAfterRegistryFailure === false,
  'Une erreur de lecture du registre d’idempotence bloque la validation et toute nouvelle création'
);

const multiOptionPayload = {
  ...payload,
  idempotencyKey: 'order-errors-multi-group-002',
  declaredTotal: 3300,
  cart: [{
    menuItemId: 'dish-test',
    quantity: 1,
    selectedOptions: [
      { groupId: 'grp-side', optionId: 'opt-rice', extraPrice: 99999 },
      { groupId: 'grp-cooking', optionId: 'opt-medium', extraPrice: 99999 }
    ]
  }]
};
const multiOptionResult = await processOrderSubmission(multiOptionPayload, {
  async getMenuItems() {
    return [{
      ...validProvider.getMenuItems && (await validProvider.getMenuItems())[0],
      optionGroups: [
        { id: 'grp-side', name: 'Accompagnement', required: true, options: [{ id: 'opt-rice', name: 'Riz', extraPrice: 500 }] },
        { id: 'grp-cooking', name: 'Cuisson', required: true, options: [{ id: 'opt-medium', name: 'À point', extraPrice: 300 }] }
      ]
    }];
  },
  async getTables() { return []; },
  async executeOrderTransaction(params) { return { success: true, order: params.orderToCreate }; }
});
assert(
  multiOptionResult.success === true && multiOptionResult.order?.totalAmount === 3300 && multiOptionResult.order.items[0].selectedOptions?.length === 2,
  'Les groupes obligatoires multiples sont acceptés et leurs prix sont recalculés depuis le catalogue'
);

const missingRequiredOption = await processOrderSubmission({
  ...multiOptionPayload,
  idempotencyKey: 'order-errors-missing-group-003',
  cart: [{ menuItemId: 'dish-test', quantity: 1, selectedOptions: [{ groupId: 'grp-side', optionId: 'opt-rice' }] }]
}, {
  async getMenuItems() {
    return [{
      ...validProvider.getMenuItems && (await validProvider.getMenuItems())[0],
      optionGroups: [
        { id: 'grp-side', name: 'Accompagnement', required: true, options: [{ id: 'opt-rice', name: 'Riz', extraPrice: 500 }] },
        { id: 'grp-cooking', name: 'Cuisson', required: true, options: [{ id: 'opt-medium', name: 'À point', extraPrice: 300 }] }
      ]
    }];
  },
  async getTables() { return []; },
  async executeOrderTransaction() { throw new Error('must not be called'); }
});
assert(missingRequiredOption.success === false, 'Le serveur refuse une commande à laquelle il manque un groupe obligatoire');

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
