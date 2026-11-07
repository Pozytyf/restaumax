import assert from 'node:assert/strict';
import { calculateFinancialReport } from '../src/server/financialReportService.ts';

const report = calculateFinancialReport({
  orders: [
    { status: 'completed', totalAmount: 1180, paidAmount: 1180, remainingAmount: 0 },
    { status: 'pending', totalAmount: 5000, paidAmount: 1000, remainingAmount: 4000 },
    { status: 'cancelled', totalAmount: 700, paidAmount: 0, remainingAmount: 0 }
  ],
  payments: [
    { method: 'especes', paidAmount: 1180, taxAmount: 180 },
    { method: 'mobile_money', paidAmount: 1000, taxAmount: 0 }
  ],
  cashMovements: [
    { movementType: 'expense', amount: 2500 },
    { movementType: 'withdrawal', amount: 1000 }
  ],
  stockConsumptions: [
    { status: 'applied', lines: [{ quantity: 2, unitCost: 300, lineCost: 600 }, { quantity: 1, unitCost: 200, lineCost: 200 }] },
    { status: 'restored', lines: [{ lineCost: 900 }] },
    { status: 'skipped', lines: [] }
  ]
});
assert.equal(report.completedOrders, 1);
assert.equal(report.grossOrderValueFcfa, 1180);
assert.equal(report.collectedFcfa, 2180);
assert.equal(report.outstandingFcfa, 4000);
assert.equal(report.taxCollectedFcfa, 180);
assert.equal(report.costOfGoodsFcfa, 800);
assert.equal(report.grossMarginFcfa, 1380);
assert.equal(report.expensesFcfa, 2500);
assert.equal(report.withdrawalsFcfa, 1000);
assert.equal(report.operatingResultFcfa, -1120);
assert.equal(report.cashCollectedFcfa, 1180);
assert.equal(report.otherCollectedFcfa, 1000);
assert.equal(report.cashNetAfterMovementsFcfa, -2320);
assert.equal(report.grossMarginPercent, 63.3);
console.log('Financial report aggregation tests passed: 13/13.');
