import { createHash } from 'node:crypto';
import { issueTableQr } from './tableSecurityService.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const DAY_MS = 24 * 60 * 60 * 1000;


export function resolveSubscriptionInvoiceGraceEndsAt(invoice: any, fallbackGracePeriodDays = 7): number | null {
  const configuredFallback = Number(fallbackGracePeriodDays);
  const fallback = Number.isInteger(configuredFallback) && configuredFallback >= 0 && configuredFallback <= 60
    ? configuredFallback : 7;
  const configuredDays = Number(invoice?.gracePeriodDays);
  const graceDays = Number.isInteger(configuredDays) && configuredDays >= 0 && configuredDays <= 60
    ? configuredDays : fallback;
  const explicitGraceEnd = Number(invoice?.graceEndsAt);
  if (Number.isFinite(explicitGraceEnd) && explicitGraceEnd > 0) return explicitGraceEnd;
  const dueAt = Number(invoice?.dueAt);
  return Number.isFinite(dueAt) && dueAt > 0 ? dueAt + graceDays * DAY_MS : null;
}

export function resolveSubscriptionInvoiceStatus(invoice: any, now = Date.now(), fallbackGracePeriodDays = 7) {
  const status = String(invoice?.status || '');
  if (status !== 'open') {
    return ['paid', 'void', 'overdue'].includes(status) ? status : 'unknown';
  }
  const graceEndsAt = resolveSubscriptionInvoiceGraceEndsAt(invoice, fallbackGracePeriodDays);
  return graceEndsAt !== null && graceEndsAt <= now ? 'overdue' : 'open';
}

function planIdentifier(name: string) {
  return String(name || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '').slice(0, 60) || 'plan';
}

export function resolveSubscriptionInvoiceIdentity(ref: any, invoice: any) {
  const segments = String(ref?.path || '').split('/');
  if (segments.length !== 4 || segments[0] !== 'restaurantSubscriptions' || segments[2] !== 'invoices') return null;
  const restaurantSlug = segments[1];
  const invoiceId = segments[3];
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug) || !/^[a-zA-Z0-9_-]{1,160}$/.test(invoiceId)) return null;
  if (invoice?.restaurantSlug && String(invoice.restaurantSlug) !== restaurantSlug) return null;
  if (invoice?.id && String(invoice.id) !== invoiceId) return null;
  return { restaurantSlug, invoiceId };
}

function invoiceIdFor(slug: string, billingCycle: string, nextBillingAt: number) {
  return `subinv_${hash(`${slug}:${billingCycle}:${nextBillingAt}`)}`;
}

