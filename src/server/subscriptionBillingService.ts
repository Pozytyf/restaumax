import { createHash } from 'node:crypto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const DAY_MS = 24 * 60 * 60 * 1000;

function invoiceIdFor(slug: string, billingCycle: string, nextBillingAt: number) {
  return `subinv_${hash(`${slug}:${billingCycle}:${nextBillingAt}`)}`;
}

function addBillingCycle(timestamp: number, cycle: 'monthly' | 'yearly') {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  if (cycle === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

async function revokeActiveTableSessions(db: any, slug: string, now: number, reason: string) {
  const sessions = await db.collection('restaurants').doc(slug)
    .collection('table_sessions').where('status', '==', 'active').get();
  for (let offset = 0; offset < sessions.docs.length; offset += 400) {
    const batch = db.batch();
    sessions.docs.slice(offset, offset + 400).forEach((session: any) => {
      batch.update(session.ref, { status: 'revoked', revokedAt: now, revokedReason: reason });
    });
    await batch.commit();
  }
}

export async function runSubscriptionBillingCycleWithDb(db: any, now = Date.now()) {
  if (!db) throw new Error('Firestore indisponible.');
  const subscriptions = await db.collection('restaurantSubscriptions').get();
  let invoicesCreated = 0;
  let restaurantsSuspended = 0;
  let skipped = 0;

  for (const doc of subscriptions.docs) {
    const slug = String(doc.id || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) { skipped++; continue; }
    const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
    const restaurantRef = db.collection('restaurants').doc(slug);
    const initial = doc.data() || {};
    const status = String(initial.status || '');
    const nextBillingAt = Number(initial.nextBillingAt || initial.endsAt || 0);

    if (['active', 'trial'].includes(status) && nextBillingAt > 0 && nextBillingAt <= now) {
      const invoiceId = invoiceIdFor(slug, String(initial.billingCycle || ''), nextBillingAt);
      const result = await db.runTransaction(async (tx: any) => {
        const [subSnap, restaurantSnap, invoiceSnap] = await Promise.all([
          tx.get(subscriptionRef), tx.get(restaurantRef),
          tx.get(subscriptionRef.collection('invoices').doc(invoiceId))
        ]);
        if (!subSnap.exists || !restaurantSnap.exists) return 'skip';
        const sub = subSnap.data() || {};
        const restaurant = restaurantSnap.data() || {};
        if (!['active', 'trial'].includes(String(sub.status || '')) ||
            Number(sub.nextBillingAt || sub.endsAt || 0) > now ||
            restaurant.status === 'deleted' || restaurant.deletedAt) return 'skip';
        if (invoiceSnap.exists) {
          if (String(sub.currentInvoiceId || '') === invoiceId) return 'exists';
          return 'skip';
        }
        if (sub.autoRenew === false) {
          tx.update(subscriptionRef, { status: 'suspended', suspendedAt: now, suspensionReason: 'subscription_nonrenewal', updatedAt: now });
          tx.update(restaurantRef, {
            status: 'suspended', isOpen: false, isOpenBeforeSuspension: restaurant.isOpen === true,
            suspendedAt: now, suspensionReason: 'subscription_nonrenewal',
            tableSessionVersion: Number(restaurant.tableSessionVersion || 0) + 1
          });
          tx.create(db.collection('admin_audit_logs').doc(`sub_nonrenew_${hash(slug + ':' + invoiceId)}`), {
            action: 'suspend_subscription_nonrenewal', restaurantSlug: slug, invoiceId, createdAt: now
          });
          return 'suspended';
        }
        const amount = Number(sub.priceFcfa);
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) return 'skip';
        const gracePeriodDays = Number.isSafeInteger(sub.gracePeriodDays) && sub.gracePeriodDays >= 0 && sub.gracePeriodDays <= 60
          ? sub.gracePeriodDays : 7;
        const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId);
        tx.create(invoiceRef, {
          id: invoiceId, restaurantSlug: slug, planName: String(sub.planName || ''),
          billingCycle: String(sub.billingCycle || ''), amountFcfa: amount, currency: 'XOF',
          periodStartAt: Number(sub.startsAt || 0), periodEndAt: Number(sub.endsAt || nextBillingAt),
          issuedAt: now, dueAt: now, gracePeriodDays, status: 'open',
          createdAt: now
        });
        tx.update(subscriptionRef, {
          status: 'past_due', pastDueAt: now, currentInvoiceId: invoiceId,
          gracePeriodDays, updatedAt: now
        });
        tx.create(db.collection('admin_audit_logs').doc(`sub_invoice_${hash(slug + ':' + invoiceId)}`), {
          action: 'create_recurring_subscription_invoice', restaurantSlug: slug,
          invoiceId, amountFcfa: amount, createdAt: now
        });
        return 'created';
      });
      if (result === 'created') invoicesCreated++;
      else if (result === 'suspended') {
        await revokeActiveTableSessions(db, slug, now, 'subscription_nonrenewal');
        restaurantsSuspended++;
      }
      else skipped++;
      continue;
    }

    if (status === 'past_due') {
      const currentInvoiceId = String(initial.currentInvoiceId || '');
      if (!currentInvoiceId) { skipped++; continue; }
      const invoiceRef = subscriptionRef.collection('invoices').doc(currentInvoiceId);
      const result = await db.runTransaction(async (tx: any) => {
        const [subSnap, restaurantSnap, invoiceSnap] = await Promise.all([
          tx.get(subscriptionRef), tx.get(restaurantRef), tx.get(invoiceRef)
        ]);
        if (!subSnap.exists || !restaurantSnap.exists || !invoiceSnap.exists) return 'skip';
        const sub = subSnap.data() || {};
        const invoice = invoiceSnap.data() || {};
        const restaurant = restaurantSnap.data() || {};
        if (sub.status !== 'past_due' || invoice.status === 'paid' ||
            restaurant.status === 'deleted' || restaurant.deletedAt) return 'skip';
        const grace = Number.isSafeInteger(sub.gracePeriodDays) ? sub.gracePeriodDays : 7;
        const pastDueAt = Number(sub.pastDueAt || invoice.dueAt || 0);
        if (now < pastDueAt + grace * DAY_MS) return 'skip';
        const nextVersion = Number(restaurant.tableSessionVersion || 0) + 1;
        tx.update(subscriptionRef, { status: 'suspended', suspendedAt: now, suspensionReason: 'subscription_past_due', updatedAt: now });
        tx.update(restaurantRef, {
          status: 'suspended', isOpen: false,
          isOpenBeforeSuspension: restaurant.status === 'suspended' ? restaurant.isOpenBeforeSuspension === true : restaurant.isOpen === true,
          suspendedAt: now, suspensionReason: 'subscription_past_due',
          tableSessionVersion: nextVersion
        });
        tx.create(db.collection('admin_audit_logs').doc(`sub_suspend_${hash(slug + ':' + currentInvoiceId)}`), {
          action: 'suspend_overdue_subscription', restaurantSlug: slug,
          invoiceId: currentInvoiceId, createdAt: now
        });
        return 'suspended';
      });
      if (result === 'suspended') {
        await revokeActiveTableSessions(db, slug, now, 'subscription_past_due');
        restaurantsSuspended++;
      } else skipped++;
    }
  }

  return { success: true, subscriptionsScanned: subscriptions.size, invoicesCreated, restaurantsSuspended, skipped };
}

