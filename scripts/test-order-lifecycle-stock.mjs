import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transitionOrderStatusWithDb } from '../src/server/orderLifecycleService.ts';

class FakeDb {
  constructor(seed = {}) { this.documents = new Map(Object.entries(seed)); }
  collection(name) {
    return { doc: id => ({
      path: `${name}/${id}`,
      collection: child => ({ doc: childId => ({ path: `${name}/${id}/${child}/${childId}` }) })
    }) };
  }
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: async ref => {
        const value = this.documents.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
      create: (ref, value) => writes.push(['create', ref.path, value]),
      update: (ref, value) => writes.push(['update', ref.path, value]),
      set: (ref, value) => writes.push(['set', ref.path, value])
    };
    const result = await callback(tx);
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.documents.has(path)) throw new Error('already exists');
      this.documents.set(path, { ...(kind === 'update' || kind === 'set' ? this.documents.get(path) || {} : {}), ...value });
    }
    return result;
  }
}

const base = (status = 'pending', quantity = 10, recipe = true) => {
  const seed = {
    'restaurants/chez-awa': { status: 'active', ownerUid: 'owner-1' },
    'managers/owner-1': { active: true, restaurantSlug: 'chez-awa', role: 'owner', sessionVersion: 4 },
    'restaurants/chez-awa/orders/order-1': {
      id: 'order-1', restaurantSlug: 'chez-awa', status, kitchenItemsCompletedCount: 1,
      items: [{ id: 'line-1', menuItemId: 'dish-1', quantity: 2 }]
    },
    'restaurants/chez-awa/inventoryItems/rice': {
      id: 'rice', name: 'Riz', unit: 'kg', quantity, active: true
    }
  };
  if (recipe) seed['restaurants/chez-awa/menuRecipes/dish-1'] = {
    menuItemId: 'dish-1', lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.25 }]
  };
  return new FakeDb(seed);
};
const params = { restaurantSlug: 'chez-awa', orderId: 'order-1', actorUid: 'owner-1', sessionVersion: 4 };

const db = base();
const start = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'in_prep' });
assert.equal(start.success, true);
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').status, 'in_prep');
assert.equal(db.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 9.5);
const consumption = db.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1');
assert.equal(consumption.status, 'applied');
assert.equal(consumption.lines[0].quantity, 0.5);
const replay = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'in_prep' });
assert.equal(replay.success, true);
assert.equal(replay.idempotentReplay, true);
assert.equal(db.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 9.5);

const insufficient = base('pending', 0.2);
const rejected = await transitionOrderStatusWithDb(insufficient, { ...params, targetStatus: 'in_prep' });
assert.equal(rejected.success, false);
assert.equal(insufficient.documents.get('restaurants/chez-awa/orders/order-1').status, 'pending');
assert.equal(insufficient.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 0.2);
assert.equal(insufficient.documents.has('restaurants/chez-awa/stockOrderConsumptions/order-1'), false);

const wrongUnit = base();
wrongUnit.documents.get('restaurants/chez-awa/menuRecipes/dish-1').lines[0].unit = 'g';
const unitRejected = await transitionOrderStatusWithDb(wrongUnit, { ...params, targetStatus: 'in_prep' });
assert.equal(unitRejected.success, false);
assert.equal(wrongUnit.documents.get('restaurants/chez-awa/orders/order-1').status, 'pending');

const restoreDb = base();
assert.equal((await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'in_prep' })).success, true);
assert.equal((await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'ready' })).success, true);
assert.equal((await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'cancelled' })).success, true);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'restored');
const restoreMovement = [...restoreDb.documents.entries()].find(([path, value]) => path.includes('/stockMovements/order_') && value.orderId === 'order-1' && value.delta > 0);
assert.equal(restoreMovement?.[1].delta, 0.5);
const cancelReplay = await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'cancelled' });
assert.equal(cancelReplay.idempotentReplay, true);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);

const noRecipe = base('pending', 10, false);
assert.equal((await transitionOrderStatusWithDb(noRecipe, { ...params, targetStatus: 'in_prep' })).success, true);
assert.equal(noRecipe.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(noRecipe.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'skipped');

const cashierDb = base();
cashierDb.documents.set('managers/cashier-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'cashier', permissions: ['orders.cancel'], sessionVersion: 4
});
const cashierCancel = await transitionOrderStatusWithDb(cashierDb, {
  ...params, actorUid: 'cashier-1', targetStatus: 'cancelled'
});
assert.equal(cashierCancel.success, true);
const kitchenDb = base();
kitchenDb.documents.set('managers/kitchen-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'kitchen', permissions: ['kitchen.access'], sessionVersion: 4
});
assert.equal((await transitionOrderStatusWithDb(kitchenDb, {
  ...params, actorUid: 'kitchen-1', targetStatus: 'in_prep'
})).success, true);

const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/order-status.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(source.includes("app.post('/api/order-status'"), 'Express exposes the transactional lifecycle API');
assert(api.includes('handleOrderStatusRequest(req.body, req)'), 'Vercel function exposes the transactional lifecycle API');
assert(client.includes("fetch('/api/order-status'"), 'the browser uses the trusted lifecycle API');
assert(rules.includes('allow update: if false;'), 'direct client order updates are disabled');
console.log('Order lifecycle stock consumption/restoration tests passed.');
