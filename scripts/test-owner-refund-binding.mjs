import assert from 'node:assert/strict';
import { refundCashPaymentWithDb } from '../src/server/paymentService.ts';

class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Col(this.db, this.path + '/' + name); }
}
class Col {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, this.path + '/' + id); }
}
class Db {
  constructor(seed) { this.data = new Map(Object.entries(seed)); }
  collection(name) { return new Col(this, name); }
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
      if (kind === 'create' && this.data.has(path)) throw new Error('duplicate');
      if (kind === 'update' && !this.data.has(path)) throw new Error('missing');
      this.data.set(path, kind === 'update' ? { ...this.data.get(path), ...value } : value);
    }
    return result;
  }
}
function makeDb(uid, ownerUid) {
  return new Db({
    'restaurants/r': { status: 'active', ownerUid },
    ['managers/' + uid]: { role: 'owner', active: true, restaurantSlug: 'r', sessionVersion: 1 },
    'restaurants/r/payments/p': { id: 'p', restaurantSlug: 'r', orderId: 'o', paidAmount: 1000, method: 'especes' },
    'restaurants/r/orders/o': { restaurantSlug: 'r', paidAmount: 1000, refundedAmount: 0 },
    ['restaurants/r/cashSessionActive/' + uid]: { status: 'active', sessionId: 's' },
    'restaurants/r/cashSessions/s': { status: 'active', openedByUid: uid, sessionVersion: 1, cashOut: 0 }
  });
}
const input = { restaurantSlug: 'r', paymentId: 'p', actorUid: 'owner-1', sessionVersion: 1,
  amount: 500, reason: 'Refund test', idempotencyKey: 'owner-refund-001', cashDisbursementConfirmed: true };
const valid = await refundCashPaymentWithDb(makeDb('owner-1', 'owner-1'), input);
assert.equal(valid.success, true, 'verified owner can refund');
const mismatch = await refundCashPaymentWithDb(makeDb('owner-2', 'owner-1'), { ...input, actorUid: 'owner-2' });
assert.equal(mismatch.success, false, 'owner membership without ownerUid binding is denied');
console.log('Owner refund binding tests passed.');
