import assert from 'node:assert/strict';
import { manageInventoryWithDb } from '../src/server/inventoryService.ts';
import fs from 'node:fs';

class FakeDb {
  constructor(seed = {}) { this.documents = new Map(Object.entries(seed)); }
  ref(path) {
    const db = this;
    return {
      path,
      collection(name) { return { doc(id) { return db.ref(path + '/' + name + '/' + id); } }; },
      async get() { const value = db.documents.get(path); return { exists: value !== undefined, data: () => value }; }
    };
  }
  collection(name) { return { doc: id => this.ref(name + '/' + id) }; }
  async runTransaction(callback) {
    const staged = [];
    const result = await callback({
      get: async ref => { const value = this.documents.get(ref.path); return { exists: value !== undefined, data: () => value }; },
      create: (ref, value) => staged.push(['create', ref.path, value]),
      update: (ref, value) => staged.push(['update', ref.path, value]),
      set: (ref, value) => staged.push(['set', ref.path, value])
    });
    if (result?.success === false) return result;
    for (const [kind, path, value] of staged) {
      if (kind === 'create' && this.documents.has(path)) throw new Error('duplicate create');
      this.documents.set(path, { ...(kind === 'update' || kind === 'set' ? this.documents.get(path) || {} : {}), ...value });
    }
    return result;
  }
}

const seed = new FakeDb({
  'restaurants/restaurant-a': { status: 'active', ownerUid: 'owner-a' },
  'restaurants/restaurant-b': { status: 'active', ownerUid: 'owner-b' },
  'managers/owner-a': { active: true, restaurantSlug: 'restaurant-a', role: 'owner', sessionVersion: 1 },
  'managers/owner-b': { active: true, restaurantSlug: 'restaurant-b', role: 'owner', sessionVersion: 1 },
  'managers/manager-a': { active: true, restaurantSlug: 'restaurant-a', role: 'manager', permissions: ['inventory.manage', 'menu.manage'], sessionVersion: 1 },
  'restaurants/restaurant-a/inventoryItems/rice': { id: 'rice', name: 'Riz', unit: 'kg', quantity: 10, minQuantity: 2, unitCost: 800, active: true },
  'restaurants/restaurant-b/inventoryItems/rice': { id: 'rice', name: 'Riz B', unit: 'kg', quantity: 7, minQuantity: 1, unitCost: 900, active: true },
  'restaurants/restaurant-a/menuItems/dish-a': { id: 'dish-a', restaurantSlug: 'restaurant-a', name: 'Poulet A', price: 2500 },
  'restaurants/restaurant-b/menuItems/dish-b': { id: 'dish-b', restaurantSlug: 'restaurant-b', name: 'Poisson B', price: 3000 }
});
const request = (restaurantSlug, actorUid, action, idempotencyKey) => ({
  restaurantSlug, actorUid, sessionVersion: 1, action,
  name: 'Huile', unit: 'L', quantity: 3, minQuantity: 1, unitCost: 1200, supplier: 'Test',
  idempotencyKey
});

const ownerACreateA = await manageInventoryWithDb(seed, request('restaurant-a', 'owner-a', 'create', 'owner-a-key-000001'));
assert.equal(ownerACreateA.success, true, 'Owner A can create stock only inside restaurant A');
const ownerACreateB = await manageInventoryWithDb(seed, request('restaurant-b', 'owner-a', 'create', 'owner-a-key-000002'));
assert.equal(ownerACreateB.success, false, 'Owner A is denied access to restaurant B');
const ownerBCreateB = await manageInventoryWithDb(seed, request('restaurant-b', 'owner-b', 'create', 'owner-b-key-000001'));
assert.equal(ownerBCreateB.success, true, 'Owner B can create stock inside restaurant B');
const managerACreateA = await manageInventoryWithDb(seed, request('restaurant-a', 'manager-a', 'create', 'manager-a-key-000001'));
assert.equal(managerACreateA.success, true, 'Manager A can manage stock inside restaurant A');
const managerACreateB = await manageInventoryWithDb(seed, request('restaurant-b', 'manager-a', 'create', 'manager-a-key-000002'));
assert.equal(managerACreateB.success, false, 'Manager A is denied access to restaurant B');

const recipeA = await manageInventoryWithDb(seed, {
  restaurantSlug: 'restaurant-a', actorUid: 'manager-a', sessionVersion: 1,
  action: 'save_recipe', menuItemId: 'dish-a',
  recipeLines: [{ inventoryItemId: 'rice', quantityPerDish: 0.25 }]
});
assert.equal(recipeA.success, true, 'Manager A can save a recipe for restaurant A');
const recipeB = await manageInventoryWithDb(seed, {
  restaurantSlug: 'restaurant-b', actorUid: 'manager-a', sessionVersion: 1,
  action: 'save_recipe', menuItemId: 'dish-b',
  recipeLines: [{ inventoryItemId: 'rice', quantityPerDish: 0.25 }]
});
assert.equal(recipeB.success, false, 'Manager A cannot save a recipe for restaurant B');
assert.equal(seed.documents.has('restaurants/restaurant-a/menuRecipes/dish-a'), true);
assert.equal(seed.documents.has('restaurants/restaurant-b/menuRecipes/dish-b'), false);
assert.equal(seed.documents.get('restaurants/restaurant-a/inventoryItems/rice').quantity, 10, 'Recipe creation does not mutate inventory quantity');
assert.equal(seed.documents.get('restaurants/restaurant-b/inventoryItems/rice').quantity, 7, 'Restaurant B stock remains untouched');

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert.match(rules, /member\.get\('restaurantSlug', ''\) == targetSlug/);
assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/restaurants\/\$\(targetSlug\)\)\.data\.ownerUid == request\.auth\.uid/);
assert.match(rules, /resource\.data\.get\('restaurantSlug', ''\) == restaurantSlug/);
console.log('Two-restaurant acceptance: two distinct owners, one scoped manager, inventory and recipe boundaries passed.');