function addBillingCycle(timestamp: number, cycle: string) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  if (cycle === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (cycle === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3);
  else if (cycle === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else throw new Error('Périodicité de facturation inconnue.');
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

async function revokeActiveTableSessions(db: any, slug: string, now: number, reason: string) {
  const restaurantRef = db.collection('restaurants').doc(slug);
  const [sessions, tokens] = await Promise.all([
    restaurantRef.collection('table_sessions').where('status', '==', 'active').get(),
    restaurantRef.collection('table_qr_tokens').where('status', '==', 'active').get()
  ]);
  const targets = [
    ...sessions.docs.map((doc: any) => ({ ref: doc.ref, type: 'table_session' })),
    ...tokens.docs.map((doc: any) => ({ ref: doc.ref, type: 'table_qr_token' }))
  ];
  for (let offset = 0; offset < targets.length; offset += 400) {
    const batch = db.batch();
    targets.slice(offset, offset + 400).forEach((target: any) => {
      batch.update(target.ref, {
        status: 'revoked', revokedAt: now, revokedReason: reason,
        ...(target.type === 'table_qr_token' ? { updatedAt: now } : {})
      });
    });
    await batch.commit();
  }
}

export async function runSubscriptionBillingCycleWithDb(db: any, now = Date.now()) {
  if (!db) throw new Error('Firestore indisponible.');
  const [subscriptions, configSnap, promotionsSnap] = await Promise.all([
    db.collection('restaurantSubscriptions').get(),
    db.collection('platform_config').doc('global').get(),
    db.collection('platform_promotions').where('active', '==', true).limit(100).get()
  ]);
  const configuredGrace = Number(configSnap.data()?.gracePeriodDays);
  const globalGracePeriodDays = Number.isInteger(configuredGrace) && configuredGrace >= 0 && configuredGrace <= 60 ? configuredGrace : 7;
  const configuredQuarterlyDiscount = Number(configSnap.data()?.quarterlyDiscountPercent);
  const quarterlyDiscountPercent = Number.isInteger(configuredQuarterlyDiscount) && configuredQuarterlyDiscount >= 0 && configuredQuarterlyDiscount <= 100 ? configuredQuarterlyDiscount : 0;
  const resolveGracePeriod = (subscription: any, fallback = globalGracePeriodDays) => {
    const value = Number(subscription?.gracePeriodDays);
    const valid = Number.isInteger(value) && value >= 0 && value <= 60;
    if (subscription?.gracePeriodOverride === false) return globalGracePeriodDays;
    if (valid) return value; // Preserve existing per-subscription overrides for legacy records.
    return fallback;
  };
  let invoicesCreated = 0;
  let freePlansRenewed = 0;
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

    if (status === 'suspended' &&
        ['subscription_past_due', 'subscription_nonrenewal'].includes(String(initial.suspensionReason || ''))) {
      await revokeActiveTableSessions(db, slug, now, String(initial.suspensionReason));
      skipped++;
      continue;
    }

    if (['active', 'trial'].includes(status) && nextBillingAt > 0 && nextBillingAt <= now) {
      const invoiceId = invoiceIdFor(slug, String(initial.billingCycle || ''), nextBillingAt);
      const promotionCandidates = promotionsSnap.docs.filter((promotionDoc: any) => {
        const promotion = promotionDoc.data() || {};
        const eligiblePlans = Array.isArray(promotion.eligiblePlans) ? promotion.eligiblePlans : [];
        return eligiblePlans.includes(String(initial.planName || '')) &&
          Number(promotion.startsAt || 0) <= now && Number(promotion.endsAt || 0) > now &&
          Number(promotion.usedCount || 0) < Number(promotion.maxUses || 0);
      }).sort((a: any, b: any) => {
        const base = Number(initial.priceFcfa || 0);
        const estimate = (doc: any) => {
          const promotion = doc.data() || {};
          return promotion.discountType === 'fixed'
            ? Math.min(base, Number(promotion.value || 0))
            : Math.round(base * Number(promotion.value || 0) / 100);
        };
        return estimate(b) - estimate(a);
      });
      const promotionRefs = promotionCandidates.map((promotionDoc: any) => promotionDoc.ref);
      const result = await db.runTransaction(async (tx: any) => {
        const snapshots = await Promise.all([
          tx.get(subscriptionRef), tx.get(restaurantRef),
          tx.get(subscriptionRef.collection('invoices').doc(invoiceId)),
          ...promotionRefs.map((ref: any) => tx.get(ref))
        ]);
        const subSnap = snapshots[0];
        const restaurantSnap = snapshots[1];
        const invoiceSnap = snapshots[2];
        const promotionSnaps = snapshots.slice(3);
        if (!subSnap.exists || !restaurantSnap.exists) return 'skip';
        const sub = subSnap.data() || {};
        const restaurant = restaurantSnap.data() || {};
        if (!['active', 'trial'].includes(String(sub.status || '')) ||
            Number(sub.nextBillingAt || sub.endsAt || 0) > now ||
            restaurant.status === 'deleted' || restaurant.deletedAt ||
            (restaurant.status !== 'active' && restaurant.suspensionReason !== 'subscription_past_due')) return 'skip';
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
        const cycle = String(sub.billingCycle || '');
        const configuredPlans = Array.isArray(configSnap.data()?.plans) ? configSnap.data().plans : [];
        const subscriptionPlanId = String(sub.planId || '');
        const configuredPlan = configuredPlans.find((plan: any) => subscriptionPlanId
          ? String(plan?.id || planIdentifier(String(plan?.name || ''))) === subscriptionPlanId
          : String(plan?.name || '') === String(sub.planName || '')
        );
        const monthlyPlanPrice = Number(sub.planPriceMonthlyFcfa ?? configuredPlan?.priceMonthlyFcfa ?? 0);
        const cycleMultiplier = cycle === 'quarterly' ? 3 : cycle === 'yearly' ? 12 : 1;
        // The subscription price is a signed snapshot. Catalog edits must not
        // silently reprice an existing contract; legacy records are backfilled
        // from the catalog only when no subscription price snapshot exists.
        const configuredCyclePrice = Number.isSafeInteger(Number(sub.priceFcfa))
          ? Number(sub.priceFcfa)
          : monthlyPlanPrice > 0 && cycle !== 'custom' ? monthlyPlanPrice * cycleMultiplier : Number.NaN;
        const baseAmount = Number(configuredCyclePrice);
        if (!Number.isSafeInteger(baseAmount) || baseAmount < 0 || baseAmount > 1000000000) return 'skip';
        let discountPercent = cycle === 'quarterly' ? quarterlyDiscountPercent : 0;
        let discountAmount = Math.round(baseAmount * discountPercent / 100);
        let discountSource = discountAmount > 0 ? 'quarterly' : 'none';
        let discountType = discountSource === 'quarterly' ? 'percentage' : 'none';
        let discountValue = discountSource === 'quarterly' ? discountPercent : 0;
        let appliedPromotion: any = null;
        let appliedPromotionRef: any = null;
        for (const promotionSnap of promotionSnaps) {
          if (!promotionSnap?.exists) continue;
          const promotion = promotionSnap.data() || {};
          const eligiblePlans = Array.isArray(promotion.eligiblePlans) ? promotion.eligiblePlans : [];
          const usedCount = Number(promotion.usedCount || 0);
          const maxUses = Number(promotion.maxUses || 0);
          const validPromotion = promotion.active === true && eligiblePlans.includes(String(sub.planName || '')) &&
            Number(promotion.startsAt || 0) <= now && Number(promotion.endsAt || 0) > now &&
            Number.isInteger(usedCount) && Number.isInteger(maxUses) && usedCount < maxUses;
          if (!validPromotion) continue;
          const promoType = promotion.discountType === 'fixed' ? 'fixed' : 'percentage';
          const promoValue = Number(promotion.value || 0);
          if (!Number.isSafeInteger(promoValue) || promoValue < 1 ||
              (promoType === 'percentage' && promoValue > 100) ||
              (promoType === 'fixed' && promoValue > 1000000000)) continue;
          const promoAmount = promoType === 'fixed'
            ? Math.min(baseAmount, promoValue)
            : Math.round(baseAmount * promoValue / 100);
          // No stacking: apply the single best available reduction.
          if (Number.isSafeInteger(promoAmount) && promoAmount > discountAmount) {
            discountAmount = promoAmount;
            discountPercent = promoType === 'percentage' ? promoValue : 0;
            discountSource = 'promotion';
            discountType = promoType;
            discountValue = promoValue;
            appliedPromotion = { id: promotionSnap.id, ...promotion };
            appliedPromotionRef = promotionSnap.ref;
          }
        }
        const amount = baseAmount - discountAmount;
        if (amount === 0 && ['monthly', 'quarterly', 'yearly'].includes(cycle)) {
          const periodStart = Math.max(Number(sub.endsAt || now), now);
          const periodEnd = addBillingCycle(periodStart, cycle);
          tx.update(subscriptionRef, {
            status: 'active', startsAt: periodStart, endsAt: periodEnd, nextBillingAt: periodEnd,
            pastDueAt: null, currentInvoiceId: null, lastInvoicePaidAt: now,
            lastPaymentReference: 'free-plan-renewal', lastDiscountBaseAmountFcfa: baseAmount,
            lastDiscountPercent: discountPercent, lastDiscountAmountFcfa: discountAmount,
            lastDiscountSource: discountSource, lastPromotionId: appliedPromotion?.id || null,
            lastPromotionCode: appliedPromotion?.code || null, lastDiscountedAt: now, updatedAt: now
          });
          if (appliedPromotion && appliedPromotionRef) {
            tx.update(appliedPromotionRef, { usedCount: Number(appliedPromotion.usedCount || 0) + 1, updatedAt: now });
          }
          tx.create(db.collection('admin_audit_logs').doc(`sub_free_renew_${hash(slug + ':' + invoiceId)}`), {
            action: 'renew_free_subscription', restaurantSlug: slug, baseAmountFcfa: baseAmount,
            discountPercent, discountAmountFcfa: discountAmount, discountSource,
            promotionId: appliedPromotion?.id || null, promotionCode: appliedPromotion?.code || null, createdAt: now
          });
          return 'free_renewed';
        }
        const gracePeriodDays = resolveGracePeriod(sub);
        const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId);
        tx.create(invoiceRef, {
          id: invoiceId, restaurantSlug: slug, planId: String(sub.planId || ''),
          planName: String(sub.planName || ''), planPriceMonthlyFcfa: Number(sub.planPriceMonthlyFcfa || 0),
          contractPriceFcfa: baseAmount, billingCycle: cycle,
          baseAmountFcfa: baseAmount, discountPercent, discountAmountFcfa: discountAmount,
          discountSource, discountType, discountValue,
          promotionId: appliedPromotion?.id || null, promotionCode: appliedPromotion?.code || null,
          promotionName: appliedPromotion?.name || null, amountFcfa: amount, currency: 'XOF',
          periodStartAt: nextBillingAt, periodEndAt: addBillingCycle(nextBillingAt, cycle),
          issuedAt: now, dueAt: now, gracePeriodDays, graceEndsAt: now + gracePeriodDays * DAY_MS, status: 'open',
          createdAt: now
        });
        tx.update(subscriptionRef, {
          status: 'past_due', pastDueAt: now, currentInvoiceId: invoiceId,
          currentInvoiceAmountFcfa: amount, gracePeriodDays, updatedAt: now
        });
        tx.create(db.collection('admin_audit_logs').doc(`sub_invoice_${hash(slug + ':' + invoiceId)}`), {
          action: 'create_recurring_subscription_invoice', restaurantSlug: slug,
          invoiceId, amountFcfa: amount, baseAmountFcfa: baseAmount, discountPercent,
          discountAmountFcfa: discountAmount, discountSource,
          promotionId: appliedPromotion?.id || null, promotionCode: appliedPromotion?.code || null, createdAt: now
        });
        if (appliedPromotion && appliedPromotionRef) {
          tx.update(appliedPromotionRef, { usedCount: Number(appliedPromotion.usedCount || 0) + 1, updatedAt: now });
        }
        return 'created';
      });
      if (result === 'created') invoicesCreated++;
      else if (result === 'free_renewed') freePlansRenewed++;
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
            restaurant.status === 'deleted' || restaurant.deletedAt ||
            (restaurant.status !== 'active' && restaurant.suspensionReason !== 'subscription_past_due')) return 'skip';
        const invoiceGrace = Number(invoice.gracePeriodDays);
        const grace = Number.isInteger(invoiceGrace) && invoiceGrace >= 0 && invoiceGrace <= 60 ? invoiceGrace : resolveGracePeriod(sub);
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

  return { success: true, subscriptionsScanned: subscriptions.size, invoicesCreated, freePlansRenewed, restaurantsSuspended, skipped };
}

export async function settleSubscriptionInvoiceWithDb(
  db: any,
  input: { restaurantSlug: string; invoiceId: string; amountFcfa: number; paymentReference: string; actorUid: string; now?: number; origin?: string }
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
  const paymentId = `subpay_${hash(slug + ':' + invoiceId + ':' + paymentReference)}`;
  const paymentRef = subscriptionRef.collection('payments').doc(paymentId);
  const referenceKey = hash(paymentReference.normalize('NFKC').toLocaleUpperCase('en-US'));
  const referenceIndexRef = db.collection('subscription_payment_reference_index').doc(referenceKey);
  const settlement = await db.runTransaction(async (tx: any) => {
    const [subSnap, restaurantSnap, invoiceSnap, paymentSnap, referenceIndexSnap] = await Promise.all([
      tx.get(subscriptionRef), tx.get(restaurantRef), tx.get(invoiceRef), tx.get(paymentRef), tx.get(referenceIndexRef)
    ]);
    if (!subSnap.exists || !restaurantSnap.exists || !invoiceSnap.exists) {
      return { success: false, error: 'Abonnement ou facture introuvable.' };
    }
    const sub = subSnap.data() || {};
    const restaurant = restaurantSnap.data() || {};
    const invoice = invoiceSnap.data() || {};
    const identity = resolveSubscriptionInvoiceIdentity(invoiceRef, invoice);
    if (!identity || identity.restaurantSlug !== slug || identity.invoiceId !== invoiceId ||
        (invoice.planId && sub.planId && String(invoice.planId) !== String(sub.planId)) ||
        (invoice.billingCycle && sub.billingCycle && String(invoice.billingCycle) !== String(sub.billingCycle))) {
      return { success: false, conflict: true, error: 'Le lien entre le restaurant, la formule, l’abonnement et la facture est incohérent.' };
    }
    const referenceIndex = referenceIndexSnap.exists ? referenceIndexSnap.data() || {} : null;
    if (referenceIndex && (referenceIndex.restaurantSlug !== slug || referenceIndex.invoiceId !== invoiceId || referenceIndex.paymentId !== paymentId)) {
      return { success: false, conflict: true, error: 'Cette référence de paiement est déjà utilisée pour une autre facture.' };
    }
    if (invoice.status === 'paid') {
      const recordedPayment = paymentSnap.data() || {};
      if (invoice.paymentReference === paymentReference && input.amountFcfa === Number(invoice.amountFcfa) &&
          paymentSnap.exists && recordedPayment.invoiceId === invoiceId &&
          recordedPayment.restaurantSlug === slug && recordedPayment.paymentReference === paymentReference &&
          Number(recordedPayment.amountFcfa) === input.amountFcfa) {
        return { success: true, idempotentReplay: true, invoice, reactivated: false };
      }
      return { success: false, conflict: true, error: 'Cette facture est déjà réglée ou le règlement enregistré ne correspond pas.' };
    }
    if (!['open', 'overdue'].includes(String(invoice.status)) || String(sub.currentInvoiceId || '') !== invoiceId ||
        input.amountFcfa !== Number(invoice.amountFcfa) || paymentSnap.exists) {
      return { success: false, conflict: true, error: 'Le montant, le statut ou le lien du règlement ne correspond pas à la facture.' };
    }
    const cycle = String(sub.billingCycle || '');
    if (cycle !== 'monthly' && cycle !== 'quarterly' && cycle !== 'yearly') {
      return { success: false, error: 'Le renouvellement automatique exige une périodicité mensuelle, trimestrielle ou annuelle.' };
    }
    const periodStart = Math.max(Number(sub.endsAt || now), now);
    const periodEnd = addBillingCycle(periodStart, cycle);
    const updatedInvoice = {
      ...invoice, status: 'paid', paidAt: now, paymentReference,
      periodStartAt: periodStart, periodEndAt: periodEnd,
      amountPaidFcfa: input.amountFcfa, paidBy: input.actorUid,
      reactivationQrPending: restaurant.status === 'suspended' && restaurant.suspensionReason === 'subscription_past_due'
    };
    tx.update(invoiceRef, { ...updatedInvoice, paymentMethod: 'manual' });
    tx.create(paymentRef, {
      id: paymentId, invoiceId, restaurantSlug: slug,
      amountFcfa: input.amountFcfa, currency: 'XOF', method: 'manual',
      paymentReference, paidAt: now, recordedBy: input.actorUid
    });
    tx.create(referenceIndexRef, {
      referenceHash: referenceKey, paymentReferenceNormalized: paymentReference.normalize('NFKC').toLocaleUpperCase('en-US'),
      restaurantSlug: slug, invoiceId, paymentId, amountFcfa: input.amountFcfa, createdAt: now
    });
    tx.update(subscriptionRef, {
      status: 'active', startsAt: periodStart, endsAt: periodEnd, nextBillingAt: periodEnd,
      currentInvoiceId: null, currentInvoiceAmountFcfa: null, pastDueAt: null, suspendedAt: null,
      suspensionReason: null, lastInvoicePaidAt: now, lastPaymentReference: paymentReference,
      updatedAt: now, updatedBy: input.actorUid
    });
    const reactivated = restaurant.status === 'suspended' && restaurant.suspensionReason === 'subscription_past_due';
    if (reactivated) {
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
    }, reactivated };
  });

  if (!settlement.success) return settlement;
  const shouldReissueQr = settlement.reactivated === true || settlement.invoice?.reactivationQrPending === true;
  if (!shouldReissueQr) return settlement;
  const origin = String(input.origin || process.env.APP_ORIGIN || 'https://restaumax.vercel.app').replace(/\\/+$/, '');
  try {
    const tables = await restaurantRef.collection('tables').where('isActive', '==', true).get();
    const issued: Array<{ tableId: string; url: string }> = [];
    for (const tableDoc of tables.docs) {
      const qr = await issueTableQr(db, slug, tableDoc.id, origin);
      issued.push({ tableId: tableDoc.id, url: qr.url });
    }
    await invoiceRef.update({ reactivationQrPending: false, reactivationQrIssuedAt: now, reactivationQrCount: issued.length });
    return { ...settlement, qrReissued: true, qrCount: issued.length, qrUrls: issued };
  } catch (error: any) {
    await invoiceRef.update({ reactivationQrPending: true, reactivationQrLastError: String(error?.message || 'qr_reissue_failed').slice(0, 160) }).catch(() => undefined);
    return { ...settlement, qrReissued: false, qrReissuePending: true };
  }
}


