import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const clientMenu = read('../src/components/restaumax/ClientMenuView.tsx');
const cart = read('../src/components/restaumax/CartDrawer.tsx');
const intent = read('../src/utils/orderIntentStorage.ts');

for (const field of ['customerNote', 'customerName', 'customerPhone']) {
  assert(app.includes(`${field}: pendingOrderCustomer`),
    `App persists ${field} with the pending order intent`);
  assert(clientMenu.includes(`pendingCustomer${field === 'customerNote' ? 'Note' : field === 'customerName' ? 'Name' : 'Phone'}`),
    `ClientMenuView passes pending ${field} to CartDrawer`);
}
assert(cart.includes('initialCustomerNote') && cart.includes('initialCustomerName') && cart.includes('initialCustomerPhone'),
  'CartDrawer restores customer note and contact details');
assert(cart.includes('setCustomerNote(initialCustomerNote)') && cart.includes('setCustomerName(initialCustomerName)') &&
  cart.includes('setCustomerPhone(initialCustomerPhone)'),
  'CartDrawer synchronizes restored details after page reload');
assert(app.includes('setIsOrderUncertain(true);') && app.includes('updatePendingOrderIntentUncertainty(true);'),
  'An idempotency conflict locks the intent rather than generating a fresh key');
assert(!app.includes("// Conflit d'intégrité d'idempotence : l'ancienne intention est abandonnée"),
  'The conflict path no longer silently clears the prior idempotency key');
assert(intent.includes('customerNote') && intent.includes('customerName') && intent.includes('customerPhone'),
  'The storage contract supports all customer fields');

console.log('✓ L’interface restaure les données client et conserve la clé pendant une reprise ambiguë.');
