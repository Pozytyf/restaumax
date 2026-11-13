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
  await db.collection('platform_config').doc('global').set({ gracePeriodDays: 4, quarterlyDiscountPercent: 10 }, { merge: true });
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

  const quarterlySlug = 'subscription-quarterly-emulator';
  const quarterlyRef = db.collection('restaurantSubscriptions').doc(quarterlySlug);
  const quarterlyRestaurant = db.collection('restaurants').doc(quarterlySlug);
  await Promise.all([
    quarterlyRestaurant.set({ slug: quarterlySlug, status: 'active', isOpen: true }),
    quarterlyRef.set({
      planName: 'Pro', priceFcfa: 30000, billingCycle: 'quarterly', status: 'active',
      startsAt: now - 90 * 86400000, endsAt: now - 1000, nextBillingAt: now - 1000,
      autoRenew: true, gracePeriodDays: 4
    })
  ]);
  const quarterlyRun = await runSubscriptionBillingCycleWithDb(db, now);
  assert.equal(quarterlyRun.invoicesCreated, 1, 'Une échéance trimestrielle produit une facture');
  const quarterlySub = (await quarterlyRef.get()).data();
  const quarterlyInvoiceRef = quarterlyRef.collection('invoices').doc(quarterlySub.currentInvoiceId);
  const quarterlyInvoice = (await quarterlyInvoiceRef.get()).data();
  assert.equal(quarterlyInvoice.baseAmountFcfa, 30000, 'La facture conserve le montant de base trimestriel');
  assert.equal(quarterlyInvoice.discountPercent, 10, 'Le taux configuré est figé sur la facture');
  assert.equal(quarterlyInvoice.discountAmountFcfa, 3000, 'La réduction trimestrielle est calculée côté serveur');
  assert.equal(quarterlyInvoice.amountFcfa, 27000, 'Le montant net facturé tient compte de la réduction');
  const quarterlyPaid = await settleSubscriptionInvoiceWithDb(db, {
    restaurantSlug: quarterlySlug, invoiceId: quarterlySub.currentInvoiceId,
    amountFcfa: 27000, paymentReference: 'QUARTERLY-RECEIPT-001',
    actorUid: 'super-admin-test', now: now + 1000
  });
  assert.equal(quarterlyPaid.success, true, 'Une facture trimestrielle peut être réglée');
  const quarterlyRenewed = (await quarterlyRef.get()).data();
  assert.equal(quarterlyRenewed.status, 'active', 'Le règlement réactive l’abonnement trimestriel');
  const quarterlyEnd = new Date(quarterlyRenewed.endsAt);
  const quarterlyStart = new Date(Math.max(Number(quarterlySub.endsAt || now), now));
  assert.equal((quarterlyEnd.getUTCFullYear() - quarterlyStart.getUTCFullYear()) * 12 + quarterlyEnd.getUTCMonth() - quarterlyStart.getUTCMonth(), 3,
    'Le renouvellement trimestriel ajoute exactement trois mois');

  const promotionRef = db.collection('platform_promotions').doc('promotion-single-use');
  await promotionRef.set({
    name: 'Bienvenue 20%', code: 'WELCOME20', discountType: 'percentage', value: 20,
    startsAt: now - 1000, endsAt: now + 86400000, eligiblePlans: ['Pro'],
    maxUses: 1, usedCount: 0, active: true, createdAt: now - 1000
  });
  const promoSlugs = ['subscription-promo-a', 'subscription-promo-b'];
  const promoRefs = promoSlugs.map(value => db.collection('restaurantSubscriptions').doc(value));
  await Promise.all(promoRefs.map((ref, index) => Promise.all([
    db.collection('restaurants').doc(promoSlugs[index]).set({ slug: promoSlugs[index], status: 'active', isOpen: true }),
    ref.set({
      planName: 'Pro', priceFcfa: 10000, billingCycle: index === 0 ? 'quarterly' : 'monthly',
      status: 'active', startsAt: now - 90000000, endsAt: now - 1000, nextBillingAt: now - 1000,
      autoRenew: true, gracePeriodDays: 60
    })
  ])));
  const promoRun = await runSubscriptionBillingCycleWithDb(db, now + 2000);
  assert.equal(promoRun.invoicesCreated, 2, 'Deux abonnements éligibles produisent leurs factures');
  const promoInvoices = await Promise.all(promoRefs.map(async ref => {
    const sub = (await ref.get()).data();
    return (await ref.collection('invoices').doc(sub.currentInvoiceId).get()).data();
  }));
  assert.equal(promoInvoices.filter(invoice => invoice.discountSource === 'promotion').length, 1,
    'Une promotion limitée à un usage n’est appliquée qu’une seule fois');
  assert.equal((await promotionRef.get()).data().usedCount, 1, 'Le quota de promotion est incrémenté atomiquement');
  for (let index = 0; index < promoRefs.length; index++) {
    const invoice = promoInvoices[index];
    const expectedAmount = invoice.discountSource === 'promotion' ? 8000 :
      (invoice.billingCycle === 'quarterly' ? 9000 : 10000);
    assert.equal(invoice.amountFcfa, expectedAmount, 'Une promotion et la réduction trimestrielle ne se cumulent jamais');
    const sub = (await promoRefs[index].get()).data();
    const payment = await settleSubscriptionInvoiceWithDb(db, {
      restaurantSlug: promoSlugs[index], invoiceId: sub.currentInvoiceId,
      amountFcfa: invoice.amountFcfa, paymentReference: `PROMO-RECEIPT-00${index + 1}`,
      actorUid: 'super-admin-test', now: now + 3000 + index
    });
    assert.equal(payment.success, true, 'Les factures avec ou sans promotion restent réglables');
  }

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

  const globalGraceSlug = 'subscription-global-grace-emulator';
  const globalGraceRef = db.collection('restaurantSubscriptions').doc(globalGraceSlug);
  const globalGraceRestaurant = db.collection('restaurants').doc(globalGraceSlug);
  const overrideGraceSlug = 'subscription-override-grace-emulator';
  const overrideGraceRef = db.collection('restaurantSubscriptions').doc(overrideGraceSlug);
  const overrideGraceRestaurant = db.collection('restaurants').doc(overrideGraceSlug);
  await Promise.all([
    globalGraceRestaurant.set({ slug: globalGraceSlug, status: 'active', isOpen: true }),
    globalGraceRef.set({
      planName: 'Pro', priceFcfa: 12000, billingCycle: 'monthly', status: 'active',
      startsAt: now, endsAt: now + 9 * 86400000, nextBillingAt: now + 9 * 86400000,
      autoRenew: true, gracePeriodDays: 7, gracePeriodOverride: false
    }),
    overrideGraceRestaurant.set({ slug: overrideGraceSlug, status: 'active', isOpen: true }),
    overrideGraceRef.set({
      planName: 'Pro', priceFcfa: 12000, billingCycle: 'monthly', status: 'active',
      startsAt: now, endsAt: now + 9 * 86400000, nextBillingAt: now + 9 * 86400000,
      autoRenew: true, gracePeriodDays: 2, gracePeriodOverride: true
    })
  ]);
  await runSubscriptionBillingCycleWithDb(db, now + 9 * 86400000);
  assert.equal((await globalGraceRef.collection('invoices').get()).docs[0].data().gracePeriodDays, 4,
    'La configuration globale du délai de grâce est appliquée aux abonnements sans dérogation');
  assert.equal((await overrideGraceRef.collection('invoices').get()).docs[0].data().gracePeriodDays, 2,
    'Une dérogation de délai propre à un abonnement est conservée');
  const mixedGrace = await runSubscriptionBillingCycleWithDb(db, now + 12 * 86400000);
  assert.equal(mixedGrace.restaurantsSuspended, 1, 'Seul l’abonnement dont le délai personnalisé est écoulé est suspendu');
  assert.equal((await globalGraceRestaurant.get()).data().status, 'active');
  assert.equal((await overrideGraceRestaurant.get()).data().status, 'suspended');
  await runSubscriptionBillingCycleWithDb(db, now + 14 * 86400000);
  assert.equal((await globalGraceRestaurant.get()).data().status, 'suspended',
    'Le délai global est respecté avant suspension');

  console.log('Subscription billing Firestore Emulator tests passed: 47 assertions.');
} finally {
  await app.delete();
}
