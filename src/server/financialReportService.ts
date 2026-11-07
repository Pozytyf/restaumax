export interface FinancialReportInput {
  orders?: Array<Record<string, any>>;
  payments?: Array<Record<string, any>>;
  cashMovements?: Array<Record<string, any>>;
  stockConsumptions?: Array<Record<string, any>>;
}
export interface FinancialReport {
  completedOrders: number;
  grossOrderValueFcfa: number;
  collectedFcfa: number;
  outstandingFcfa: number;
  taxCollectedFcfa: number;
  costOfGoodsFcfa: number;
  grossMarginFcfa: number;
  expensesFcfa: number;
  withdrawalsFcfa: number;
  operatingResultFcfa: number;
  cashCollectedFcfa: number;
  otherCollectedFcfa: number;
  cashNetAfterMovementsFcfa: number;
  grossMarginPercent: number;
}

const amount = (value: unknown) => {
  const n = Number(value || 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

/** Pure, tenant-scoped financial aggregation. Values are FCFA integers. */
export function calculateFinancialReport(input: FinancialReportInput): FinancialReport {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const payments = Array.isArray(input.payments) ? input.payments : [];
  const movements = Array.isArray(input.cashMovements) ? input.cashMovements : [];
  const consumptions = Array.isArray(input.stockConsumptions) ? input.stockConsumptions : [];

  const completed = orders.filter(order => order.status === 'completed');
  const grossOrderValueFcfa = completed.reduce((sum, order) => sum + amount(order.totalAmount), 0);
  const collectedFcfa = payments.reduce((sum, payment) => sum + amount(payment.paidAmount), 0);
  const outstandingFcfa = orders.filter(order => order.status !== 'cancelled')
    .reduce((sum, order) => sum + amount(order.remainingAmount ?? Math.max(0, amount(order.totalAmount) - amount(order.paidAmount))), 0);
  const taxCollectedFcfa = payments.reduce((sum, payment) => sum + amount(payment.taxAmount), 0);
  const cashCollectedFcfa = payments.filter(payment =>
    payment.method === 'especes' || payment.method === 'cash'
  ).reduce((sum, payment) => sum + amount(payment.paidAmount), 0);
  const otherCollectedFcfa = Math.max(0, collectedFcfa - cashCollectedFcfa);
  const expensesFcfa = movements.filter(movement => movement.movementType === 'expense')
    .reduce((sum, movement) => sum + amount(movement.amount), 0);
  const withdrawalsFcfa = movements.filter(movement => movement.movementType === 'withdrawal')
    .reduce((sum, movement) => sum + amount(movement.amount), 0);
  const costOfGoodsFcfa = consumptions.filter(consumption =>
    !['restored', 'skipped'].includes(String(consumption.status || ''))
  ).reduce((sum, consumption) => sum + (Array.isArray(consumption.lines)
    ? consumption.lines.reduce((lineSum: number, line: any) =>
        lineSum + amount(line.lineCost ?? Math.round(Number(line.quantity || 0) * Number(line.unitCost || 0))), 0)
    : 0), 0);
  const grossMarginFcfa = collectedFcfa - costOfGoodsFcfa;
  const operatingResultFcfa = grossMarginFcfa - expensesFcfa;
  return {
    completedOrders: completed.length,
    grossOrderValueFcfa,
    collectedFcfa,
    outstandingFcfa,
    taxCollectedFcfa,
    costOfGoodsFcfa,
    grossMarginFcfa,
    expensesFcfa,
    withdrawalsFcfa,
    operatingResultFcfa,
    cashCollectedFcfa,
    otherCollectedFcfa,
    cashNetAfterMovementsFcfa: cashCollectedFcfa - expensesFcfa - withdrawalsFcfa,
    grossMarginPercent: collectedFcfa > 0 ? Math.round((grossMarginFcfa / collectedFcfa) * 10000) / 100 : 0
  };
}
