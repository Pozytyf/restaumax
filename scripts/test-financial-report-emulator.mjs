import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getRestaurantFinancialReportWithDb } from '../src/server/reportService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de rapports financiers.');
  process.exit(1);
}
const app = initializeApp({ projectId: 'demo-restaumax' }, 'financial-report-emulator-test');
const db = getFirestore(app);
const now = Date.now();
const slug = 'financial-report-emulator';
const restaurantRef = db.collection('restaurants').doc(slug);
const createdAt = now - 1000;

try {
  await Promise.all([
    restaurantRef.set({ slug, status: 'active' }),
    restaurantRef.collection('orders').doc('order-report').set({
      id: 'order-report', status: 'completed', createdAt, totalAmount: 1180,
      subtotalAmount: 1000, taxAmount: 180, taxRatePercent: 18, taxMode: 'exclusive',
      paidAmount: 1180, refundedAmount: 180, stockTrackingStatus: 'applied',
      items: [{ name: 'Poulet braisé', quantity: 2 }]
    }),
    restaurantRef.collection('payments').doc('payment-report').set({
      id: 'payment-report', orderId: 'order-report', method: 'especes', paidAmount: 1180, createdAt
    }),
    restaurantRef.collection('refunds').doc('refund-report').set({
      id: 'refund-report', orderId: 'order-report', paymentId: 'payment-report', amount: 180, createdAt
    }),
    restaurantRef.collection('stockMovements').doc('movement-consume').set({
      orderId: 'order-report', delta: -0.5, unitCost: 500, createdAt
    }),
    restaurantRef.collection('stockMovements').doc('movement-restore').set({
      orderId: 'order-report', delta: 0.1, unitCost: 500, createdAt
    }),
    restaurantRef.collection('cashMovements').doc('expense-report').set({
      movementType: 'expense', amount: 100, category: 'achats', createdAt
    }),
    restaurantRef.collection('cashMovements').doc('withdrawal-report').set({
      movementType: 'withdrawal', amount: 50, category: 'retrait', createdAt
    }),
    restaurantRef.collection('cashSessions').doc('session-report').set({
      status: 'closed', openedAt: createdAt, variance: -50
    })
  ]);

  const report = await getRestaurantFinancialReportWithDb(db, slug, {
    periodDays: 30, includeCashDetails: true, now
  });
  assert.equal(report.orderCount, 1, 'Les commandes finalisées sont chargées depuis Firestore');
  assert.equal(report.grossCollected, 1000, 'Les remboursements sont déduits des encaissements');
  assert.equal(report.taxCollected, 153, 'La taxe nette est rapprochée au prorata des encaissements');
  assert.equal(report.netSales, 847, 'Les ventes HT sont calculées');
  assert.equal(report.costOfGoodsSold, 200, 'Les coûts de stock incluent les restaurations');
  assert.equal(report.grossProfit, 647, 'La marge brute est calculée');
  assert.equal(report.expenseTotal, 100, 'Les dépenses sont agrégées');
  assert.equal(report.operatingResult, 547, 'Le résultat après dépenses est calculé');
  assert.equal(report.cash.cashVariance, -50, 'Les écarts de clôture sont consolidés');
  assert.equal(report.cash.paymentMethodTotals.especes, 1000, 'Le moyen de paiement est rapproché après remboursement');

  const restricted = await getRestaurantFinancialReportWithDb(db, slug, {
    periodDays: 30, includeCashDetails: false, now
  });
  assert.equal(Object.hasOwn(restricted, 'cash'), false, 'Les détails de caisse ne sont pas renvoyés sans permission dédiée');
  await assert.rejects(
    () => getRestaurantFinancialReportWithDb(db, slug, { periodDays: 367, now }),
    /Période de rapport invalide/
  );

  console.log('Financial report Firestore Emulator tests passed: 12 assertions.');
} finally {
  await app.delete();
}
