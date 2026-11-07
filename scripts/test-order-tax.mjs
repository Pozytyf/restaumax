import assert from 'node:assert/strict';
import { calculateTaxBreakdown } from '../src/utils/pricing.ts';
import { processOrderSubmission } from '../src/server/orderService.ts';

let passed = 0;
const check = (condition, label) => {
  assert.equal(condition, true, label);
  passed += 1;
};

const exclusive = calculateTaxBreakdown(1000, 18, 'exclusive');
check(exclusive.subtotalAmount === 1000 && exclusive.taxAmount === 180 && exclusive.totalAmount === 1180,
  'Tax-exclusive mode adds tax to the pre-tax subtotal');
const inclusive = calculateTaxBreakdown(1180, 18, 'inclusive');
check(inclusive.subtotalAmount === 1180 && inclusive.taxAmount === 180 && inclusive.totalAmount === 1180,
  'Tax-inclusive mode extracts the tax portion without increasing the payable total');
check(calculateTaxBreakdown(1000, 0, 'exclusive').totalAmount === 1000, 'Zero rate preserves the subtotal');
assert.throws(() => calculateTaxBreakdown(1000, 101, 'exclusive'), /Taux de taxe invalide/);
passed += 1;
assert.throws(() => calculateTaxBreakdown(1000, 18, 'unknown'), /Mode de taxe invalide/);
passed += 1;

const catalog = [{
  id: 'dish-1', restaurantSlug: 'tax-test', name: 'Plat test', category: 'plats',
  price: 1000, description: '', imageUrl: '', available: true, prepTimeMinutes: 10
}];
const provider = (taxRatePercent, taxMode) => ({
  getMenuItems: async () => catalog,
  getTables: async () => [],
  getRestaurantTaxSettings: async () => ({ taxRatePercent, taxMode }),
  executeOrderTransaction: async ({ orderToCreate }) => ({ success: true, order: orderToCreate })
});
const makePayload = (key, declaredTotal) => ({
  restaurantSlug: 'tax-test',
  cart: [{ menuItemId: 'dish-1', quantity: 1 }],
  orderMode: 'a_emporter',
  tableNumber: null,
  idempotencyKey: key,
  ...(declaredTotal === undefined ? {} : { declaredTotal })
});

const exclusiveOrder = await processOrderSubmission(makePayload('tax-excl-0001', 1180), provider(18, 'exclusive'));
check(exclusiveOrder.success && exclusiveOrder.order?.subtotalAmount === 1000 &&
  exclusiveOrder.order?.taxRatePercent === 18 && exclusiveOrder.order?.taxAmount === 180 &&
  exclusiveOrder.order?.taxMode === 'exclusive' && exclusiveOrder.order?.totalAmount === 1180,
  'Server recalculates and snapshots the exclusive tax before order creation');
const inclusiveOrder = await processOrderSubmission(makePayload('tax-incl-0001', 1000), provider(18, 'inclusive'));
check(inclusiveOrder.success && inclusiveOrder.order?.taxAmount === 153 &&
  inclusiveOrder.order?.totalAmount === 1000 && inclusiveOrder.order?.taxMode === 'inclusive',
  'Server calculates the tax portion of an inclusive price');
const tampered = await processOrderSubmission(makePayload('tax-tamp-0001', 1000), provider(18, 'exclusive'));
check(tampered.success === false, 'A client-declared total that omits the server tax is rejected');
const invalidRate = await processOrderSubmission(makePayload('tax-invalid-001'), provider(101, 'exclusive'));
check(invalidRate.success === false, 'An invalid restaurant tax rate fails closed');

console.log('Tax calculation and server order tests: ' + passed + '/9 passed.');
