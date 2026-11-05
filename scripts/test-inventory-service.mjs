import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { manageInventoryWithDb } from '../src/server/inventoryService.ts';

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
      create: (ref, value) => writes.push(['create', ref.path, value]),
      update: (ref, value) => writes.push(['update', ref.path, value]),
      set: (ref, value) => writes.push(['set', ref.path, value])
    });
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.documents.has(path)) throw new Error('already exists');
      this.documents.set(path, { ...(kind === 'update' || kind === 'set' ? this.documents.get(path) : {}), ...value });
    }
    return result;
  }
}

const seed = () => new FakeDb({
  'restaurants/chez-awa': { status: 'active', ownerUid: 'owner-1' },
  'managers/owner-1': { active: true, restaurantSlug: 'chez-awa', role: 'owner', sessionVersion: 2 },
  'restaurants/chez-awa/inventoryItems/rice': {
    id: 'rice', name: 'Riz', unit: 'kg', quantity: 10, minQuantity: 2, unitCost: 500, active: true
  }
});
const common = { restaurantSlug: 'chez-awa', actorUid: 'owner-1', sessionVersion: 2 };
const recipeSeed = () => {
  const db = seed();
  db.documents.set('restaurants/chez-awa/menuItems/grill-1', {
    id: 'grill-1', name: 'Poulet braisé', restaurantSlug: 'chez-awa'
  });
  return db;
};


const createDb = seed();
const create = await manageInventoryWithDb(createDb, {
  ...common, action: 'create', idempotencyKey: 'create-key-00000001',
  name: 'Huile', unit: 'L', quantity: 5, minQuantity: 1, unitCost: 1200, supplier: 'Fournisseur A'
});
assert.equal(create.success, true);
assert.equal(create.idempotentReplay, false);
assert.equal(createDb.documents.get(`restaurants/chez-awa/inventoryItems/${create.itemId}`).quantity, 5);
assert.equal(createDb.documents.get(`restaurants/chez-awa/stockMovements/initial_${create.itemId.slice(4)}`).quantityAfter, 5);

const createReplay = await manageInventoryWithDb(createDb, {
  ...common, action: 'create', idempotencyKey: 'create-key-00000001',
  name: 'Huile', unit: 'L', quantity: 5, minQuantity: 1, unitCost: 1200, supplier: 'Fournisseur A'
});
assert.equal(createReplay.success, true);
assert.equal(createReplay.idempotentReplay, true);
const createConflict = await manageInventoryWithDb(createDb, {
  ...common, action: 'create', idempotencyKey: 'create-key-00000001',
  name: 'Huile modifiée', unit: 'L', quantity: 5, minQuantity: 1, unitCost: 1200, supplier: 'Fournisseur A'
});
assert.equal(createConflict.success, false);


const updateDb = seed();
const update = await manageInventoryWithDb(updateDb, {
  ...common, action: 'update', itemId: 'rice', name: 'Riz parfumé', unit: 'kg',
  minQuantity: 3, unitCost: 650, supplier: 'Fournisseur B'
});
assert.equal(update.success, true);
assert.equal(updateDb.documents.get('restaurants/chez-awa/inventoryItems/rice').name, 'Riz parfumé');
assert.equal(updateDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(updateDb.documents.get('restaurants/chez-awa/inventoryItems/rice').unitCost, 650);

const unitChangeBlocked = await manageInventoryWithDb(seed(), {
  ...common, action: 'update', itemId: 'rice', name: 'Riz', unit: 'g',
  minQuantity: 2, unitCost: 500, supplier: ''
});
assert.equal(unitChangeBlocked.success, false);
const zeroStockDb = seed();
zeroStockDb.documents.set('restaurants/chez-awa/inventoryItems/rice', {
  ...zeroStockDb.documents.get('restaurants/chez-awa/inventoryItems/rice'), quantity: 0
});
const unitChangeAllowed = await manageInventoryWithDb(zeroStockDb, {
  ...common, action: 'update', itemId: 'rice', name: 'Riz', unit: 'g',
  minQuantity: 2000, unitCost: 500, supplier: ''
});
assert.equal(unitChangeAllowed.success, true);
assert.equal(zeroStockDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 0);

const moveDb = seed();
const moveParams = { ...common, action: 'move', itemId: 'rice', delta: -2.5, reason: 'Préparation service', idempotencyKey: 'movement-key-000001' };
const move = await manageInventoryWithDb(moveDb, moveParams);
assert.equal(move.success, true);
assert.equal(move.quantityBefore, 10);
assert.equal(move.quantityAfter, 7.5);
assert.equal(moveDb.documents.get('restaurants/chez-awa/stockMovements/mov_' + createHash('sha256').update('chez-awa:owner-1:movement-key-000001').digest('hex').slice(0,32)).quantityBefore, 10);

const replay = await manageInventoryWithDb(moveDb, moveParams);
assert.equal(replay.success, true);
assert.equal(replay.idempotentReplay, true);
assert.equal(moveDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 7.5);
const movementConflict = await manageInventoryWithDb(moveDb, {
  ...moveParams, delta: -3
});
assert.equal(movementConflict.success, false);


const overdraw = await manageInventoryWithDb(moveDb, {
  ...common, action: 'move', itemId: 'rice', delta: -100, reason: 'Sortie', idempotencyKey: 'movement-key-000002'
});
assert.equal(overdraw.success, false);
assert.equal(moveDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 7.5);

const cashierDb = seed();
cashierDb.documents.set('managers/cashier-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'cashier', permissions: ['inventory.manage'], sessionVersion: 2
});
const cashier = await manageInventoryWithDb(cashierDb, {
  ...common, actorUid: 'cashier-1', action: 'move', itemId: 'rice', delta: 1, reason: 'Test', idempotencyKey: 'movement-key-000003'
});
assert.equal(cashier.success, false);

