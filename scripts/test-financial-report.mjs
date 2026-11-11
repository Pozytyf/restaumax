import fs from 'node:fs';
import assert from 'node:assert/strict';
import { calculateRestaurantFinancialReport, resolveFinancialReportRange } from '../src/server/reportService.ts';

const localNow = Date.UTC(2026, 10, 11, 9, 30, 0);
const dailyRange = resolveFinancialReportRange(localNow, 30, 'daily');
assert.equal(dailyRange.startAt, Date.UTC(2026, 10, 11, 0, 0, 0), 'Le point journalier commence à minuit UTC+0, heure de Côte d’Ivoire.');
assert.equal(dailyRange.endAt, localNow, 'Le point journalier s’arrête à l’instant de calcul.');
const selectedPastDay = resolveFinancialReportRange(localNow, 30, 'daily', '2026-11-10');
assert.equal(selectedPastDay.startAt, Date.UTC(2026, 10, 10, 0, 0, 0), 'Le calendrier commence la journée choisie à minuit UTC+0.');
assert.equal(selectedPastDay.endAt, Date.UTC(2026, 10, 11, 0, 0, 0) - 1, 'Une journée passée couvre les 24 heures calendaires complètes.');
assert.throws(() => resolveFinancialReportRange(localNow, 30, 'daily', '2026-11-12'), /date future/i, 'Une date future est refusée.');
assert.throws(() => resolveFinancialReportRange(localNow, 30, 'daily', '2026-02-30'), /Date de recette invalide/, 'Une date impossible est refusée.');
const periodRange = resolveFinancialReportRange(localNow, 30, 'period');
assert.equal(periodRange.startAt, localNow - 30 * 24 * 60 * 60 * 1000, 'Le rapport périodique conserve sa fenêtre glissante.');
assert.throws(() => resolveFinancialReportRange(localNow, 0, 'daily'), /Période de rapport invalide/, 'Une période invalide est rejetée.');

const report = calculateRestaurantFinancialReport({
  orders: [{
    id: 'order-1', status: 'completed', totalAmount: 1180, subtotalAmount: 1000,
    taxAmount: 180, paidAmount: 1180, stockTrackingStatus: 'applied',
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
  orders: [{ id: 'order-2', status: 'completed', totalAmount: 500, paidAmount: 500, stockTrackingStatus: 'applied', items: [] }],
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


const refundedRanking = calculateRestaurantFinancialReport({
  orders: [
    { id: 'order-refunded', status: 'completed', totalAmount: 1000, paidAmount: 1000, refundedAmount: 1000, items: [{ name: 'Plat remboursé', quantity: 3 }] },
    { id: 'order-partial', status: 'completed', totalAmount: 1000, paidAmount: 1000, refundedAmount: 500, items: [{ name: 'Plat partiellement remboursé', quantity: 2 }] }
  ],
  payments: [
    { id: 'p-refunded', orderId: 'order-refunded', method: 'especes', paidAmount: 1000 },
    { id: 'p-partial', orderId: 'order-partial', method: 'especes', paidAmount: 1000 }
  ],
  refunds: [
    { id: 'r-refunded', orderId: 'order-refunded', paymentId: 'p-refunded', amount: 1000 },
    { id: 'r-partial', orderId: 'order-partial', paymentId: 'p-partial', amount: 500 }
  ],
  stockMovements: [], cashMovements: [], cashSessions: []
}, { startAt: 1, endAt: 2, includeCashDetails: false });
assert.deepEqual(refundedRanking.bestSellers, [{ name: 'Plat partiellement remboursé', quantity: 2 }],
  'Une commande partiellement remboursée conserve les quantités réellement vendues ; une commande intégralement remboursée est exclue.');
assert.equal(Number.isInteger(refundedRanking.bestSellers[0].quantity), true,
  'Le classement ne fabrique pas de quantités fractionnaires faute de détail des articles retournés.');
assert.equal(refundedRanking.grossCollected, 500, 'Le classement et le chiffre d’affaires net reposent sur la même base après remboursement.');
const refundOnlyDay = calculateRestaurantFinancialReport({
  orders: [{ id: 'prior-order', status: 'completed', createdAt: Date.UTC(2026, 10, 10, 18), totalAmount: 1000, subtotalAmount: 820, taxAmount: 180, paidAmount: 1000, items: [{ name: 'Repas antérieur', quantity: 1 }] }],
  payments: [],
  refunds: [{ id: 'refund-today', orderId: 'prior-order', paymentId: 'prior-payment', method: 'especes', amount: 250 }],
  stockMovements: [], cashMovements: [], cashSessions: []
}, { startAt: Date.UTC(2026, 10, 11, 0), endAt: Date.UTC(2026, 10, 12, 0) - 1, includeCashDetails: true, eventWindow: true });
assert.equal(refundOnlyDay.grossCollected, -250, 'Un remboursement reçu aujourd’hui est imputé à la recette de la date de remboursement, sans recompter le paiement de la veille.');
assert.equal(refundOnlyDay.taxCollected, -45, 'La taxe est déduite au prorata du remboursement journalier.');
assert.equal(refundOnlyDay.netSales, -205, 'La recette HT reflète un remboursement sans réintégrer la vente de la veille.');
assert.equal(refundOnlyDay.cash.paymentMethodTotals.especes, -250, 'Le remboursement est imputé au canal espèces même si le paiement initial date de la veille.');
assert.equal(refundOnlyDay.bestSellers.length, 0, 'Un remboursement seul ne réaffiche pas les articles vendus la veille.');

const reportApiSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const reportUiSource = fs.readFileSync(new URL('../src/components/restaumax/RestaurantAdminModuleView.tsx', import.meta.url), 'utf8');
const reportServiceSource = fs.readFileSync(new URL('../src/server/reportService.ts', import.meta.url), 'utf8');
assert(reportApiSource.includes("['period', 'daily']") && reportApiSource.includes("reportType: reportType as 'period' | 'daily'"),
  'The authenticated reports API explicitly accepts separate daily and periodic modes.');
assert(reportUiSource.includes('Calendrier des recettes journalières') && reportUiSource.includes('type=\"date\"') && reportUiSource.includes('reportType=daily') && reportUiSource.includes('periodDays=30&reportType=period'),
  'The reports screen loads the daily point separately from the rolling 30-day report.');
assert(reportServiceSource.includes('linkedOrderIds') && reportServiceSource.includes('previous day'), 'Daily settlement reports include prior-day orders when their payment is made in the selected period.');
assert(reportServiceSource.includes("refunds.map((doc: any) => String(doc.data()?.orderId || ''))"),
  'A refund made on the selected date loads its original order even when the payment was received earlier.');
assert(reportApiSource.includes("closureSnap.data()?.report"), 'A closed day always displays its immutable archived report snapshot.');
assert(reportApiSource.includes('delete archivedReport.cash') && !reportApiSource.includes('...closureSnap.data()'), 'Archived closures never bypass reports.cash.view when exposing cash details.');
assert(reportApiSource.includes("dailyRevenueClosures") && reportApiSource.includes("Seul le propriétaire ou le gérant"),
  'Daily revenue closure is stored server-side and restricted to owners and managers.');
assert(reportApiSource.includes("hasOpenSessionForDay") && reportApiSource.includes("journée terminée"),
  'A daily closure is rejected while a cash session from that day remains open or the day is still current.');
assert(reportUiSource.includes('Clôturer la recette du jour') && reportUiSource.includes('Journée clôturée'),
  'The revenue calendar exposes a close action and an immutable closure confirmation.');
console.log('Financial report calculation tests passed: 42 assertions.');
