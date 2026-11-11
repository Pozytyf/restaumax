import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { transitionOrderStatusWithDb } from '../src/server/orderLifecycleService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de cycle de commande et de stock.');
  process.exit(1);
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
    inventoryRef.set({ id: 'rice', name: 'Riz', unit: 'kg', quantity: 5, unitCost: 500, active: true }),
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
  const cancelled = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
  assert.equal(cancelled.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Cancellation restores exactly the consumed quantity');
  assert.equal((await consumptionRef.get()).data().status, 'restored');
  assert.equal((await orderRef.get()).data().stockTrackingStatus, 'restored');

  const movementSnapshot = await restaurantRef.collection('stockMovements').where('orderId', '==', orderId).get();
  assert.equal(movementSnapshot.size, 2, 'One append-only consumption and one restoration movement are recorded');
  const replay = await transitionOrderStatusWithDb(db, { ...params, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
  assert.equal(replay.success && replay.idempotentReplay, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Repeated cancellation does not restore twice');

  const unknownPayOrderId = 'order-paydunya-unknown';
  const unknownPayIntentId = 'pdi_' + createHash('sha256').update('unknown-intent').digest('hex').slice(0, 32);
  const unknownPayOrderRef = restaurantRef.collection('orders').doc(unknownPayOrderId);
  const unknownPayIntentRef = restaurantRef.collection('paymentIntents').doc(unknownPayIntentId);
  await Promise.all([
    unknownPayOrderRef.set({
      id: unknownPayOrderId, restaurantSlug: slug, status: 'pending', paidAmount: 0,
      paymentStatus: 'unpaid', pendingPayDunyaIntentId: unknownPayIntentId,
      pendingPayDunyaAmount: 3600, items: [{ menuItemId: 'dish-1', quantity: 1 }]
    }),
    unknownPayIntentRef.set({
      id: unknownPayIntentId, orderId: unknownPayOrderId, amount: 3600,
      status: 'creation_unknown', currency: 'XOF'
    })
  ]);
  const unknownPayCancelled = await transitionOrderStatusWithDb(db, {
    ...params, orderId: unknownPayOrderId, targetStatus: 'cancelled',
    cancellationReason: 'Client abandonne sa commande'
  });
  const cancelledUnknownOrder = (await unknownPayOrderRef.get()).data();
  const cancelledUnknownIntent = (await unknownPayIntentRef.get()).data();
  assert.equal(unknownPayCancelled.success, true, 'An unpaid order with an unknown PayDunya invoice creation can be logically cancelled');
  assert.equal(cancelledUnknownOrder.status, 'cancelled');
  assert.equal(cancelledUnknownOrder.pendingPayDunyaIntentId, null);
  assert.equal(cancelledUnknownOrder.payDunyaReconciliationRequired, true);
  assert.equal(cancelledUnknownOrder.payDunyaIntentIdForReconciliation, unknownPayIntentId);
  assert.equal(cancelledUnknownIntent.status, 'order_cancelled_pending_manual_reconciliation');
  assert.equal(cancelledUnknownIntent.orderCancellationReason, 'Client abandonne sa commande');
  const unknownPayAudit = await restaurantRef.collection('orderAudit').where('orderId', '==', unknownPayOrderId).get();
  assert.equal(unknownPayAudit.size, 1, 'PayDunya-linked cancellation keeps one append-only audit event');

  const knownPayOrderId = 'order-paydunya-known';
  const knownPayIntentId = 'pdi_' + createHash('sha256').update('known-intent').digest('hex').slice(0, 32);
  await Promise.all([
    restaurantRef.collection('orders').doc(knownPayOrderId).set({
      id: knownPayOrderId, restaurantSlug: slug, status: 'pending', paidAmount: 0,
      paymentStatus: 'unpaid', pendingPayDunyaIntentId: knownPayIntentId,
      pendingPayDunyaAmount: 3000, items: [{ menuItemId: 'dish-1', quantity: 1 }]
    }),
    restaurantRef.collection('paymentIntents').doc(knownPayIntentId).set({
      id: knownPayIntentId, orderId: knownPayOrderId, amount: 3000,
      status: 'pending', invoiceToken: 'known-invoice-token', currency: 'XOF'
    })
  ]);
  const knownPayCancelled = await transitionOrderStatusWithDb(db, {
    ...params, orderId: knownPayOrderId, targetStatus: 'cancelled',
    cancellationReason: 'Test annulation facture connue'
  });
  assert.equal(knownPayCancelled.success, false, 'A PayDunya invoice with a known token cannot use the unknown-creation cancellation path');
  assert.equal((await restaurantRef.collection('orders').doc(knownPayOrderId).get()).data().status, 'pending');

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
    oilRef.set({ id: 'oil', name: 'Huile', unit: 'L', quantity: 2, unitCost: 1000, active: true }),
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
  const customConsumption = (await customConsumptionRef.get()).data();
  assert.equal(customConsumption.lines.every(line => Number.isFinite(line.unitCost)), true,
    'The consumption snapshot preserves historical unit costs for base dishes, options and extras');
  const customMovements = await restaurantRef.collection('stockMovements').where('orderId', '==', customOrderId).get();
  assert.equal(customMovements.docs.length, 2, 'Base and customization recipes aggregate movements by inventory item');
  assert.equal(customMovements.docs.every(doc => Number.isFinite(doc.data().unitCost)), true,
    'Each stock movement snapshots its unit cost for future margin reports');
  const customReady = await transitionOrderStatusWithDb(db, { ...params, orderId: customOrderId, targetStatus: 'ready' });
  assert.equal(customReady.success, true);
  const customCancel = await transitionOrderStatusWithDb(db, { ...params, orderId: customOrderId, targetStatus: 'cancelled', cancellationReason: 'Erreur de saisie' });
  assert.equal(customCancel.success, true);
  assert.equal((await inventoryRef.get()).data().quantity, 5, 'Cancellation restores base and option ingredients');
  assert.equal((await oilRef.get()).data().quantity, 2, 'Cancellation restores supplement ingredients');

  const serverUid = 'server-assigned-test';
  const otherServerUid = 'server-other-test';
  await Promise.all([
    db.collection('managers').doc(serverUid).set({
      active: true, restaurantSlug: slug, role: 'server', sessionVersion: 2,
      permissions: ['orders.view', 'tables.view', 'pos.access', 'orders.serve']
    }),
    db.collection('managers').doc(otherServerUid).set({
      active: true, restaurantSlug: slug, role: 'server', sessionVersion: 2,
      permissions: ['orders.view', 'tables.view', 'pos.access', 'orders.serve']
    }),
    restaurantRef.collection('orders').doc('order-server-assigned').set({
      id: 'order-server-assigned', restaurantSlug: slug, status: 'ready',
      tableNumber: '4', assignedWaiterUid: serverUid, items: []
    })
  ]);
  const assignedServe = await transitionOrderStatusWithDb(db, {
    restaurantSlug: slug, orderId: 'order-server-assigned', actorUid: serverUid,
    sessionVersion: 2, targetStatus: 'completed'
  });
  assert.equal(assignedServe.success, true, 'A server can complete an order assigned to their table');
  const foreignServe = await transitionOrderStatusWithDb(db, {
    restaurantSlug: slug, orderId: 'order-server-assigned', actorUid: otherServerUid,
    sessionVersion: 2, targetStatus: 'completed'
  });
  assert.equal(foreignServe.success, false, 'A server cannot complete an order assigned to another server');

  console.log('Order lifecycle Firestore Emulator transaction tests passed.');
} finally {
  await app.delete();
}
