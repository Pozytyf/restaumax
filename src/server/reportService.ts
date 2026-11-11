export interface FinancialReportInput {
  orders: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  refunds: Array<Record<string, any>>;
  stockMovements: Array<Record<string, any>>;
  cashMovements: Array<Record<string, any>>;
  cashSessions: Array<Record<string, any>>;
}

export interface FinancialReportOptions {
  startAt: number;
  endAt: number;
  includeCashDetails: boolean;
  eventWindow?: boolean;
}

export function resolveFinancialReportRange(
  now: number,
  periodDays: number,
  reportType: 'period' | 'daily' = 'period',
  selectedDate?: string
) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(periodDays) || periodDays < 1 || periodDays > 366) {
    throw new Error('Période de rapport invalide.');
  }
  if (reportType === 'daily') {
    const date = selectedDate || new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date de recette invalide.');
    const startAt = Date.parse(date + 'T00:00:00.000Z');
    if (!Number.isFinite(startAt) || new Date(startAt).toISOString().slice(0, 10) !== date) {
      throw new Error('Date de recette invalide.');
    }
    const todayStart = new Date(now).setUTCHours(0, 0, 0, 0);
    if (startAt > todayStart) throw new Error('La recette d’une date future ne peut pas être consultée.');
    return { startAt, endAt: startAt === todayStart ? now : startAt + 24 * 60 * 60 * 1000 - 1 };
  }
  return { startAt: now - periodDays * 24 * 60 * 60 * 1000, endAt: now };
}

const safeAmount = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
};

