import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
    'restaurants/chez-awa': { status: 'active' },
    'restaurants/chez-awa/private/ownership': { ownerUid: 'owner-1' },
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
assert.equal(db.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'applied');
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
assert.equal((await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'restored');
const cancellationAudit = [...restoreDb.documents.entries()].find(([path, value]) =>
  path.startsWith('restaurants/chez-awa/orderAudit/') && value.orderId === 'order-1');
assert.ok(cancellationAudit, 'L’annulation doit créer une entrée d’audit');
assert.equal(cancellationAudit[1].reason, 'Erreur de saisie');
assert.equal(cancellationAudit[1].status, 'cancelled');
assert.equal(cancellationAudit[1].actorUid, 'owner-1');
const restoreMovement = [...restoreDb.documents.entries()].find(([path, value]) => path.includes('/stockMovements/order_') && value.orderId === 'order-1' && value.delta > 0);
assert.equal(restoreMovement?.[1].delta, 0.5);
const cancelReplay = await transitionOrderStatusWithDb(restoreDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
assert.equal(cancelReplay.idempotentReplay, true);
assert.equal(restoreDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);

const noRecipe = base('pending', 10, false);
assert.equal((await transitionOrderStatusWithDb(noRecipe, { ...params, targetStatus: 'in_prep' })).success, true);
assert.equal(noRecipe.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(noRecipe.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'skipped');
assert.equal(noRecipe.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'skipped');

const menuStockRestoreDb = base('pending', 10, false);
menuStockRestoreDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].trackStock = true;
menuStockRestoreDb.documents.set('restaurants/chez-awa/menuItems/dish-1', {
  id: 'dish-1', restaurantSlug: 'chez-awa', name: 'Poulet braisé',
  trackStock: true, stockQuantity: 3, available: true
});
const menuCancel = await transitionOrderStatusWithDb(menuStockRestoreDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
assert.equal(menuCancel.success, true);
assert.equal(menuStockRestoreDb.documents.get('restaurants/chez-awa/menuItems/dish-1').stockQuantity, 5,
  'L’annulation restitue les portions du menu décrémentées à la commande');
const menuRestoration = menuStockRestoreDb.documents.get('restaurants/chez-awa/menuStockRestorations/order-1');
assert.equal(menuRestoration.items[0].quantity, 2, 'La restitution du stock menu est journalisée une fois');
const menuCancelReplay = await transitionOrderStatusWithDb(menuStockRestoreDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
assert.equal(menuCancelReplay.idempotentReplay, true);
assert.equal(menuStockRestoreDb.documents.get('restaurants/chez-awa/menuItems/dish-1').stockQuantity, 5,
  'Un rejeu de l’annulation ne restitue pas les quantités une seconde fois');

const deferredMenuDb = base('pending', 10, false);
deferredMenuDb.documents.get('restaurants/chez-awa/orders/order-1').menuStockDeferred = true;
deferredMenuDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].trackStock = true;
deferredMenuDb.documents.set('restaurants/chez-awa/menuItems/dish-1', {
  id: 'dish-1', restaurantSlug: 'chez-awa', name: 'Poulet braisé',
  trackStock: true, stockQuantity: 3, available: true
});
const deferredStart = await transitionOrderStatusWithDb(deferredMenuDb, { ...params, targetStatus: 'in_prep' });
assert.equal(deferredStart.success, true);
assert.equal(deferredMenuDb.documents.get('restaurants/chez-awa/menuItems/dish-1').stockQuantity, 1,
  'Le stock vendable est consommé uniquement lorsque le personnel démarre la préparation');
assert.equal(deferredMenuDb.documents.get('restaurants/chez-awa/menuStockConsumptions/order-1').items[0].quantity, 2);
assert.equal((await transitionOrderStatusWithDb(deferredMenuDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(deferredMenuDb.documents.get('restaurants/chez-awa/menuItems/dish-1').stockQuantity, 3,
  'Une annulation après acceptation restitue le stock consommé');

const deferredPendingCancelDb = base('pending', 10, false);
deferredPendingCancelDb.documents.get('restaurants/chez-awa/orders/order-1').menuStockDeferred = true;
deferredPendingCancelDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].trackStock = true;
deferredPendingCancelDb.documents.set('restaurants/chez-awa/menuItems/dish-1', {
  id: 'dish-1', restaurantSlug: 'chez-awa', name: 'Poulet braisé',
  trackStock: true, stockQuantity: 3, available: true
});
assert.equal((await transitionOrderStatusWithDb(deferredPendingCancelDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(deferredPendingCancelDb.documents.get('restaurants/chez-awa/menuItems/dish-1').stockQuantity, 3,
  'Une commande encore en attente n’a jamais consommé le stock et ne le restitue pas artificiellement');

const cashierDb = base();
cashierDb.documents.set('managers/cashier-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'cashier', permissions: ['orders.cancel'], sessionVersion: 4
});
const cashierCancel = await transitionOrderStatusWithDb(cashierDb, {
  ...params, actorUid: 'cashier-1', targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie'
});
assert.equal(cashierCancel.success, true);
const kitchenClearDb = base();
kitchenClearDb.documents.set('managers/kitchen-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'kitchen',
  permissions: ['kitchen.access', 'orders.clear_pending'], sessionVersion: 4
});
const kitchenClear = await transitionOrderStatusWithDb(kitchenClearDb, {
  ...params, actorUid: 'kitchen-1', targetStatus: 'cancelled', cancellationReason: 'Ticket erroné'
});
assert.equal(kitchenClear.success, true, 'Un membre Cuisine autorisé peut vider un ticket en attente');
assert.equal(kitchenClearDb.documents.get('restaurants/chez-awa/orders/order-1').status, 'cancelled');
assert.ok([...kitchenClearDb.documents.entries()].some(([path, value]) =>
  path.startsWith('restaurants/chez-awa/orderAudit/') && value.actorUid === 'kitchen-1'));

const partialDb = base();
partialDb.documents.get('restaurants/chez-awa/orders/order-1').items.push({ id: 'line-2', menuItemId: 'dish-untracked', quantity: 1 });
partialDb.documents.get('restaurants/chez-awa/orders/order-1').kitchenItemsCompletedCount = 2;
assert.equal((await transitionOrderStatusWithDb(partialDb, { ...params, targetStatus: 'in_prep' })).success, true);
assert.equal(partialDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'partial');
assert.equal(partialDb.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'partial');
assert.deepEqual(partialDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').untrackedItemIds, ['dish-untracked']);
assert.equal((await transitionOrderStatusWithDb(partialDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(partialDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10, 'Partial consumption restores only tracked ingredients');
assert.equal(partialDb.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'restored');

const customizedDb = base();
customizedDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].selectedExtras = [{ id: 'extra-cheese', name: 'Fromage' }];
assert.equal((await transitionOrderStatusWithDb(customizedDb, { ...params, targetStatus: 'in_prep' })).success, true);
assert.equal(customizedDb.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'partial', 'Custom extras without component recipes are flagged instead of silently omitted');
assert.deepEqual(customizedDb.documents.get('restaurants/chez-awa/orders/order-1').stockUntrackedItemIds, ['dish-1:extra:extra-cheese']);
assert.equal((await transitionOrderStatusWithDb(customizedDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(customizedDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
const mismatchedOwnerDb = base();
mismatchedOwnerDb.documents.set('managers/owner-2', { active: true, restaurantSlug: 'chez-awa', role: 'owner', sessionVersion: 4 });
assert.equal((await transitionOrderStatusWithDb(mismatchedOwnerDb, { ...params, actorUid: 'owner-2', targetStatus: 'in_prep' })).success, false, 'Owner role without ownerUid binding is rejected');

const managerDb = base();
managerDb.documents.set('managers/manager-1', { active: true, restaurantSlug: 'chez-awa', role: 'manager', permissions: ['orders.manage'], sessionVersion: 4 });
assert.equal((await transitionOrderStatusWithDb(managerDb, { ...params, actorUid: 'manager-1', targetStatus: 'in_prep' })).success, true);

const serverDb = base('ready');
serverDb.documents.get('restaurants/chez-awa/orders/order-1').assignedWaiterUid = 'server-1';
serverDb.documents.set('managers/server-1', { active: true, restaurantSlug: 'chez-awa', role: 'server', permissions: ['orders.serve'], sessionVersion: 4 });
assert.equal((await transitionOrderStatusWithDb(serverDb, { ...params, actorUid: 'server-1', targetStatus: 'completed' })).success, true,
  'A server can complete an order assigned to them');
serverDb.documents.set('managers/server-2', { active: true, restaurantSlug: 'chez-awa', role: 'server', permissions: ['orders.serve'], sessionVersion: 4 });
assert.equal((await transitionOrderStatusWithDb(serverDb, { ...params, actorUid: 'server-2', targetStatus: 'completed' })).success, false,
  'A server cannot complete an order assigned to another server');
const kitchenDb = base();
kitchenDb.documents.set('managers/kitchen-1', {
  active: true, restaurantSlug: 'chez-awa', role: 'kitchen', permissions: ['kitchen.access'], sessionVersion: 4
});
assert.equal((await transitionOrderStatusWithDb(kitchenDb, {
  ...params, actorUid: 'kitchen-1', targetStatus: 'in_prep'
})).success, true);

const customizationRecipesDb = base();
customizationRecipesDb.documents.set('restaurants/chez-awa/inventoryItems/oil', {
  id: 'oil', name: 'Huile', unit: 'L', quantity: 5, active: true
});
const recipeId = (type, menuId, groupId, targetId) =>
  createHash('sha256').update(`${type}:${menuId}:${groupId}:${targetId}`).digest('hex').slice(0, 32);
customizationRecipesDb.documents.set('restaurants/chez-awa/menuRecipes/dish-1', {
  menuItemId: 'dish-1', lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.25 }]
});
customizationRecipesDb.documents.set('restaurants/chez-awa/menuCustomizationRecipes/' + recipeId('option','dish-1','side','rice'), {
  customizationType: 'option', menuItemId: 'dish-1', groupId: 'side', optionId: 'rice',
  targetName: 'Accompagnement · Riz', lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.1 }]
});
customizationRecipesDb.documents.set('restaurants/chez-awa/menuCustomizationRecipes/' + recipeId('option','dish-1','cooking','grill'), {
  customizationType: 'option', menuItemId: 'dish-1', groupId: 'cooking', optionId: 'grill',
  targetName: 'Cuisson · Grillé', lines: [{ inventoryItemId: 'oil', itemName: 'Huile', unit: 'L', quantityPerDish: 0.05 }]
});
customizationRecipesDb.documents.set('restaurants/chez-awa/menuCustomizationRecipes/' + recipeId('extra','dish-1','','cheese'), {
  customizationType: 'extra', menuItemId: 'dish-1', extraId: 'cheese',
  targetName: 'Fromage', lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.05 }]
});
customizationRecipesDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].selectedOption = {
  groupId: 'side+cooking', optionId: 'rice+grill', groupName: 'Accompagnement / Cuisson',
  optionName: 'Riz / Grillé', extraPrice: 0
};
customizationRecipesDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].selectedExtras = [{ extraId: 'cheese', name: 'Fromage', price: 500 }];
const customizedStart = await transitionOrderStatusWithDb(customizationRecipesDb, { ...params, targetStatus: 'in_prep' });
assert.equal(customizedStart.success, true);
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 9.2);
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/inventoryItems/oil').quantity, 4.9);
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'applied');
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/orders/order-1').stockTrackingStatus, 'applied');
assert.equal((await transitionOrderStatusWithDb(customizationRecipesDb, { ...params, targetStatus: 'ready' })).success, true);
assert.equal((await transitionOrderStatusWithDb(customizationRecipesDb, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' })).success, true);
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/inventoryItems/rice').quantity, 10);
assert.equal(customizationRecipesDb.documents.get('restaurants/chez-awa/inventoryItems/oil').quantity, 5);

const missingCustomizationDb = base();
missingCustomizationDb.documents.get('restaurants/chez-awa/orders/order-1').items[0].selectedOption = {
  groupId: 'side', optionId: 'rice', groupName: 'Accompagnement', optionName: 'Riz', extraPrice: 0
};
const missingCustomization = await transitionOrderStatusWithDb(missingCustomizationDb, { ...params, targetStatus: 'in_prep' });
assert.equal(missingCustomization.success, true);
assert.equal(missingCustomizationDb.documents.get('restaurants/chez-awa/stockOrderConsumptions/order-1').status, 'partial');
assert(missingCustomizationDb.documents.get('restaurants/chez-awa/orders/order-1').stockUntrackedItemIds.includes('dish-1:option:side:rice'));

const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(source.includes("app.post('/api/order-status'"), 'Express exposes the transactional lifecycle API');
assert(api.includes("case 'order-status'") && api.includes('handleOrderStatusRequest(req.body, req)'), 'Central Vercel function exposes the transactional lifecycle API');
assert(client.includes("fetch('/api/order-status'"), 'the browser uses the trusted lifecycle API');
assert(rules.includes('allow update: if false;'), 'direct client order updates are disabled');
console.log('Order lifecycle stock consumption/restoration tests passed.');
