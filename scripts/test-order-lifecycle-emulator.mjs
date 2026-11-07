import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  assert.equal((await orderRef.get()).data().stockTrackingStatus, 'applied');

  const ready = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'ready' });
  assert.equal(ready.success, true);
  const cancelled = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'cancelled' });
  assert.equal(cancelled.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Cancellation restores exactly the consumed quantity');
  assert.equal((await consumptionRef.get()).data().status, 'restored');
  assert.equal((await orderRef.get()).data().stockTrackingStatus, 'restored');

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

  const customOrderId = 'order-stock-customizations';
  const oilRef = restaurantRef.collection('inventoryItems').doc('oil');
  const customOrderRef = restaurantRef.collection('orders').doc(customOrderId);
  const customConsumptionRef = restaurantRef.collection('stockOrderConsumptions').doc(customOrderId);
  const recipeId = (type, menuId, groupId, targetId) =>
    createHash('sha256').update(`${type}:${menuId}:${groupId}:${targetId}`).digest('hex').slice(0, 32);
  await Promise.all([
    inventoryRef.update({ quantity: 5 }),
    oilRef.set({ id: 'oil', name: 'Huile', unit: 'L', quantity: 2, active: true }),
    restaurantRef.collection('menuCustomizationRecipes').doc(recipeId('option','dish-1','side','rice-option')).set({
      customizationType: 'option', menuItemId: 'dish-1', groupId: 'side', optionId: 'rice-option',
      targetName: 'Accompagnement · Riz',
      lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.1 }]
    }),
    restaurantRef.collection('menuCustomizationRecipes').doc(recipeId('extra','dish-1','','cheese')).set({
      customizationType: 'extra', menuItemId: 'dish-1', extraId: 'cheese', targetName: 'Fromage',
      lines: [{ inventoryItemId: 'oil', itemName: 'Huile', unit: 'L', quantityPerDish: 0.05 }]
    }),
    customOrderRef.set({
      id: customOrderId, restaurantSlug: slug, status: 'pending', kitchenItemsCompletedCount: 1,
      items: [{
        menuItemId: 'dish-1', quantity: 2,
        selectedOption: { groupId: 'side', optionId: 'rice-option', groupName: 'Accompagnement', optionName: 'Riz', extraPrice: 0 },
        selectedExtras: [{ extraId: 'cheese', name: 'Fromage', price: 500 }]
      }]
    })
  ]);
  const customStart = await transitionOrderStatusWithDb(db, { ...params, orderId: customOrderId, targetStatus: 'in_prep' });
  assert.equal(customStart.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 4.4, 'Main dish and option recipes both consume their exact quantities');
  assert.equal((await oilRef.get()).data().quantity, 1.9, 'Extra recipe consumes its component quantity');
  assert.equal((await customConsumptionRef.get()).data().status, 'applied', 'Mapped options and extras are fully tracked');
  const customReady = await transitionOrderStatusWithDb(db, { ...params, orderId: customOrderId, targetStatus: 'ready' });
  assert.equal(customReady.success, true);
  const customCancel = await transitionOrderStatusWithDb(db, { ...params, orderId: customOrderId, targetStatus: 'cancelled' });
  assert.equal(customCancel.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Cancellation restores base and option ingredients');
  assert.equal((await oilRef.get()).data().quantity, 2, 'Cancellation restores supplement ingredients');

  console.log('Order lifecycle Firestore Emulator transaction tests passed.');
} finally {
  await app.delete();
}
