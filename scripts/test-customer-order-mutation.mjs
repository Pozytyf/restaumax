import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mutateCustomerOrderWithDb } from '../src/server/customerOrderService.ts';

class FakeDb {
  constructor(seed) { this.docs = new Map(Object.entries(seed)); this.counter = 0; }
  collection(name) {
    return { doc: id => ({
      path: `${name}/${id || `auto-${++this.counter}`}`,
      collection: child => ({ doc: childId => ({ path: `${name}/${id}/${child}/${childId}` }) })
    }) };
  }
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async ref => ({ exists: this.docs.has(ref.path), data: () => this.docs.get(ref.path) }),
      update: (ref, value) => writes.push(['update', ref.path, value]),
      create: (ref, value) => writes.push(['create', ref.path, value])
    };
    const result = await fn(tx);
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.docs.has(path)) throw new Error('duplicate audit');
      this.docs.set(path, { ...(kind === 'update' ? this.docs.get(path) : {}), ...value });
    }
    return result;
  }
}
const token = 'a'.repeat(64);
const hash = createHash('sha256').update(token).digest('hex');
const seed = (status = 'pending') => ({
  'restaurants/chez-awa': { status: 'active' },
  'restaurants/chez-awa/orders/order-1': {
    id: 'order-1', restaurantSlug: 'chez-awa', orderNumber: '#CMD-1',
    status, customerAccessTokenHash: hash, paidAmount: 0, refundedAmount: 0,
    taxRatePercent: 0, taxMode: 'exclusive', totalAmount: 2000,
    itemsCount: 2, items: [{ id: 'line-1', menuItemId: 'dish-1', name: 'Poulet',
      unitPrice: 1000, quantity: 2, totalPrice: 2000, category: 'grillades' }]
  }
});
const base = { restaurantSlug: 'chez-awa', orderId: 'order-1', accessToken: token };

const readDb = new FakeDb(seed());
const readResult = await mutateCustomerOrderWithDb(readDb, { ...base, action: 'get' });
assert.equal(readResult.success, true, 'Customer capability can retrieve its own order');
assert.equal(readResult.order.status, 'pending');
assert.equal('customerAccessTokenHash' in readResult.order, false, 'Public tracking never exposes the token digest');

const editDb = new FakeDb(seed());
const edited = await mutateCustomerOrderWithDb(editDb, {
  ...base, action: 'edit', items: [{ id: 'line-1', quantity: 3, prepNotes: 'Sans piment' }]
});
assert.equal(edited.success, true);
assert.equal(editDb.docs.get('restaurants/chez-awa/orders/order-1').items[0].quantity, 3);
assert.equal(editDb.docs.get('restaurants/chez-awa/orders/order-1').totalAmount, 3000);
assert.ok([...editDb.docs.entries()].some(([path, value]) => path.includes('/orderAudit/') && value.event === 'order.edited'));

const cancelDb = new FakeDb(seed());
const cancelled = await mutateCustomerOrderWithDb(cancelDb, { ...base, action: 'cancel', reason: 'Erreur de commande' });
assert.equal(cancelled.success, true);
assert.equal(cancelDb.docs.get('restaurants/chez-awa/orders/order-1').status, 'cancelled');
assert.equal(cancelDb.docs.get('restaurants/chez-awa/orders/order-1').cancellationReason, 'Erreur de commande');
assert.deepEqual(cancelDb.docs.get('restaurants/chez-awa/orders/order-1').statusHistory.map(event => event.status), ['pending', 'cancelled'], 'L’annulation client est ajoutée à la chronologie horodatée.');
assert.equal(cancelDb.docs.get('restaurants/chez-awa/orders/order-1').statusHistory[1].reason, 'Erreur de commande');
assert.ok([...cancelDb.docs.entries()].some(([path, value]) => path.includes('/orderAudit/') && value.event === 'order.cancelled'));

const preparedDb = new FakeDb(seed('in_prep'));
const prepared = await mutateCustomerOrderWithDb(preparedDb, { ...base, action: 'cancel', reason: 'Erreur client' });
assert.equal(prepared.success, false);
assert.match(prepared.error, /plus modifiable/);
assert.equal(preparedDb.docs.get('restaurants/chez-awa/orders/order-1').status, 'in_prep');