export async function settleSubscriptionInvoiceWithDb(
  db: any,
  input: { restaurantSlug: string; invoiceId: string; amountFcfa: number; paymentReference: string; actorUid: string; now?: number }
) {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const slug = String(input.restaurantSlug || '').trim();
  const invoiceId = String(input.invoiceId || '').trim();
  const paymentReference = String(input.paymentReference || '').trim().slice(0, 128);
  const now = Number(input.now || Date.now());
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^subinv_[a-f0-9]{32}$/.test(invoiceId) ||
      !Number.isSafeInteger(input.amountFcfa) || input.amountFcfa < 0 ||
      paymentReference.length < 4 || !input.actorUid) {
    return { success: false, error: 'Informations de règlement de facture invalides.' };
  }
  const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
  const restaurantRef = db.collection('restaurants').doc(slug);
  const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId);
  return db.runTransaction(async (tx: any) => {
    const [subSnap, restaurantSnap, invoiceSnap] = await Promise.all([
      tx.get(subscriptionRef), tx.get(restaurantRef), tx.get(invoiceRef)
    ]);
    if (!subSnap.exists || !restaurantSnap.exists || !invoiceSnap.exists) {
      return { success: false, error: 'Abonnement ou facture introuvable.' };
    }
    const sub = subSnap.data() || {};
    const restaurant = restaurantSnap.data() || {};
    const invoice = invoiceSnap.data() || {};
    if (invoice.status === 'paid') {
      if (invoice.paymentReference === paymentReference) return { success: true, idempotentReplay: true, invoice };
      return { success: false, conflict: true, error: 'Cette facture est déjà réglée avec une autre référence.' };
    }
    if (invoice.status !== 'open' || String(sub.currentInvoiceId || '') !== invoiceId ||
        input.amountFcfa !== Number(invoice.amountFcfa)) {
      return { success: false, conflict: true, error: 'Le montant ou le statut de la facture ne correspond pas.' };
    }
    const cycle = String(sub.billingCycle || '');
    if (cycle !== 'monthly' && cycle !== 'yearly') {
      return { success: false, error: 'Le renouvellement automatique exige une périodicité mensuelle ou annuelle.' };
    }
    const periodStart = Math.max(Number(sub.endsAt || now), now);
    const periodEnd = addBillingCycle(periodStart, cycle);
    const updatedInvoice = {
      ...invoice, status: 'paid', paidAt: now, paymentReference,
      amountPaidFcfa: input.amountFcfa, paidBy: input.actorUid
    };
    tx.update(invoiceRef, updatedInvoice);
    tx.update(subscriptionRef, {
      status: 'active', startsAt: periodStart, endsAt: periodEnd, nextBillingAt: periodEnd,
      currentInvoiceId: null, pastDueAt: null, suspendedAt: null,
      suspensionReason: null, lastInvoicePaidAt: now, lastPaymentReference: paymentReference,
      updatedAt: now, updatedBy: input.actorUid
    });
    if (restaurant.status === 'suspended' && restaurant.suspensionReason === 'subscription_past_due') {
      tx.update(restaurantRef, {
        status: 'active', isOpen: restaurant.isOpenBeforeSuspension === true,
        isOpenBeforeSuspension: null, suspendedAt: null, suspensionReason: null,
        reactivatedAt: now, reactivatedBy: input.actorUid
      });
    }
    tx.create(db.collection('admin_audit_logs').doc(`sub_paid_${hash(slug + ':' + invoiceId)}`), {
      action: 'settle_subscription_invoice', restaurantSlug: slug,
      invoiceId, amountFcfa: input.amountFcfa, paymentReference, actorUid: input.actorUid, createdAt: now
    });
    return { success: true, idempotentReplay: false, invoice: updatedInvoice, subscription: {
      status: 'active', startsAt: periodStart, endsAt: periodEnd, nextBillingAt: periodEnd
    } };
  });
}
