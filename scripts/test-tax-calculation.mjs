import assert from 'node:assert/strict';
import { calculateOrderTax } from '../src/utils/pricing.ts';
import { processOrderSubmission } from '../src/server/orderService.ts';

let passed = 0;
const check = (condition, label) => {
  assert.ok(condition, label);
  passed += 1;
  console.log('  ✓ ' + label);
};

console.log('\n--- Calcul fiscal FCFA ---');
const zero = calculateOrderTax(1000, 0, 'exclusive');
check(zero.taxAmount === 0 && zero.totalAmount === 1000, 'Un taux nul ne modifie pas le total.');
const exclusive = calculateOrderTax(1000, 18, 'exclusive');
check(exclusive.subtotalAmount === 1000 && exclusive.taxAmount === 180 && exclusive.totalAmount === 1180,
  'Le mode HT ajoute la taxe au sous-total.');
const inclusive = calculateOrderTax(1180, 18, 'inclusive');
check(inclusive.subtotalAmount === 1000 && inclusive.taxAmount === 180 && inclusive.totalAmount === 1180,
  'Le mode TTC extrait la taxe sans augmenter le prix affiché.');
check(calculateOrderTax(999, 7.5, 'exclusive').taxAmount === 75, 'La taxe est arrondie au FCFA le plus proche.');
for (const invalid of [
  () => calculateOrderTax(-1, 18, 'exclusive'),
  () => calculateOrderTax(1000.5, 18, 'exclusive'),
  () => calculateOrderTax(1000, -1, 'exclusive'),
  () => calculateOrderTax(1000, 101, 'exclusive'),
  () => calculateOrderTax(1000, 18, 'other')
]) {
  let rejected = false;
  try { invalid(); } catch { rejected = true; }
  check(rejected, 'Une configuration fiscale invalide est refusée.');
}

console.log('\n--- Application fiscale côté serveur ---');
const catalog = [{
  id: 'dish-tax', restaurantSlug: 'tax-test', name: 'Plat test', price: 1000,
  description: '', imageUrl: '', available: true, prepTimeMinutes: 10,
  optionGroups: [], availableExtras: []
}];
const makeProvider = (taxRatePercent, taxMode) => ({
  async getMenuItems() { return catalog; },
  async getTables() { return []; },
  async getRestaurantTaxConfig() { return { taxRatePercent, taxMode }; }
});
const payload = (key, declaredTotal) => ({
  restaurantSlug: 'tax-test',
  cart: [{ menuItemId: 'dish-tax', quantity: 1 }],
  orderMode: 'a_emporter', tableNumber: null,
  idempotencyKey: key, declaredTotal
});
const ht = await processOrderSubmission(payload('tax-exclusive-0001', 1180), makeProvider(18, 'exclusive'));
check(ht.success === true && ht.order?.subtotalAmount === 1000 && ht.order?.taxAmount === 180 &&
  ht.order?.totalAmount === 1180 && ht.order?.taxMode === 'exclusive',
  'Le serveur persiste sous-total, taxe et total en mode HT.');
const ttc = await processOrderSubmission(payload('tax-inclusive-0001', 1000), makeProvider(18, 'inclusive'));
check(ttc.success === true && ttc.order?.subtotalAmount === 847 && ttc.order?.taxAmount === 153 &&
  ttc.order?.totalAmount === 1000 && ttc.order?.taxMode === 'inclusive',
  'Le serveur extrait la taxe du prix TTC sans la facturer deux fois.');
const tampered = await processOrderSubmission(payload('tax-tampered-0001', 1000), makeProvider(18, 'exclusive'));
check(tampered.success === false, 'Un total client qui omet la taxe ajoutée est rejeté.');
const invalidConfig = await processOrderSubmission(payload('tax-invalid-0001', 1000), makeProvider(140, 'exclusive'));
check(invalidConfig.success === false, 'Le serveur refuse un taux fiscal hors limites.');
const identifiedOrder = await processOrderSubmission({
  ...payload('tax-loyalty-identity-0001', 1000),
  customerName: 'Awa Traoré', customerPhone: '+225 07 00 00 00 00'
}, makeProvider(0, 'exclusive'));
check(identifiedOrder.success === true && identifiedOrder.order?.customerPhoneNormalized === '0700000000',
  'Le serveur normalise le téléphone client pour la fidélité.');
const invalidCustomer = await processOrderSubmission({
  ...payload('tax-loyalty-invalid-0001', 1000),
  customerName: 'Awa', customerPhone: '12345'
}, makeProvider(0, 'exclusive'));
check(invalidCustomer.success === false, 'Une identité fidélité incomplète ou un téléphone invalide est refusé.');

console.log('\nRésultats taxe et identité client : ' + passed + '/' + passed + ' réussis.');
