import assert from 'node:assert/strict';
import { refundCashPaymentWithDb } from '../src/server/paymentService.ts';

class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Collection(this.db, this.path + '/' + name); }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, this.path + '/' + id); }
}
class FakeDb {
  constructor(seed) { this.data = new Map(Object.entries(seed)); }
  collection(name) { return new Collection(this, name); }
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async ref => {
        const value = this.data.get(ref.path);
        return { exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) };
      },
      create: (ref, value) => writes.push(['create', ref.path, structuredClone(value)]),
      update: (ref, value) => writes.push(['update', ref.path, structuredClone(value)])
    };
    const result = await fn(tx);
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.data.has(path)) throw new Error('duplicate document');
      if (kind === 'update' && !this.data.has(path)) throw new Error('missing document');
      this.data.set(path, kind === 'update' ? { ...this.data.get(path), ...value } : value);
    }
    return result;
  }
}
const seed = (member, method = 'especes') => new FakeDb({
  'restaurants/demo': { status: 'active', ownerUid: 'owner-1' },
  'managers/actor-1': member,
  'restaurants/demo/payments/pay-1': { id: 'pay-1', restaurantSlug: 'demo', orderId: 'order-1', paidAmount: 5000, method, currency: 'FCFA' },
  'restaurants/demo/orders/order-1': { restaurantSlug: 'demo', paidAmount: 5000, refundedAmount: 0 },
  'restaurants/demo/cashSessionActive/actor-1': { status: 'active', sessionId: 'session-1' },
  'restaurants/demo/cashSessions/session-1': { status: 'active', openedByUid: 'actor-1', sessionVersion: 2, cashOut: 0 }
});
const base = { restaurantSlug: 'demo', paymentId: 'pay-1', actorUid: 'actor-1', sessionVersion: 2,
  amount: 2000, reason: 'Erreur de commande', idempotencyKey: 'refund-test-001', cashDisbursementConfirmed: true };
const manager = { role: 'manager', active: true, restaurantSlug: 'demo', sessionVersion: 2, permissions: ['payments.refund'] };
const db = seed(manager);
const first = await refundCashPaymentWithDb(db, base);
assert.equal(first.success, true, 'manager can refund cash payment');
assert.equal(first.payment.cashDisbursementConfirmed, true, 'cash handover confirmation is recorded in the refund audit');
assert.equal(first.payment.cashDisbursementConfirmedByUid, 'actor-1', 'cash handover confirmation records the acting operator');
assert.equal(db.data.get('restaurants/demo/payments/pay-1').refundedAmount, 2000);
assert.equal(db.data.get('restaurants/demo/cashSessions/session-1').cashOut, 2000);
const replay = await refundCashPaymentWithDb(db, base);
assert.equal(replay.success, true);
assert.equal(replay.idempotentReplay, true);
assert.equal(db.data.get('restaurants/demo/payments/pay-1').refundedAmount, 2000, 'idempotent replay does not double refund');

assert.equal((await refundCashPaymentWithDb(seed(manager), { ...base, cashDisbursementConfirmed: false })).success, false, 'cash refund requires explicit physical handover confirmation');

const cashierNoGrant = seed({ role: 'cashier', active: true, restaurantSlug: 'demo', sessionVersion: 2, permissions: ['cash.manage'] });
assert.equal((await refundCashPaymentWithDb(cashierNoGrant, base)).success, false, 'cashier without refund permission is denied');
const cashierGrant = seed({ role: 'cashier', active: true, restaurantSlug: 'demo', sessionVersion: 2, permissions: ['cash.manage', 'payments.refund'] });
assert.equal((await refundCashPaymentWithDb(cashierGrant, base)).success, true, 'cashier with explicit refund permission is allowed');
const server = seed({ role: 'server', active: true, restaurantSlug: 'demo', sessionVersion: 2, permissions: ['pos.access'] });
assert.equal((await refundCashPaymentWithDb(server, base)).success, false, 'server cannot refund');
const kitchen = seed({ role: 'kitchen', active: true, restaurantSlug: 'demo', sessionVersion: 2, permissions: ['kitchen.access'] });
assert.equal((await refundCashPaymentWithDb(kitchen, base)).success, false, 'kitchen cannot refund');
const crossTenant = seed({ role: 'manager', active: true, restaurantSlug: 'other', sessionVersion: 2, permissions: ['payments.refund'] });
assert.equal((await refundCashPaymentWithDb(crossTenant, base)).success, false, 'cross-restaurant access is denied');
const tooMuch = seed(manager);
assert.equal((await refundCashPaymentWithDb(tooMuch, { ...base, amount: 6000 })).success, false, 'over-refund is denied');
const mobileMoney = seed(manager, 'paydunya');
assert.equal((await refundCashPaymentWithDb(mobileMoney, base)).success, false, 'mobile money is not falsely marked as refunded');
console.log('Refund service regression tests passed.');