export function calculateRestaurantFinancialReport(
  input: FinancialReportInput,
  options: FinancialReportOptions
) {
  const completedOrders = input.orders.filter(order => order.status === 'completed');
  const completedIds = new Set(completedOrders.map(order => String(order.id || '')));
  const refundsByPayment = new Map<string, number>();
  const refundsByOrder = new Map<string, number>();
  for (const refund of input.refunds) {
    const paymentId = String(refund.paymentId || '');
    const orderId = String(refund.orderId || '');
    const amount = safeAmount(refund.amount);
    refundsByPayment.set(paymentId, (refundsByPayment.get(paymentId) || 0) + amount);
    refundsByOrder.set(orderId, (refundsByOrder.get(orderId) || 0) + amount);
  }

  const paidByOrder = new Map<string, number>();
  const paymentMethodTotals: Record<string, number> = {};
  for (const payment of input.payments) {
    const orderId = String(payment.orderId || '');
    if (!completedIds.has(orderId)) continue;
    const paid = safeAmount(payment.paidAmount);
    paidByOrder.set(orderId, (paidByOrder.get(orderId) || 0) + paid);
    const netPayment = options.eventWindow
      ? paid
      : Math.max(0, paid - (refundsByPayment.get(String(payment.id || '')) || 0));
    const method = String(payment.method || 'inconnu');
    paymentMethodTotals[method] = (paymentMethodTotals[method] || 0) + netPayment;
  }

  if (options.eventWindow) {
    for (const refund of input.refunds) {
      const method = String(refund.method || 'inconnu');
      paymentMethodTotals[method] = (paymentMethodTotals[method] || 0) - safeAmount(refund.amount);
    }
  }

  let grossCollected = 0;
  let taxCollected = 0;
  let netSales = 0;
  let completedPaidOrderCount = 0;
  const bestSellersMap = new Map<string, number>();
  const orderPaidNet = new Map<string, number>();
  for (const order of completedOrders) {
    const orderId = String(order.id || '');
    const total = safeAmount(order.totalAmount);
    const recordedPaid = paidByOrder.get(orderId);
    const paidBeforeRefund = recordedPaid === undefined
      ? (options.eventWindow && Number(order.createdAt || 0) < options.startAt ? 0 : safeAmount(order.paidAmount))
      : recordedPaid;
    const refunded = options.eventWindow
      ? (refundsByOrder.get(orderId) || 0)
      : Math.min(paidBeforeRefund, Math.max(refundsByOrder.get(orderId) || 0, safeAmount(order.refundedAmount)));
    const netPaid = options.eventWindow
      ? Math.min(total || paidBeforeRefund, paidBeforeRefund) - refunded
      : Math.max(0, Math.min(total || paidBeforeRefund, paidBeforeRefund) - refunded);
    orderPaidNet.set(orderId, netPaid);
    if (netPaid > 0) completedPaidOrderCount++;
    grossCollected += netPaid;
    const orderTax = safeAmount(order.taxAmount);
    const proportionalTax = total > 0 ? Math.round(orderTax * netPaid / total) : 0;
    const taxShare = options.eventWindow ? proportionalTax : Math.min(netPaid, proportionalTax);
    taxCollected += taxShare;
    netSales += options.eventWindow ? netPaid - taxShare : Math.max(0, netPaid - taxShare);
    // Les remboursements partiels ne précisent pas quels articles ont été
    // retournés : ne pas inventer des quantités fractionnaires. Une commande
    // totalement remboursée est exclue du classement des ventes nettes.
    if (netPaid > 0) {
      for (const line of Array.isArray(order.items) ? order.items : []) {
        const name = String(line.name || 'Article');
        const quantity = Math.max(0, Number(line.quantity) || 0);
        bestSellersMap.set(name, (bestSellersMap.get(name) || 0) + quantity);
      }
    }
  }

  let costOfGoodsSold = 0;
  let missingCostMovementCount = 0;
  let costMovementCount = 0;
  for (const movement of input.stockMovements) {
    const orderId = String(movement.orderId || '');
    if (!completedIds.has(orderId)) continue;
    const delta = Number(movement.delta);
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (movement.unitCost === undefined || movement.unitCost === null ||
        !Number.isFinite(Number(movement.unitCost)) || Number(movement.unitCost) < 0) {
      missingCostMovementCount++;
      continue;
    }
    costMovementCount++;
    costOfGoodsSold += -delta * Number(movement.unitCost);
  }
  costOfGoodsSold = Math.max(0, Math.round(costOfGoodsSold));
  const untrackedStockOrderCount = completedOrders.filter(order => !['applied'].includes(String(order.stockTrackingStatus || ''))).length;
  const grossProfit = Math.round(netSales - costOfGoodsSold);
  const grossMarginPercent = netSales > 0 ? Math.round((grossProfit / netSales) * 10000) / 100 : 0;

  const expenses = input.cashMovements.filter(movement => movement.movementType === 'expense');
  const withdrawals = input.cashMovements.filter(movement => movement.movementType === 'withdrawal');
  const expenseTotal = expenses.reduce((sum, movement) => sum + safeAmount(movement.amount), 0);
  const withdrawalTotal = withdrawals.reduce((sum, movement) => sum + safeAmount(movement.amount), 0);
  const operatingResult = grossProfit - expenseTotal;

  const closedSessions = input.cashSessions.filter(session => session.status === 'closed');
  const cashVariance = closedSessions.reduce((sum, session) => sum + Number(session.variance || 0), 0);
  const bestSellers = [...bestSellersMap.entries()]
    .sort((a,b) => b[1] - a[1]).slice(0, 10)
    .map(([name, quantity]) => ({ name, quantity }));

  return {
    period: { startAt: options.startAt, endAt: options.endAt },
    currency: 'XOF',
    orderCount: completedOrders.length,
    paidOrderCount: completedPaidOrderCount,
    grossCollected: Math.round(grossCollected),
    taxCollected: Math.round(taxCollected),
    netSales: Math.round(netSales),
    costOfGoodsSold,
    grossProfit,
    grossMarginPercent,
    expenseTotal: Math.round(expenseTotal),
    operatingResult: Math.round(operatingResult),
    costCoverageComplete: missingCostMovementCount === 0 && untrackedStockOrderCount === 0,
    untrackedStockOrderCount,
    costMovementCount,
    missingCostMovementCount,
    bestSellers,
    ...(options.includeCashDetails ? {
      cash: {
        paymentMethodTotals: Object.fromEntries(Object.entries(paymentMethodTotals).map(([key,value]) => [key, Math.round(value)])),
        expenseCount: expenses.length,
        expenseByCategory: expenses.reduce((acc: Record<string, number>, movement) => {
          const category = String(movement.category || 'Autres');
          acc[category] = (acc[category] || 0) + safeAmount(movement.amount);
          return acc;
        }, {}),
        withdrawalTotal: Math.round(withdrawalTotal),
        closedSessionCount: closedSessions.length,
        cashVariance: Math.round(cashVariance),
        sessionsWithVariance: closedSessions.filter(session => Number(session.variance || 0) !== 0).length
      }
    } : {})
  };
}

