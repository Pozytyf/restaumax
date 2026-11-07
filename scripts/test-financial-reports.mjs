import assert from 'node:assert/strict';
import { calculateFinancialReport, getFinancialReportWithDb } from '../src/server/financialReportService.ts';

const report = calculateFinancialReport({
  orders: [
    { id: 'order-1', status: 'completed', totalAmount: 1180, paidAmount: 1180, remainingAmount: 0 },
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
    { orderId: 'order-1', status: 'applied', lines: [{ quantity: 2, unitCost: 300, lineCost: 600 }, { quantity: 1, unitCost: 200, lineCost: 200 }] },
    { orderId: 'order-cancelled', status: 'restored', lines: [{ lineCost: 900 }] },
    { orderId: 'order-untracked', status: 'skipped', lines: [] }
  ]
});
assert.equal(report.completedOrders, 1);
assert.equal(report.grossOrderValueFcfa, 1180);
assert.equal(report.collectedFcfa, 2180);
assert.equal(report.outstandingFcfa, 4000);
assert.equal(report.taxCollectedFcfa, 180);
assert.equal(report.costOfGoodsFcfa, 800);
assert.equal(report.grossMarginFcfa, 380);
assert.equal(report.expensesFcfa, 2500);
assert.equal(report.withdrawalsFcfa, 1000);
assert.equal(report.operatingResultFcfa, -2120);
assert.equal(report.cashCollectedFcfa, 1180);
assert.equal(report.otherCollectedFcfa, 1000);
assert.equal(report.cashNetAfterMovementsFcfa, -2320);
assert.equal(report.grossMarginPercent, 32.2);
class ReportDb {
  constructor(seed) { this.docs = new Map(Object.entries(seed)); }
  ref(path) {
    const self = this;
    const ref = {
      path,
      get: async () => {
        const value = self.docs.get(path);
        return { exists: value !== undefined, data: () => value };
      },
      collection: name => self.ref(path + '/' + name),
      where: () => query
    };
    const query = {
      where: () => query,
      get: async () => ({
        docs: [...self.docs.entries()]
          .filter(([docPath]) => docPath.startsWith(path + '/') && !docPath.slice(path.length + 1).includes('/'))
          .map(([docPath, value]) => ({ id: docPath.split('/').pop(), data: () => value }))
      })
    };
    return ref;
  }
  collection(name) {
    const root = this.ref(name);
    root.doc = id => this.ref(name + '/' + id);
    return root;
  }
}
const reportDb = new ReportDb({
  'restaurants/tenant-a': { status: 'active', ownerUid: 'owner-a' },
  'managers/owner-a': { active: true, restaurantSlug: 'tenant-a', role: 'owner', sessionVersion: 2 },
  'managers/manager-no-reports': { active: true, restaurantSlug: 'tenant-a', role: 'manager', permissions: ['cash.view'], sessionVersion: 2 },
  'restaurants/tenant-a/orders/order-1': { id: 'order-1', status: 'completed', totalAmount: 1000, remainingAmount: 0, createdAt: 1000 }
});
const ownerReport = await getFinancialReportWithDb(reportDb, {
  restaurantSlug: 'tenant-a', actorUid: 'owner-a', sessionVersion: 2, from: 1, to: 2000
});
assert.equal(ownerReport.success, true, 'Owner can read reports for their own restaurant');
assert.equal(ownerReport.report.grossOrderValueFcfa, 1000);
const deniedReport = await getFinancialReportWithDb(reportDb, {
  restaurantSlug: 'tenant-a', actorUid: 'manager-no-reports', sessionVersion: 2, from: 1, to: 2000
});
assert.equal(deniedReport.success, false, 'A manager without reports.view cannot read financial reports');
const crossTenantReport = await getFinancialReportWithDb(reportDb, {
  restaurantSlug: 'tenant-b', actorUid: 'owner-a', sessionVersion: 2, from: 1, to: 2000
});
assert.equal(crossTenantReport.success, false, 'A restaurant owner cannot read another tenant reports');
console.log('Financial report aggregation and tenant isolation tests passed: 18/18.');
