import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runSubscriptionBillingCycleWithDb, settleSubscriptionInvoiceWithDb } from '../src/server/subscriptionBillingService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de facturation récurrente.');
  process.exit(1);
}
const app = initializeApp({ projectId: 'demo-restaumax' }, 'subscription-billing-emulator-test');
const db = getFirestore(app);
const now = Date.now();
const slug = 'subscription-cycle-emulator';
const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
const restaurantRef = db.collection('restaurants').doc(slug);

try {
  await Promise.all([
    restaurantRef.set({ slug, status: 'active', isOpen: true, ownerUid: 'owner-subscription-test', tableSessionVersion: 3 }),
    restaurantRef.collection('table_sessions').doc('active-session').set({ status: 'active', sessionHash: 'active-session' }),
    restaurantRef.collection('table_qr_tokens').doc('active-token').set({ status: 'active', tokenHash: 'active-token', tableId: 'table-4' }),
    subscriptionRef.set({
      planName: 'Pro', priceFcfa: 25000, currency: 'XOF', billingCycle: 'monthly',
      status: 'active', startsAt: now - 30 * 86400000, endsAt: now - 1000,
      nextBillingAt: now - 1000, autoRenew: true, gracePeriodDays: 7
    })
  ]);

  const first = await runSubscriptionBillingCycleWithDb(db, now);
  assert.equal(first.invoicesCreated, 1, 'Une facture récurrente est créée à échéance');
  const subscription = (await subscriptionRef.get()).data();
  assert.equal(subscription.status, 'past_due');
  assert.equal(subscription.currentInvoiceId.startsWith('subinv_'), true);
  const invoiceRef = subscriptionRef.collection('invoices').doc(subscription.currentInvoiceId);
  const invoice = (await invoiceRef.get()).data();
  assert.equal(invoice.amountFcfa, 25000);
  assert.equal(invoice.status, 'open');

  const replay = await runSubscriptionBillingCycleWithDb(db, now + 86400000);
  assert.equal(replay.invoicesCreated, 0, 'Une exécution répétée ne crée pas une seconde facture');
  const invoices = await subscriptionRef.collection('invoices').get();
  assert.equal(invoices.size, 1);

  const beforeGrace = await runSubscriptionBillingCycleWithDb(db, now + 6 * 86400000);
  assert.equal(beforeGrace.restaurantsSuspended, 0, 'Le restaurant reste accessible pendant le délai de grâce');
  assert.equal((await restaurantRef.get()).data().status, 'active');

  const afterGrace = await runSubscriptionBillingCycleWithDb(db, now + 8 * 86400000);
  assert.equal(afterGrace.restaurantsSuspended, 1, 'Le restaurant est suspendu automatiquement après le délai de grâce');
  const suspended = (await restaurantRef.get()).data();
  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.suspensionReason, 'subscription_past_due');
  assert.equal(suspended.tableSessionVersion, 4);
  assert.equal((await restaurantRef.collection('table_sessions').doc('active-session').get()).data().status, 'revoked',
    'Les sessions QR actives sont révoquées lors de la suspension');
  assert.equal((await restaurantRef.collection('table_qr_tokens').doc('active-token').get()).data().status, 'revoked',
    'Les anciens QR sont révoqués pour empêcher leur réutilisation après réactivation');

  const settled = await settleSubscriptionInvoiceWithDb(db, {
    restaurantSlug: slug, invoiceId: subscription.currentInvoiceId,
    amountFcfa: 25000, paymentReference: 'TRANSFER-RECEIPT-2026-001',
    actorUid: 'super-admin-test', now: now + 8 * 86400000 + 1000
  });
  assert.equal(settled.success, true, 'Une facture payée est rapprochée et l’abonnement renouvelé');
  const renewed = (await subscriptionRef.get()).data();
  assert.equal(renewed.status, 'active');
  assert.equal(renewed.nextBillingAt, renewed.endsAt);
  assert.equal((await restaurantRef.get()).data().status, 'active', 'Un paiement réactive un restaurant suspendu uniquement pour impayé');
  const settlementReplay = await settleSubscriptionInvoiceWithDb(db, {
    restaurantSlug: slug, invoiceId: subscription.currentInvoiceId,
    amountFcfa: 25000, paymentReference: 'TRANSFER-RECEIPT-2026-001',
    actorUid: 'super-admin-test', now: now + 8 * 86400000 + 2000
  });
  assert.equal(settlementReplay.success && settlementReplay.idempotentReplay, true, 'Le rapprochement est idempotent');
  const subscriptionPayments = await subscriptionRef.collection('payments').get();
  assert.equal(subscriptionPayments.size, 1, 'Le règlement possède une seule écriture financière append-only');
  assert.equal(subscriptionPayments.docs[0].data().method, 'manual');

  const nonRenewSlug = 'subscription-no-renew-emulator';
  const nonRenewRef = db.collection('restaurantSubscriptions').doc(nonRenewSlug);
  const nonRenewRestaurant = db.collection('restaurants').doc(nonRenewSlug);
  await Promise.all([
    nonRenewRestaurant.set({ slug: nonRenewSlug, status: 'active', isOpen: true, tableSessionVersion: 0 }),
    nonRenewRef.set({
      planName: 'Custom', priceFcfa: 10000, billingCycle: 'custom', status: 'active',
      startsAt: now - 10000, endsAt: now - 1, nextBillingAt: now - 1,
      autoRenew: false, gracePeriodDays: 7
    })
  ]);
  const freeSlug = 'subscription-free-emulator';
  const freeRef = db.collection('restaurantSubscriptions').doc(freeSlug);
  const freeRestaurant = db.collection('restaurants').doc(freeSlug);
  await Promise.all([
    freeRestaurant.set({ slug: freeSlug, status: 'active', isOpen: true }),
    freeRef.set({
      planName: 'Gratuit', priceFcfa: 0, billingCycle: 'monthly', status: 'active',
      startsAt: now - 30 * 86400000, endsAt: now - 1, nextBillingAt: now - 1, autoRenew: true
    })
  ]);

  const noRenew = await runSubscriptionBillingCycleWithDb(db, now + 9 * 86400000);
  assert.equal(noRenew.restaurantsSuspended, 1, 'Un abonnement sans renouvellement est suspendu à échéance');
  assert.equal((await nonRenewRestaurant.get()).data().suspensionReason, 'subscription_nonrenewal');
  assert.equal(noRenew.freePlansRenewed, 1, 'Un abonnement gratuit est renouvelé sans facture ni paiement');
  assert.equal((await freeRef.get()).data().status, 'active');
  assert.equal((await freeRef.collection('invoices').get()).size, 0);

  console.log('Subscription billing Firestore Emulator tests passed: 27 assertions.');
} finally {
  await app.delete();
}
