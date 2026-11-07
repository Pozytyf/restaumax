import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateKitchenItemCompletionWithDb } from '../src/server/kitchenService.ts';

class FakeDb {
  constructor(seed = {}) { this.documents = new Map(Object.entries(seed)); }
  collection(name) {
    return {
      doc: id => ({
        path: `${name}/${id}`,
        collection: child => ({
          doc: childId => ({ path: `${name}/${id}/${child}/${childId}` })
        })
      })
    };
  }
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({
      get: async ref => {
        const value = this.documents.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
      update: (ref, value) => writes.push([ref.path, value])
    });
    for (const [path, value] of writes) {
      this.documents.set(path, { ...(this.documents.get(path) || {}), ...value });
    }
    return result;
  }
}

const base = () => new FakeDb({
  'restaurants/chez-awa': { status: 'active', ownerUid: 'owner-1' },
  'managers/owner-1': { active: true, restaurantSlug: 'chez-awa', role: 'owner', sessionVersion: 3 },
  'restaurants/chez-awa/orders/order-1': {
    id: 'order-1', restaurantSlug: 'chez-awa', status: 'in_prep',
    items: [{ id: 'line-1', name: 'Poulet', quantity: 1 }, { id: 'line-2', name: 'Attiéké', quantity: 1 }]
  }
});
const params = {
  restaurantSlug: 'chez-awa', orderId: 'order-1', itemId: 'ki-order-1-0',
  itemIndex: 0, completed: true, actorUid: 'owner-1', sessionVersion: 3
};

const db = base();
const first = await updateKitchenItemCompletionWithDb(db, params);
assert.equal(first.success, true);
assert.equal(first.completed, true);
assert.equal(first.idempotentReplay, false);
assert.equal(first.completedCount, 1);
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemCompletion['0'], true);
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemsCompletedCount, 1);

const secondLine = await updateKitchenItemCompletionWithDb(db, {
  ...params, itemId: 'ki-order-1-1', itemIndex: 1
});
assert.equal(secondLine.success, true);
assert.equal(secondLine.completedCount, 2);
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemsCompletedCount, 2);

const uncheckFirstLine = await updateKitchenItemCompletionWithDb(db, { ...params, completed: false });
assert.equal(uncheckFirstLine.success, true);
assert.equal(uncheckFirstLine.completedCount, 1);
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemsCompletedCount, 1);

const recheckFirstLine = await updateKitchenItemCompletionWithDb(db, params);
assert.equal(recheckFirstLine.success, true);
assert.equal(recheckFirstLine.completedCount, 2);
const replay = await updateKitchenItemCompletionWithDb(db, params);
assert.equal(replay.success, true);
assert.equal(replay.idempotentReplay, true);

const managerDb = base();
managerDb.documents.set('managers/manager-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'manager', permissions: ['orders.manage'], sessionVersion: 3
});
assert.equal((await updateKitchenItemCompletionWithDb(managerDb, { ...params, actorUid: 'manager-1' })).success, true);

const kitchenDb = base();
kitchenDb.documents.set('managers/kitchen-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'kitchen', permissions: ['kitchen.access'], sessionVersion: 3
});
assert.equal((await updateKitchenItemCompletionWithDb(kitchenDb, { ...params, actorUid: 'kitchen-1' })).success, true);

const pendingDb = base();
pendingDb.documents.set('restaurants/chez-awa/orders/order-1', {
  ...pendingDb.documents.get('restaurants/chez-awa/orders/order-1'), status: 'pending'
});
assert.equal((await updateKitchenItemCompletionWithDb(pendingDb, params)).success, true);

const cashierDb = base();
cashierDb.documents.set('managers/cashier-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'cashier', permissions: ['cash.manage'], sessionVersion: 3
});
assert.equal((await updateKitchenItemCompletionWithDb(cashierDb, { ...params, actorUid: 'cashier-1' })).success, false);
assert.equal((await updateKitchenItemCompletionWithDb(base(), { ...params, restaurantSlug: 'other-restaurant' })).success, false);
assert.equal((await updateKitchenItemCompletionWithDb(base(), { ...params, sessionVersion: 2 })).success, false);
assert.equal((await updateKitchenItemCompletionWithDb(base(), { ...params, itemId: 'ki-order-1-1' })).success, false);

const readyDb = base();
readyDb.documents.set('restaurants/chez-awa/orders/order-1', {
  ...readyDb.documents.get('restaurants/chez-awa/orders/order-1'), status: 'ready'
});
assert.equal((await updateKitchenItemCompletionWithDb(readyDb, params)).success, false);

const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const firebaseSource = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ticketProjectionSource = fs.readFileSync(new URL('../src/utils/kitchenTicket.ts', import.meta.url), 'utf8');
const kdsView = fs.readFileSync(new URL('../src/components/kds/KdsView.tsx', import.meta.url), 'utf8');
const rulesSource = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(serverSource.includes("app.post('/api/kitchen-item'"), 'Express exposes the KDS item endpoint');
assert(apiSource.includes("case 'kitchen-item'") && apiSource.includes('handleKitchenItemRequest(req.body, req)'), 'Central Vercel API router exposes the KDS item endpoint');
assert(firebaseSource.includes("fetch('/api/kitchen-item'"), 'Client persists KDS progress through the trusted API');
assert(appSource.includes('updateKitchenItemCompletionWithServerValidation('), 'KDS UI uses the trusted persistence helper');
assert(appSource.includes('err instanceof Error && err.message'), 'KDS surfaces the precise server-side stock or transition rejection');
const kdsStartHandler = appSource.indexOf('const handleToggleKdsItem');
const stockStartCall = appSource.indexOf("await updateOrderStatus(activeRestaurantSlug, orderId, 'in_prep')", kdsStartHandler);
const firstLinePersist = appSource.indexOf('updateKitchenItemCompletionWithServerValidation(', kdsStartHandler);
assert(kdsStartHandler > 0 && stockStartCall > kdsStartHandler && firstLinePersist > stockStartCall, 'The first KDS action starts preparation and checks stock before marking a line complete');
assert(appSource.includes("from './utils/kitchenTicket'"), 'App uses the shared order-to-ticket projection');
assert(ticketProjectionSource.includes('stockTrackingStatus: order.stockTrackingStatus'), 'KDS tickets receive the server-computed stock tracking state');
assert(kdsView.includes('STOCK PARTIEL') && kdsView.includes('STOCK NON SUIVI'), 'KDS visibly flags incomplete or missing recipe tracking');
assert(ticketProjectionSource.includes("completed: order.kitchenItemCompletion?.[String(index)] === true"), 'KDS state is restored from Firestore snapshots');
assert(ticketProjectionSource.includes('Options :') && ticketProjectionSource.includes('Suppléments :'), 'KDS projection preserves configured options and extras');
assert(kdsView.includes("if (ticket.status !== 'in_prep') return;"), 'KDS line progress is locked after the ticket is ready');
assert(kdsView.includes('if (!ticket.items.every(item => item.completed))'), 'KDS cannot dispatch a ticket with unfinished lines');
assert(rulesSource.includes('allow update: if false;'), 'Firestore prevents client-side status and KDS writes; the server validates completed lines');
console.log('KDS item progress service, API and transition checks passed.');
