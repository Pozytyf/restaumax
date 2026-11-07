import assert from 'node:assert/strict';
import {
  advanceSubscriptionPeriod,
  reconcileSubscriptionBillingWithDb,
  markSubscriptionInvoicePaidWithDb
} from '../src/server/subscriptionService.ts';

class FakeDb {
  constructor(seed = {}) { this.docs = new Map(Object.entries(seed)); }
  ref(path) {
    return {
      path,
      id: path.split('/').pop(),
      collection: name => this.ref(path + '/' + name),
      doc: id => this.ref(path + '/' + id),
      get: async () => {
        const value = this.docs.get(path);
        return { exists: value !== undefined, id: path.split('/').pop(), data: () => value };
      }
    };
  }
  collection(name) {
    const ref = this.ref(name);
    ref.doc = id => this.ref(name + '/' + id);
    ref.limit = count => ({
      get: async () => ({
        docs: [...this.docs.entries()]
          .filter(([path]) => path.startsWith(name + '/') && !path.slice(name.length + 1).includes('/'))
          .slice(0, count)
          .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }))
      })
    });
    return ref;
  }
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: async ref => {
        const value = this.docs.get(ref.path);
        return { exists: value !== undefined, id: ref.id, data: () => value };
      },
      create: (ref, value) => writes.push(['create', ref.path, value]),
      update: (ref, value) => writes.push(['update', ref.path, value]),
      set: (ref, value) => writes.push(['set', ref.path, value])
    };
    const result = await callback(tx);
    for (const [kind, path, value] of writes) {
      if (kind === 'create' && this.docs.has(path)) throw new Error('already exists');
      this.docs.set(path, { ...(kind === 'update' || kind === 'set' ? this.docs.get(path) || {} : {}), ...value });
    }
    return result;
  }
}

const jan31 = Date.UTC(2025, 0, 31, 12);
assert.equal(new Date(advanceSubscriptionPeriod(jan31, 'monthly')).toISOString(), '2025-02-28T12:00:00.000Z');
assert.equal(new Date(advanceSubscriptionPeriod(Date.UTC(2024, 1, 29), 'yearly')).toISOString(), '2025-02-28T00:00:00.000Z');

const slug = 'restaurant-abonnement';
const dueAt = 1_800_000_000_000;
const db = new FakeDb({
  ['restaurantSubscriptions/' + slug]: {
    planName: 'Pro', priceFcfa: 15000, currency: 'XOF',
    billingCycle: 'monthly', status: 'active', autoRenew: true,
    nextBillingAt: dueAt, gracePeriodDays: 7
  },
  ['restaurants/' + slug]: { status: 'active', ownerUid: 'owner-1' }
});
const now = dueAt + 1000;
const first = await reconcileSubscriptionBillingWithDb(db, now);
assert.equal(first.success, true);
assert.equal(first.createdInvoices, 1);
const subscription = db.docs.get('restaurantSubscriptions/' + slug);
assert.equal(subscription.status, 'past_due');
assert.ok(subscription.currentInvoiceId);
const invoicePath = 'restaurantSubscriptions/' + slug + '/invoices/' + subscription.currentInvoiceId;
const invoice = db.docs.get(invoicePath);
assert.equal(invoice.status, 'open');
assert.equal(invoice.amountFcfa, 15000);
assert.equal(invoice.currency, 'XOF');

const replay = await reconcileSubscriptionBillingWithDb(db, now + 1000);
assert.equal(replay.createdInvoices, 0, 'Recurring invoice is idempotent');
const suspended = await reconcileSubscriptionBillingWithDb(db, invoice.dueAt + 1);
assert.equal(suspended.suspendedRestaurants, 1);
assert.equal(db.docs.get('restaurants/' + slug).status, 'suspended');
assert.equal(db.docs.get('restaurantSubscriptions/' + slug).status, 'suspended');

const paid = await markSubscriptionInvoicePaidWithDb(db, {
  restaurantSlug: slug, invoiceId: subscription.currentInvoiceId,
  actorUid: 'platform-admin', paymentReference: 'TXN-TEST-2026-001'
});
assert.equal(paid.success, true);
assert.equal(db.docs.get(invoicePath).status, 'paid');
assert.equal(db.docs.get('restaurantSubscriptions/' + slug).status, 'active');
assert.equal(db.docs.get('restaurantSubscriptions/' + slug).nextBillingAt, invoice.billingPeriodEnd, 'Invoice settlement advances to the end of the paid period without skipping a month');
assert.equal(db.docs.get('restaurants/' + slug).status, 'active');
const paidReplay = await markSubscriptionInvoicePaidWithDb(db, {
  restaurantSlug: slug, invoiceId: subscription.currentInvoiceId,
  actorUid: 'platform-admin', paymentReference: 'TXN-TEST-2026-001'
});
assert.equal(paidReplay.idempotentReplay, true);

const invalid = await markSubscriptionInvoicePaidWithDb(db, {
  restaurantSlug: slug, invoiceId: subscription.currentInvoiceId,
  actorUid: 'platform-admin', paymentReference: 'OTHER-REF-001'
});
assert.equal(invalid.success, false, 'A paid invoice cannot be reconciled against a second reference');
console.log('Subscription recurring invoice, grace period and suspension tests passed: 15/15.');