const wrongToken = await mutateCustomerOrderWithDb(new FakeDb(seed()), {
  ...base, accessToken: 'b'.repeat(64), action: 'cancel', reason: 'Erreur client'
});
assert.equal(wrongToken.success, false);
assert.match(wrongToken.error, /Accès/);

const paidDb = new FakeDb(seed());
paidDb.docs.get('restaurants/chez-awa/orders/order-1').paidAmount = 500;
const paid = await mutateCustomerOrderWithDb(paidDb, { ...base, action: 'edit', items: [{ id: 'line-1', quantity: 1 }] });
assert.equal(paid.success, false);
assert.match(paid.error, /déjà réglée/);


const stockDb = new FakeDb(seed());
const stockOrder = stockDb.docs.get('restaurants/chez-awa/orders/order-1');
stockOrder.items[0].trackStock = true;
stockDb.docs.set('restaurants/chez-awa/menuItems/dish-1', {
  id: 'dish-1', restaurantSlug: 'chez-awa', trackStock: true, available: true, stockQuantity: 2
});
const stockRejected = await mutateCustomerOrderWithDb(stockDb, {
  ...base, action: 'edit', items: [{ id: 'line-1', quantity: 3 }]
});
assert.equal(stockRejected.success, false, 'Customer edits cannot exceed currently available tracked stock');

const wrongRestaurant = await mutateCustomerOrderWithDb(new FakeDb({
  ...seed(), 'restaurants/chez-awa': { status: 'suspended' }
}), { ...base, action: 'cancel', reason: 'Erreur client' });
assert.equal(wrongRestaurant.success, false, 'Suspended restaurants reject customer mutations');
assert.equal((await mutateCustomerOrderWithDb(new FakeDb(seed()), {
  ...base, action: 'edit', items: [{ id: 'line-1', quantity: 0 }]
})).success, false, 'Zero quantity is rejected server-side');
const cancelPaidDb = new FakeDb(seed());
cancelPaidDb.docs.get('restaurants/chez-awa/orders/order-1').paidAmount = 100;
assert.equal((await mutateCustomerOrderWithDb(cancelPaidDb, {
  ...base, action: 'cancel', reason: 'Erreur client'
})).success, false, 'A paid order cannot be cancelled through the public capability');
assert.equal([...editDb.docs.keys()].filter(path => path.includes('/orderAudit/')).length, 1,
  'Customer edits are preserved in append-only audit history');
assert.equal([...cancelDb.docs.keys()].filter(path => path.includes('/orderAudit/')).length, 1,
  'Customer cancellation is preserved in append-only audit history');
const apiSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const routerSource = fs.readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const routeMapSource = fs.readFileSync(new URL('../src/server/apiRouteMap.ts', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/components/restaumax/ClientMenuView.tsx', import.meta.url), 'utf8');
const modalSource = fs.readFileSync(new URL('../src/components/restaumax/OrderConfirmationModal.tsx', import.meta.url), 'utf8');
assert(apiSource.includes("app.post('/api/customer-orders'") && apiSource.includes('requestHasValidOrigin(req)'),
  'Customer mutation API is POST-only and origin protected');
assert(routerSource.includes("case 'customer-orders'") && routeMapSource.includes("id: 'customer-orders', path: 'customer-orders', methods: ['POST']"),
  'Vercel API router registers customer order capabilities');
assert(clientSource.includes('restaumax-last-order:') && clientSource.includes('Suivre ma commande'),
  'Customer can reopen its protected order tracking after closing the confirmation panel');
assert(modalSource.includes('Historique horodaté') && modalSource.includes('event.changedAt'), 'The customer ticket renders the persisted status timeline');
assert(modalSource.includes("onCustomerOrderMutation({ action: 'get' })") && modalSource.includes('window.setInterval'),
  'Order status refreshes from the token-protected API while the customer tracks it');
console.log('Customer order mutation regression: 10 scenarios passed.');

