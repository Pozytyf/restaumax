import assert from 'node:assert/strict';
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
      update: (ref, value) => writes.push(['update', ref.path, value])
    });
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.documents.has(path)) throw new Error('already exists');
      this.documents.set(path, { ...(kind === 'update' ? this.documents.get(path) : {}), ...value });
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


const moveDb = seed();
const moveParams = { ...common, action: 'move', itemId: 'rice', delta: -2.5, reason: 'Préparation service', idempotencyKey: 'movement-key-000001' };
const move = await manageInventoryWithDb(moveDb, moveParams);
assert.equal(move.success, true);
assert.equal(move.quantityBefore, 10);
assert.equal(move.quantityAfter, 7.5);
assert.equal(moveDb.documents.get('restaurants/chez-awa/stockMovements/mov_' + (await import('node:crypto')).default.createHash('sha256').update('chez-awa:owner-1:movement-key-000001').digest('hex').slice(0,32)).quantityBefore, 10);

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

const archiveDb = seed();
const archive = await manageInventoryWithDb(archiveDb, { ...common, action: 'archive', itemId: 'rice' });
assert.equal(archive.success, true);
assert.equal(archiveDb.documents.get('restaurants/chez-awa/inventoryItems/rice').active, false);
const archiveReplay = await manageInventoryWithDb(archiveDb, { ...common, action: 'archive', itemId: 'rice' });
assert.equal(archiveReplay.idempotentReplay, true);

console.log('Inventory service: 9 scénarios validés.');
