import assert from 'node:assert/strict';
import { calculateRestaurantFinancialReport } from '../src/server/reportService.ts';

const report = calculateRestaurantFinancialReport({
  orders: [{
    id: 'order-1', status: 'completed', totalAmount: 1180, subtotalAmount: 1000,
    taxAmount: 180, paidAmount: 1180,
    items: [{ name: 'Poulet braisé', quantity: 2 }]
  }],
  payments: [
    { id: 'payment-cash', orderId: 'order-1', method: 'especes', paidAmount: 1000 },
    { id: 'payment-mobile', orderId: 'order-1', method: 'paydunya', paidAmount: 180 }
  ],
  refunds: [{ id: 'refund-1', orderId: 'order-1', paymentId: 'payment-cash', amount: 180 }],
  stockMovements: [
    { orderId: 'order-1', delta: -0.5, unitCost: 500 },
    { orderId: 'order-1', delta: 0.1, unitCost: 500 }
  ],
  cashMovements: [
    { movementType: 'expense', amount: 100, category: 'achats' },
    { movementType: 'withdrawal', amount: 50, category: 'retrait' }
  ],
  cashSessions: [{ status: 'closed', variance: -50 }]
}, { startAt: 1, endAt: 2, includeCashDetails: true });

assert.equal(report.grossCollected, 1000, 'Les remboursements sont déduits des encaissements.');
assert.equal(report.taxCollected, 153, 'La taxe nette est calculée au prorata du montant conservé.');
assert.equal(report.netSales, 847, 'Les ventes HT sont séparées des taxes.');
assert.equal(report.costOfGoodsSold, 200, 'Le coût de stock net tient compte des restaurations.');
assert.equal(report.grossProfit, 647, 'La marge brute déduit le coût des marchandises.');
assert.equal(report.grossMarginPercent, 76.39, 'Le taux de marge est calculé sur les ventes HT.');
assert.equal(report.expenseTotal, 100, 'Les dépenses sont séparées des retraits.');
assert.equal(report.operatingResult, 547, 'Le résultat opérationnel déduit les dépenses suivies.');
assert.equal(report.cash.paymentMethodTotals.especes, 820, 'Les remboursements sont affectés au moyen de paiement initial.');
assert.equal(report.cash.paymentMethodTotals.paydunya, 180, 'Les encaissements Mobile Money sont ventilés.');
assert.equal(report.cash.withdrawalTotal, 50, 'Les retraits ne sont pas comptés comme dépenses.');
assert.equal(report.cash.cashVariance, -50, 'Les écarts de clôture sont consolidés.');
assert.equal(report.bestSellers[0].quantity, 2, 'Les meilleures ventes sont agrégées par article.');

const limited = calculateRestaurantFinancialReport({
  orders: [], payments: [], refunds: [], stockMovements: [],
  cashMovements: [], cashSessions: []
}, { startAt: 1, endAt: 2, includeCashDetails: false });
assert.equal(Object.hasOwn(limited, 'cash'), false, 'Les détails de caisse sont omis sans permission dédiée.');

const missingCosts = calculateRestaurantFinancialReport({
  orders: [{ id: 'order-2', status: 'completed', totalAmount: 500, paidAmount: 500, items: [] }],
  payments: [{ id: 'p2', orderId: 'order-2', method: 'especes', paidAmount: 500 }],
  refunds: [], stockMovements: [{ orderId: 'order-2', delta: -1, unitCost: null }],
  cashMovements: [], cashSessions: []
}, { startAt: 1, endAt: 2, includeCashDetails: false });
assert.equal(missingCosts.costCoverageComplete, false, 'Les coûts historiques manquants sont signalés au lieu d’être inventés.');
assert.equal(missingCosts.missingCostMovementCount, 1);
const untrackedOrder = calculateRestaurantFinancialReport({
  orders: [{ id: 'order-3', status: 'completed', totalAmount: 500, paidAmount: 500, stockTrackingStatus: 'skipped', items: [] }],
  payments: [{ id: 'p3', orderId: 'order-3', method: 'especes', paidAmount: 500 }],
  refunds: [], stockMovements: [], cashMovements: [], cashSessions: []
}, { startAt: 1, endAt: 2, includeCashDetails: false });
assert.equal(untrackedOrder.costCoverageComplete, false, 'Les commandes sans recette suivie rendent la couverture de marge incomplète');
assert.equal(untrackedOrder.untrackedStockOrderCount, 1);

console.log('Financial report calculation tests passed: 18 assertions.');
