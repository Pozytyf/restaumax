import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateKitchenItemCompletionWithDb } from '../src/server/kitchenService.ts';

class FakeDb {
  constructor(seed = {}) { this.documents = new Map(Object.entries(seed)); }
  collection(name) {
    const base = name;
    return {
      doc: id => ({
        path: `${base}/${id}`,
        collection: child => ({
          doc: childId => ({ path: `${base}/${id}/${child}/${childId}` })
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
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemCompletion['0'], true);

const replay = await updateKitchenItemCompletionWithDb(db, params);
assert.equal(replay.success, true);
assert.equal(replay.idempotentReplay, true);

const managerDb = base();
managerDb.documents.set('managers/manager-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'manager', permissions: ['orders.manage'], sessionVersion: 3
});
const manager = await updateKitchenItemCompletionWithDb(managerDb, {
  ...params, actorUid: 'manager-1'
});
assert.equal(manager.success, true, 'manager with orders.manage can update KDS progress');

const kitchenDb = base();
kitchenDb.documents.set('managers/kitchen-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'kitchen', permissions: ['kitchen.access'], sessionVersion: 3
});
const kitchen = await updateKitchenItemCompletionWithDb(kitchenDb, {
  ...params, actorUid: 'kitchen-1'
});
assert.equal(kitchen.success, true, 'kitchen role with kitchen.access can update KDS progress');

const cashierDb = base();
cashierDb.documents.set('managers/cashier-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'cashier', permissions: ['cash.manage'], sessionVersion: 3
});
const cashier = await updateKitchenItemCompletionWithDb(cashierDb, {
  ...params, actorUid: 'cashier-1'
});
assert.equal(cashier.success, false);

const foreignDb = base();
const foreign = await updateKitchenItemCompletionWithDb(foreignDb, {
  ...params, restaurantSlug: 'other-restaurant'
});
assert.equal(foreign.success, false);

const staleSession = await updateKitchenItemCompletionWithDb(base(), {
  ...params, sessionVersion: 2
});
assert.equal(staleSession.success, false);

const wrongItem = await updateKitchenItemCompletionWithDb(base(), {
  ...params, itemId: 'ki-order-1-1'
});
assert.equal(wrongItem.success, false);

const completedOrderDb = base();
completedOrderDb.documents.set('restaurants/chez-awa/orders/order-1', {
  ...completedOrderDb.documents.get('restaurants/chez-awa/orders/order-1'), status: 'ready'
});
const closedPreparation = await updateKitchenItemCompletionWithDb(completedOrderDb, params);
assert.equal(closedPreparation.success, false);

const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../api/kitchen-item.ts', import.meta.url), 'utf8');
const firebaseSource = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const kdsView = fs.readFileSync(new URL('../src/components/kds/KdsView.tsx', import.meta.url), 'utf8');
assert(serverSource.includes("app.post('/api/kitchen-item'"), 'Local Express exposes the KDS item endpoint');
assert(apiSource.includes('handleKitchenItemRequest(req.body, req)'), 'Vercel API exposes the KDS item endpoint');
assert(firebaseSource.includes("fetch('/api/kitchen-item'"), 'Client persists KDS progress through the trusted API');
assert(appSource.includes('updateKitchenItemCompletionWithServerValidation('), 'KDS UI uses the trusted persistence helper');
assert(appSource.includes("completed: order.kitchenItemCompletion?.[String(idx)] === true"), 'Firestore KDS progress is restored when tickets resubscribe');
assert(kdsView.includes("if (ticket.status !== 'in_prep') return;"), 'KDS item progress is locked after the ticket is ready');
console.log('KDS item progress service and API: 14 assertions validées.');
