import { processOrderSubmission } from '../src/server/orderService.ts';

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
