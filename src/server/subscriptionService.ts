export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type SubscriptionBillingCycle = 'monthly' | 'yearly' | 'custom';

export interface NormalizedSubscriptionInput {
  autoRenew: boolean;
  nextBillingAt: number;
  gracePeriodDays: number;
  planName: string;
  priceFcfa: number;
  currency: 'XOF';
  billingCycle: SubscriptionBillingCycle;
  status: SubscriptionStatus;
  startsAt: number;
  endsAt: number;
  notes: string;
}

export type SubscriptionValidationResult =
  | { success: true; subscription: NormalizedSubscriptionInput }
  | { success: false; error: string };

export function validateSubscriptionInput(input: unknown): SubscriptionValidationResult {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const planName = String(value.planName || '').trim();
  const priceFcfa = Number(value.priceFcfa);
  const billingCycle = String(value.billingCycle || '');
  const status = String(value.status || '');
  const startsAt = Number(value.startsAt);
  const endsAt = Number(value.endsAt);
  const notes = String(value.notes || '').trim().slice(0, 500);
  const autoRenew = value.autoRenew === true;
  const nextBillingAt = Number(value.nextBillingAt || endsAt + 1);
  const gracePeriodDays = Number(value.gracePeriodDays ?? 7);

  if (planName.length < 2 || planName.length > 80 ||
      !Number.isSafeInteger(priceFcfa) || priceFcfa < 0 || priceFcfa > 1_000_000_000 ||
      !['monthly', 'yearly', 'custom'].includes(billingCycle) ||
      (autoRenew && billingCycle === 'custom') ||
      !Number.isSafeInteger(nextBillingAt) || nextBillingAt < endsAt ||
      !Number.isInteger(gracePeriodDays) || gracePeriodDays < 1 || gracePeriodDays > 30 ||
      !['trial', 'active', 'past_due', 'suspended', 'cancelled'].includes(status) ||
      !Number.isSafeInteger(startsAt) || startsAt <= 0 ||
      !Number.isSafeInteger(endsAt) || endsAt <= startsAt) {
    return {
      success: false,
      error: 'Informations d’abonnement invalides. Vérifiez le plan, le tarif FCFA, la périodicité, le statut et les dates.'
    };
  }

  return {
    success: true,
    subscription: {
      autoRenew, nextBillingAt, gracePeriodDays,
      planName, priceFcfa, currency: 'XOF',
      billingCycle: billingCycle as SubscriptionBillingCycle,
      status: status as SubscriptionStatus,
      startsAt, endsAt, notes
    }
  };
}

import { createHash } from 'node:crypto';

export function advanceSubscriptionPeriod(timestamp: number, cycle: 'monthly' | 'yearly'): number {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  if (cycle === 'yearly') {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    if (date.getUTCDate() !== day) date.setUTCDate(0);
  } else {
    const targetMonth = date.getUTCMonth() + 1;
    date.setUTCDate(1);
    date.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.getTime();
}

const invoiceIdFor = (slug: string, periodStart: number) =>
  'subinv_' + createHash('sha256').update(slug + ':' + periodStart).digest('hex').slice(0, 32);

/**
 * Scheduled billing reconciliation. Creates one deterministic invoice per due period,
 * then suspends access only after the invoice grace period has elapsed.
 */
export async function reconcileSubscriptionBillingWithDb(db: any, now = Date.now(), limit = 250) {
  if (!db) return { success: false, createdInvoices: 0, suspendedRestaurants: 0, error: 'Firestore indisponible.' };
  const snapshot = await db.collection('restaurantSubscriptions').limit(Math.min(500, Math.max(1, limit))).get();
  let createdInvoices = 0;
  let suspendedRestaurants = 0;
  for (const document of snapshot.docs) {
    const slug = document.id;
    const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
    const restaurantRef = db.collection('restaurants').doc(slug);
    const initial = document.data() || {};
    if (initial.autoRenew !== true || !['monthly', 'yearly'].includes(String(initial.billingCycle))) continue;
    const cycle = initial.billingCycle as 'monthly' | 'yearly';
    const dueAt = Number(initial.nextBillingAt || 0);
    if (['active', 'trial'].includes(String(initial.status)) && dueAt > 0 && dueAt <= now) {
      const invoiceId = invoiceIdFor(slug, dueAt);
      const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId);
      const result = await db.runTransaction(async (tx: any) => {
        const [subSnap, restaurantSnap, invoiceSnap] = await Promise.all([
          tx.get(subscriptionRef), tx.get(restaurantRef), tx.get(invoiceRef)
        ]);
        const sub = subSnap.exists ? subSnap.data() : null;
        const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
        if (!sub || !restaurant || sub.autoRenew !== true ||
            !['active', 'trial'].includes(String(sub.status)) ||
            Number(sub.nextBillingAt || 0) !== dueAt || dueAt > now) return 'skip';
        if (invoiceSnap.exists) return 'exists';
        const gracePeriodDays = Number.isInteger(sub.gracePeriodDays) ? Math.min(30, Math.max(1, sub.gracePeriodDays)) : 7;
        const dueDate = now + gracePeriodDays * 24 * 60 * 60 * 1000;
        const periodEnd = advanceSubscriptionPeriod(dueAt, cycle);
        tx.create(invoiceRef, {
          id: invoiceId, restaurantSlug: slug, planName: String(sub.planName || ''),
          amountFcfa: Number(sub.priceFcfa || 0), currency: 'XOF',
          billingCycle: cycle, billingPeriodStart: dueAt, billingPeriodEnd: periodEnd,
          status: 'open', issuedAt: now, dueAt: dueDate, createdAt: now
        });
        tx.update(subscriptionRef, {
          status: 'past_due', currentInvoiceId: invoiceId, graceEndsAt: dueDate,
          lastInvoiceAt: now, updatedAt: now
        });
        return 'created';
      });
      if (result === 'created') createdInvoices += 1;
    }

    const latest = (await subscriptionRef.get()).data() || {};
    if (latest.status === 'past_due' && Number(latest.graceEndsAt || 0) > 0 && Number(latest.graceEndsAt) <= now) {
      const suspended = await db.runTransaction(async (tx: any) => {
        const [subSnap, restaurantSnap] = await Promise.all([tx.get(subscriptionRef), tx.get(restaurantRef)]);
        const sub = subSnap.exists ? subSnap.data() : null;
        const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
        if (!sub || sub.status !== 'past_due' || Number(sub.graceEndsAt || 0) > now ||
            !restaurant || restaurant.status !== 'active') return false;
        tx.update(subscriptionRef, { status: 'suspended', suspendedAt: now, updatedAt: now });
        tx.update(restaurantRef, { status: 'suspended', subscriptionSuspendedAt: now });
        return true;
      });
      if (suspended) suspendedRestaurants += 1;
    }
  }
  return { success: true, createdInvoices, suspendedRestaurants };
}

