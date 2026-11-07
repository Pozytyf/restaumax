import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordCashPaymentWithDb } from '../src/server/paymentService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de fidélité et taxes.');
  process.exit(1);
}
const app = initializeApp({ projectId: 'demo-restaumax' }, 'loyalty-tax-base-emulator-test');
const db = getFirestore(app);
const slug = 'loyalty-tax-base-emulator';
const uid = 'cashier-tax-base';
const orderId = 'order-tax-base';
const restaurantRef = db.collection('restaurants').doc(slug);
const sessionId = 'cash-tax-base-session';

try {
  await Promise.all([
    restaurantRef.set({ slug, status: 'active', loyaltyFcfaPerPoint: 1000 }),
    db.collection('managers').doc(uid).set({
      uid, role: 'cashier', restaurantSlug: slug, active: true, sessionVersion: 1,
      permissions: ['cash.manage', 'cash.view']
    }),
    restaurantRef.collection('cashSessions').doc(sessionId).set({
      id: sessionId, status: 'active', openedByUid: uid, sessionVersion: 1,
      cashCollected: 0, paymentCount: 0, cashOut: 0
    }),
    restaurantRef.collection('cashSessionActive').doc(uid).set({
      sessionId, status: 'active', openedByUid: uid
    }),
    restaurantRef.collection('orders').doc(orderId).set({
      id: orderId, restaurantSlug: slug, orderNumber: '#CMD-TAX',
      totalAmount: 1180, subtotalAmount: 980, taxAmount: 200,
      paidAmount: 0, status: 'pending', customerName: 'Client Taxe',
      customerPhone: '+225 07 00 00 00 02', customerPhoneNormalized: '0700000002',
      items: [{ name: 'Plat TTC', quantity: 1, unitPrice: 1180 }]
    })
  ]);

  const payment = await recordCashPaymentWithDb(db, {
    restaurantSlug: slug, orderId, actorUid: uid, sessionVersion: 1,
    amountTendered: 1180, idempotencyKey: 'cash-tax-base-order-001'
  });
  assert.equal(payment.success, true, 'La commande TTC est entièrement encaissée');
  assert.equal(payment.order?.loyaltyPointsAwarded, undefined, 'La taxe ne génère aucun point de fidélité');
  const customers = await restaurantRef.collection('customers').where('phoneNormalized', '==', '0700000002').get();
  assert.equal(customers.empty, true, 'Aucun compte client fidélité n’est créé sous le seuil HT');
  const storedOrder = (await restaurantRef.collection('orders').doc(orderId).get()).data();
  assert.equal(storedOrder.taxAmount, 200, 'La taxe reste séparée dans la commande');
  assert.equal(storedOrder.totalAmount, 1180, 'Le total TTC est conservé');
  await restaurantRef.update({ loyaltyFcfaPerPoint: 0 });
  await restaurantRef.collection('orders').doc('order-invalid-loyalty-config').set({
    id: 'order-invalid-loyalty-config', restaurantSlug: slug, orderNumber: '#CMD-CONFIG',
    totalAmount: 2000, subtotalAmount: 2000, taxAmount: 0, paidAmount: 0,
    status: 'pending', customerName: 'Client Configuration',
    customerPhone: '07 00 00 00 03', customerPhoneNormalized: '0700000003',
    items: [{ name: 'Plat', quantity: 1, unitPrice: 2000 }]
  });
  const invalidConfigPayment = await recordCashPaymentWithDb(db, {
    restaurantSlug: slug, orderId: 'order-invalid-loyalty-config', actorUid: uid, sessionVersion: 1,
    amountTendered: 2000, idempotencyKey: 'cash-invalid-loyalty-config-001'
  });
  assert.equal(invalidConfigPayment.success, true, 'Une configuration fidélité invalide ne bloque pas un encaissement légitime');
  assert.equal(invalidConfigPayment.order?.loyaltyAwardStatus, 'skipped_invalid_amount_or_configuration');

  console.log('Loyalty tax-base Firestore Emulator tests passed: 7 assertions.');
} finally {
  await app.delete();
}
