import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { refundCashPaymentWithDb } from '../src/server/paymentService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de remboursement et fidélité.');
  process.exit(1);
}
const app = initializeApp({ projectId: 'demo-restaumax' }, 'loyalty-refund-emulator-test');
const db = getFirestore(app);
const slug = 'loyalty-refund-emulator';
const uid = 'cashier-loyalty-refund';
const orderId = 'order-loyalty-refund';
const paymentId = 'payment-loyalty-refund';
const restaurantRef = db.collection('restaurants').doc(slug);
const sessionId = 'cash-loyalty-refund-session';
const customerId = 'customer-loyalty-refund';
const awardLedgerId = 'order_' + createHash('sha256').update(orderId).digest('hex').slice(0, 32);

try {
  await Promise.all([
    restaurantRef.set({ slug, status: 'active', ownerUid: 'owner-loyalty-test' }),
    db.collection('managers').doc(uid).set({
      uid, role: 'cashier', restaurantSlug: slug, active: true, sessionVersion: 1,
      permissions: ['cash.manage', 'payments.refund']
    }),
    restaurantRef.collection('cashSessions').doc(sessionId).set({
      id: sessionId, status: 'active', openedByUid: uid, sessionVersion: 1, openingBalance: 0, cashCollected: 9500, cashOut: 0
    }),
    restaurantRef.collection('cashSessionActive').doc(uid).set({
      sessionId, status: 'active', openedByUid: uid
    }),
    restaurantRef.collection('orders').doc(orderId).set({
      id: orderId, restaurantSlug: slug, totalAmount: 9500, paidAmount: 9500,
      refundedAmount: 0, loyaltyPointsAwarded: 9, loyaltyPointsReversed: 0,
      loyaltyCustomerId: customerId, status: 'completed'
    }),
    restaurantRef.collection('payments').doc(paymentId).set({
      id: paymentId, restaurantSlug: slug, orderId, orderNumber: '#CMD-LOY',
      method: 'especes', paidAmount: 9500, refundedAmount: 0, currency: 'FCFA'
    }),
    restaurantRef.collection('customers').doc(customerId).set({
      id: customerId, name: 'Client fidélité', phoneNormalized: '0700000000', loyaltyPoints: 9
    }),
    restaurantRef.collection('loyaltyLedger').doc(awardLedgerId).set({
      id: awardLedgerId, orderId, customerId, points: 9, eligibleAmountFcfa: 9500
    })
  ]);

  const input = (amount, key) => ({
    restaurantSlug: slug, paymentId, actorUid: uid, sessionVersion: 1,
    amount, reason: 'Remboursement de test validé', idempotencyKey: key,
    cashDisbursementConfirmed: true
  });
  const first = await refundCashPaymentWithDb(db, input(4750, 'refund-loyalty-half-001'));
  assert.equal(first.success, true, 'Le remboursement partiel est enregistré');
  assert.equal((await restaurantRef.collection('customers').doc(customerId).get()).data().loyaltyPoints, 5,
    'Les points sont retirés proportionnellement au remboursement partiel');
  assert.equal((await restaurantRef.collection('orders').doc(orderId).get()).data().loyaltyPointsReversed, 4);

  const replay = await refundCashPaymentWithDb(db, input(4750, 'refund-loyalty-half-001'));
  assert.equal(replay.success && replay.idempotentReplay, true, 'Le rejeu du remboursement ne retire pas de points une seconde fois');

  const final = await refundCashPaymentWithDb(db, input(4750, 'refund-loyalty-final-002'));
  assert.equal(final.success, true, 'Le remboursement complémentaire est enregistré');
  assert.equal((await restaurantRef.collection('customers').doc(customerId).get()).data().loyaltyPoints, 0,
    'Un remboursement intégral annule tous les points gagnés sur la commande');
  assert.equal((await restaurantRef.collection('orders').doc(orderId).get()).data().loyaltyReversalStatus, 'reversed');
  const reversals = await restaurantRef.collection('loyaltyReversals').get();
  assert.equal(reversals.size, 2, 'Chaque remboursement possède une écriture de contrepassation');
  assert.equal(reversals.docs.reduce((sum, doc) => sum + doc.data().pointsRemoved, 0), 9);
  assert.equal((await restaurantRef.collection('cashSessions').doc(sessionId).get()).data().cashOut, 9500);

  console.log('Loyalty refund Firestore Emulator tests passed: 10 assertions.');
} finally {
  await app.delete();
}