/** Super-admin reconciliation after an external subscription payment has been verified. */
export async function markSubscriptionInvoicePaidWithDb(
  db: any,
  input: { restaurantSlug: string; invoiceId: string; actorUid: string; paymentReference: string }
) {
  const slug = String(input.restaurantSlug || '').trim();
  const invoiceId = String(input.invoiceId || '').trim();
  const paymentReference = String(input.paymentReference || '').trim().slice(0, 160);
  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^subinv_[a-f0-9]{32}$/.test(invoiceId) ||
      !input.actorUid || paymentReference.length < 4) {
    return { success: false, error: 'Référence de règlement ou facture invalide.' };
  }
  const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
  const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId);
  const restaurantRef = db.collection('restaurants').doc(slug);
  return db.runTransaction(async (tx: any) => {
    const [subSnap, invoiceSnap, restaurantSnap] = await Promise.all([
      tx.get(subscriptionRef), tx.get(invoiceRef), tx.get(restaurantRef)
    ]);
    const sub = subSnap.exists ? subSnap.data() : null;
    const invoice = invoiceSnap.exists ? invoiceSnap.data() : null;
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    if (!sub || !invoice || !restaurant || invoice.restaurantSlug !== slug) {
      return { success: false, error: 'Facture ou abonnement introuvable.' };
    }
    if (invoice.status === 'paid') {
      return invoice.paymentReference === paymentReference
        ? { success: true, idempotentReplay: true }
        : { success: false, error: 'Cette facture est déjà réglée avec une autre référence.' };
    }
    if (invoice.status !== 'open' || Number(invoice.amountFcfa) !== Number(sub.priceFcfa)) {
      return { success: false, error: 'La facture ne peut pas être rapprochée de cet abonnement.' };
    }
    const now = Date.now();
    const cycle = sub.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const nextBillingAt = Number(invoice.billingPeriodEnd || advanceSubscriptionPeriod(Number(invoice.billingPeriodStart), cycle));
    tx.update(invoiceRef, {
      status: 'paid', paidAt: now, paymentReference,
      reconciledBy: input.actorUid
    });
    tx.update(subscriptionRef, {
      status: 'active', startsAt: Number(invoice.billingPeriodStart),
      endsAt: nextBillingAt - 1, nextBillingAt: advanceSubscriptionPeriod(nextBillingAt, cycle),
      currentInvoiceId: null, graceEndsAt: null, suspendedAt: null, updatedAt: now,
      lastPaymentReference: paymentReference, lastPaidAt: now
    });
    if (restaurant.subscriptionSuspendedAt && restaurant.status === 'suspended') {
      tx.update(restaurantRef, { status: 'active', subscriptionReactivatedAt: now, subscriptionSuspendedAt: null });
    }
    return { success: true, idempotentReplay: false, nextBillingAt: advanceSubscriptionPeriod(nextBillingAt, cycle) };
  });
}