/**
 * Read-only audit of historical subscription invoices and payment records.
 * It reports anomalies only; it never repairs or mutates financial history.
 */
export async function reconcileSubscriptionBillingWithDb(db: any) {
  if (!db) throw new Error('Firestore indisponible.');
  const subscriptions = await db.collection('restaurantSubscriptions').get();
  const invoiceByKey = new Map<string, any>();
  const paymentRows: any[] = [];
  const unmatchedInvoices: any[] = [];
  const paidInvoicesWithoutPayment: any[] = [];
  const orphanPayments: any[] = [];
  const amountMismatches: any[] = [];
  const duplicateReferences = new Map<string, any[]>();

  for (const subscriptionDoc of subscriptions.docs) {
    const slug = subscriptionDoc.id;
    const [invoicesSnap, paymentsSnap] = await Promise.all([
      subscriptionDoc.ref.collection('invoices').get(),
      subscriptionDoc.ref.collection('payments').get()
    ]);
    for (const invoiceDoc of invoicesSnap.docs) {
      const invoice = invoiceDoc.data() || {};
      const identity = resolveSubscriptionInvoiceIdentity(invoiceDoc.ref, invoice);
      if (!identity || identity.restaurantSlug !== slug || identity.invoiceId !== invoiceDoc.id) continue;
      invoiceByKey.set(slug + '/' + invoiceDoc.id, { ...invoice, id: invoiceDoc.id, restaurantSlug: slug });
    }
    for (const paymentDoc of paymentsSnap.docs) {
      const payment = paymentDoc.data() || {};
      const reference = String(payment.paymentReference || '').normalize('NFKC').trim().toLocaleUpperCase('en-US');
      const row = { id: paymentDoc.id, restaurantSlug: slug, ...payment };
      paymentRows.push(row);
      if (reference) {
        const rows = duplicateReferences.get(reference) || [];
        rows.push(row);
        duplicateReferences.set(reference, rows);
      }
    }
  }

  const paymentsByInvoice = new Map<string, any[]>();
  for (const payment of paymentRows) {
    const slug = String(payment.restaurantSlug || '');
    const invoiceId = String(payment.invoiceId || '');
    const key = slug + '/' + invoiceId;
    if (!invoiceId || !invoiceByKey.has(key)) {
      orphanPayments.push({ paymentId: payment.id, restaurantSlug: slug, invoiceId: invoiceId || null, amountFcfa: payment.amountFcfa ?? null });
      continue;
    }
    const rows = paymentsByInvoice.get(key) || [];
    rows.push(payment);
    paymentsByInvoice.set(key, rows);
    const invoice = invoiceByKey.get(key);
    if (Number.isSafeInteger(invoice.amountFcfa) && Number.isSafeInteger(payment.amountFcfa) &&
        invoice.amountFcfa !== payment.amountFcfa) {
      amountMismatches.push({ restaurantSlug: slug, invoiceId, invoiceAmountFcfa: invoice.amountFcfa, paymentId: payment.id, paymentAmountFcfa: payment.amountFcfa });
    }
  }

  for (const [key, invoice] of invoiceByKey.entries()) {
    const payments = paymentsByInvoice.get(key) || [];
    if (['open', 'overdue'].includes(String(invoice.status)) && payments.length === 0) {
      unmatchedInvoices.push({ restaurantSlug: invoice.restaurantSlug, invoiceId: invoice.id, status: invoice.status, amountFcfa: invoice.amountFcfa ?? null, issuedAt: invoice.issuedAt ?? null });
    }
    if (invoice.status === 'paid' && payments.length === 0) {
      paidInvoicesWithoutPayment.push({ restaurantSlug: invoice.restaurantSlug, invoiceId: invoice.id, amountFcfa: invoice.amountFcfa ?? null, paymentReference: invoice.paymentReference ?? null });
    }
  }

  const duplicatePaymentReferences = [...duplicateReferences.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([reference, rows]) => ({
      reference,
      occurrences: rows.length,
      payments: rows.map(row => ({ paymentId: row.id, restaurantSlug: row.restaurantSlug, invoiceId: row.invoiceId || null, amountFcfa: row.amountFcfa ?? null }))
    }));

  return {
    readOnly: true,
    scannedAt: Date.now(),
    subscriptionsScanned: subscriptions.size,
    invoicesScanned: invoiceByKey.size,
    paymentsScanned: paymentRows.length,
    summary: {
      duplicatePaymentReferences: duplicatePaymentReferences.length,
      amountMismatches: amountMismatches.length,
      orphanPayments: orphanPayments.length,
      unmatchedInvoices: unmatchedInvoices.length,
      paidInvoicesWithoutPayment: paidInvoicesWithoutPayment.length
    },
    anomalies: {
      duplicatePaymentReferences: duplicatePaymentReferences.slice(0, 500),
      amountMismatches: amountMismatches.slice(0, 500),
      orphanPayments: orphanPayments.slice(0, 500),
      unmatchedInvoices: unmatchedInvoices.slice(0, 500),
      paidInvoicesWithoutPayment: paidInvoicesWithoutPayment.slice(0, 500)
    }
  };
}
