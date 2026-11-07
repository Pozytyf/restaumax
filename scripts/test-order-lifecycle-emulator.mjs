import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { transitionOrderStatusWithDb } from '../src/server/orderLifecycleService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('Order lifecycle Firestore Emulator test skipped: emulator is not active.');
  process.exit(0);
}

const app = initializeApp({ projectId: 'demo-restaumax' }, 'order-lifecycle-emulator-test');
const db = getFirestore(app);
const slug = 'stock-lifecycle-emulator';
const orderId = 'order-stock-atomic';
const actorUid = 'owner-stock-test';
const restaurantRef = db.collection('restaurants').doc(slug);
const inventoryRef = restaurantRef.collection('inventoryItems').doc('rice');
const orderRef = restaurantRef.collection('orders').doc(orderId);
const recipeRef = restaurantRef.collection('menuRecipes').doc('dish-1');
const consumptionRef = restaurantRef.collection('stockOrderConsumptions').doc(orderId);
const params = { restaurantSlug: slug, orderId, actorUid, sessionVersion: 7 };

try {
  await Promise.all([
    restaurantRef.set({ status: 'active', ownerUid: actorUid, isActive: true }),
    db.collection('managers').doc(actorUid).set({
      active: true, restaurantSlug: slug, role: 'owner', sessionVersion: 7
    }),
    inventoryRef.set({ id: 'rice', name: 'Riz', unit: 'kg', quantity: 5, active: true }),
    recipeRef.set({
      menuItemId: 'dish-1',
      lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.2 }]
    }),
    orderRef.set({
      id: orderId, restaurantSlug: slug, status: 'pending',
      kitchenItemsCompletedCount: 1,
      items: [{ menuItemId: 'dish-1', quantity: 2 }]
    })
  ]);

  const [first, concurrentReplay] = await Promise.all([
    transitionOrderStatusWithDb(db, { ...params, targetStatus: 'in_prep' }),
    transitionOrderStatusWithDb(db, { ...params, targetStatus: 'in_prep' })
  ]);
  assert.equal(first.success && concurrentReplay.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 4.6, 'Concurrent start calls consume stock only once');
  assert.equal((await orderRef.get()).data().status, 'in_prep');
  assert.equal((await consumptionRef.get()).data().status, 'applied');

  const ready = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'ready' });
  assert.equal(ready.success, true);
  const cancelled = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'cancelled' });
  assert.equal(cancelled.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Cancellation restores exactly the consumed quantity');
  assert.equal((await consumptionRef.get()).data().status, 'restored');

  const movementSnapshot = await restaurantRef.collection('stockMovements').where('orderId', '==', orderId).get();
  assert.equal(movementSnapshot.size, 2, 'One append-only consumption and one restoration movement are recorded');
  const replay = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'cancelled' });
  assert.equal(replay.success && replay.idempotentReplay, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Repeated cancellation does not restore twice');

  const shortageId = 'order-stock-shortage';
  const shortageRef = restaurantRef.collection('orders').doc(shortageId);
  await Promise.all([
    inventoryRef.update({ quantity: 0.1 }),
    shortageRef.set({
      id: shortageId, restaurantSlug: slug, status: 'pending',
      items: [{ menuItemId: 'dish-1', quantity: 1 }]
    })
  ]);
  const shortage = await transitionOrderStatusWithDb(db, { ...params, orderId: shortageId, targetStatus: 'in_prep' });
  assert.equal(shortage.success, false, 'Insufficient stock refuses the preparation transition');
  assert.equal((await shortageRef.get()).data().status, 'pending', 'Order status remains unchanged after stock refusal');
  assert.equal((await inventoryRef.get()).data().quantity, 0.1, 'No partial stock movement is written');

  console.log('Order lifecycle Firestore Emulator transaction tests passed.');
} finally {
  await app.delete();
}