const stale = await manageInventoryWithDb(seed(), {
  ...common, sessionVersion: 1, action: 'move', itemId: 'rice', delta: 1, reason: 'Test', idempotencyKey: 'movement-key-000004'
});
assert.equal(stale.success, false);

const archiveBlocked = await manageInventoryWithDb(seed(), { ...common, action: 'archive', itemId: 'rice' });
assert.equal(archiveBlocked.success, false);
const archiveDb = seed();
archiveDb.documents.set('restaurants/chez-awa/inventoryItems/rice', { ...archiveDb.documents.get('restaurants/chez-awa/inventoryItems/rice'), quantity: 0 });
const archive = await manageInventoryWithDb(archiveDb, { ...common, action: 'archive', itemId: 'rice' });
assert.equal(archive.success, true);
assert.equal(archiveDb.documents.get('restaurants/chez-awa/inventoryItems/rice').active, false);
const archiveReplay = await manageInventoryWithDb(archiveDb, { ...common, action: 'archive', itemId: 'rice' });
assert.equal(archiveReplay.idempotentReplay, true);

const recipeDb = recipeSeed();
const recipe = await manageInventoryWithDb(recipeDb, {
  ...common, action: 'save_recipe', menuItemId: 'grill-1',
  recipeLines: [{ inventoryItemId: 'rice', quantityPerDish: 0.25 }]
});
assert.equal(recipe.success, true);
assert.equal(recipe.lineCount, 1);
assert.equal(recipeDb.documents.get('restaurants/chez-awa/menuRecipes/grill-1').lines[0].unit, 'kg');
assert.equal(recipeDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10, 'saving a recipe must never change stock');
const duplicateRecipeIngredient = await manageInventoryWithDb(recipeSeed(), {
  ...common, action: 'save_recipe', menuItemId: 'grill-1',
  recipeLines: [
    { inventoryItemId: 'rice', quantityPerDish: 0.25 },
    { inventoryItemId: 'rice', quantityPerDish: 0.1 }
  ]
});
assert.equal(duplicateRecipeIngredient.success, false);
const forbiddenRecipe = await manageInventoryWithDb(recipeSeed(), {
  ...common, actorUid: 'cashier-1', action: 'save_recipe', menuItemId: 'grill-1',
  recipeLines: [{ inventoryItemId: 'rice', quantityPerDish: 0.25 }]
});
assert.equal(forbiddenRecipe.success, false);

const inventoryUi = fs.readFileSync(new URL('../src/components/restaumax/RestaurantAdminModuleView.tsx', import.meta.url), 'utf8');
const firebaseSource = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
assert(inventoryUi.includes('sessionStorage.getItem(storageKey)'), 'the UI reuses a pending movement key after a page reload');
assert(inventoryUi.includes('pendingMove?.idempotencyKey'), 'the UI reuses the exact idempotency key for an uncertain movement');
assert(inventoryUi.includes('pending-create:${restaurant.slug}') && inventoryUi.includes('sessionStorage.setItem(storageKey, inventoryCreateKey)'), 'create idempotency keys survive refreshes after ambiguous responses');
assert(inventoryUi.includes('!result.retryable'), 'definitive stock errors clear the pending retry key');
assert(inventoryUi.includes('updateInventoryItemWithServerValidation') && inventoryUi.includes('startEditInventoryItem(item)'), 'inventory metadata can be edited through the trusted API');
assert(firebaseSource.includes("action: 'update'"), 'the client helper routes metadata changes through the backend action');
assert(firebaseSource.includes('retryable: true'), 'network failures are distinguished from definitive stock rejections');
const recipePanel = fs.readFileSync(new URL('../src/components/restaumax/InventoryRecipePanel.tsx', import.meta.url), 'utf8');
assert(inventoryUi.includes('<InventoryRecipePanel restaurantSlug={restaurant.slug}'), 'stock module mounts the recipe management panel');
assert(recipePanel.includes('saveInventoryRecipeWithServerValidation'), 'recipe saves use the trusted backend API');
assert(recipePanel.includes('new Set(normalized.map(line => line.inventoryItemId)).size !== normalized.length'), 'duplicate ingredients are rejected in the UI');
assert(recipePanel.includes('no conversion'), 'recipe quantities explicitly avoid implicit unit conversion');
assert(recipePanel.includes('canManage && <form'), 'recipe editing is hidden from staff without inventory management permission');
assert(recipePanel.includes('Modifier la recette') && recipePanel.includes('setLines(recipe.lines.map'), 'saved recipe sheets can be loaded back into the editor');
console.log('Inventory service and retry-safe UI: tests passed.');