export async function getRestaurantFinancialReportWithDb(
  db: any,
  restaurantSlug: string,
  options: { periodDays?: number; includeCashDetails?: boolean; now?: number; reportType?: 'period' | 'daily'; date?: string } = {}
) {
  if (!db) throw new Error('Firestore indisponible.');
  const slug = String(restaurantSlug || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) throw new Error('Restaurant invalide.');
  const now = Number(options.now || Date.now());
  const reportType = options.reportType === 'daily' ? 'daily' : 'period';
  const periodDays = Number(options.periodDays || 30);
  // Côte d’Ivoire uses UTC+0; daily reporting is bounded by calendar midnight.
  const { startAt, endAt } = resolveFinancialReportRange(now, periodDays, reportType, options.date);
  const restaurantRef = db.collection('restaurants').doc(slug);
  // Paginer jusqu'à épuisement : une limite fixe silencieuse faussait les
  // rapports des restaurants ayant plus de 1 000 mouvements sur la période.
  const readAll = async (query: any, pageSize = 1000) => {
    const documents: any[] = [];
    let cursor: any = null;
    while (true) {
      let pageQuery = query.limit(pageSize);
      if (cursor) pageQuery = pageQuery.startAfter(cursor);
      const page = await pageQuery.get();
      documents.push(...page.docs);
      if (page.size < pageSize) break;
      cursor = page.docs[page.docs.length - 1];
    }
    return documents;
  };
  const ranged = (name: string) => restaurantRef.collection(name)
    .where('createdAt', '>=', startAt).where('createdAt', '<=', endAt)
    .orderBy('createdAt', 'desc');
  const cashSessionsQuery = restaurantRef.collection('cashSessions')
    .where('openedAt', '>=', startAt).where('openedAt', '<=', endAt)
    .orderBy('openedAt', 'desc');
  const [periodOrders, payments, refunds, stockMovements, cashMovements, cashSessions] = await Promise.all([
    readAll(ranged('orders')), readAll(ranged('payments')), readAll(ranged('refunds')),
    readAll(ranged('stockMovements')), readAll(ranged('cashMovements')),
    readAll(cashSessionsQuery)
  ]);
  // A payment made today can belong to an order created on a previous day
  // (split settlement). Load those referenced orders too, without expanding
  // the payment window beyond the selected report period.
  const periodOrderIds = new Set(periodOrders.map((doc: any) => doc.id));
  const linkedOrderIds = [...new Set([
    ...payments.map((doc: any) => String(doc.data()?.orderId || '')),
    ...refunds.map((doc: any) => String(doc.data()?.orderId || ''))
  ].filter(Boolean))]
    .filter((id: string) => !periodOrderIds.has(id));
  const linkedOrders = await Promise.all(linkedOrderIds.map((id: string) => restaurantRef.collection('orders').doc(id).get()));
  const ordersById = new Map<string, any>();
  for (const doc of [...periodOrders, ...linkedOrders]) if (doc.exists) ordersById.set(doc.id, doc);
  const report = calculateRestaurantFinancialReport({
    orders: [...ordersById.values()].map((doc: any) => ({ ...doc.data(), id: doc.id })),
    payments: payments.map((doc: any) => ({ ...doc.data(), id: doc.id })),
    refunds: refunds.map((doc: any) => ({ ...doc.data(), id: doc.id })),
    stockMovements: stockMovements.map((doc: any) => ({ ...doc.data(), id: doc.id })),
    cashMovements: cashMovements.map((doc: any) => ({ ...doc.data(), id: doc.id })),
    cashSessions: cashSessions.map((doc: any) => ({ ...doc.data(), id: doc.id }))
  }, { startAt, endAt, includeCashDetails: options.includeCashDetails === true, eventWindow: reportType === 'daily' });
  return report;
}
