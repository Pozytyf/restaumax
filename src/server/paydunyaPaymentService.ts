import { createHash } from 'node:crypto';
import {
  createPayDunyaCheckoutInvoice,
  confirmPayDunyaInvoice,
  verifyPayDunyaCallback,
  type PayDunyaConfig,
  type PayDunyaCiWithdrawMode
} from './paydunyaService.js';

const CI_CHANNELS = new Set<PayDunyaCiWithdrawMode>([
  'orange-money-ci', 'wave-ci', 'mtn-ci', 'moov-ci', 'djamo-ci'
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function clean(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
}
function normalizePhone(value: unknown): string | null {
  const digits = clean(value, 32).replace(/\D/g, '');
  const localPhone = digits.startsWith('225') && digits.length === 13 ? digits.slice(3) : digits;
  // Côte d’Ivoire mobile aliases are stored without the +225 country prefix.
  return /^[0-9]{10}$/.test(localPhone) ? localPhone : null;
}
function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function unwrapPayDunyaCallback(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return asObject(JSON.parse(value)); } catch {
      const form = new URLSearchParams(value);
      const data = form.get('data');
      return data ? { data } : {};
    }
  }
  if (value instanceof Uint8Array) {
    return unwrapPayDunyaCallback(new TextDecoder().decode(value));
  }
  return asObject(value);
}

export interface StartPayDunyaOrderPaymentInput {
  restaurantSlug: string;
  orderId: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  idempotencyKey: string;
  callbackUrl: string;
  returnUrl: string;
  cancelUrl: string;
  channel: PayDunyaCiWithdrawMode;
}

export interface StartPayDunyaOrderPaymentResult {
  success: boolean;
  conflict?: boolean;
  error?: string;
  paymentIntentId?: string;
  checkoutUrl?: string;
  amount?: number;
  idempotentReplay?: boolean;
}

/**
 * Creates a server-priced hosted checkout invoice for the unpaid balance of one order.
 * Customer phone and provider channel are not trusted from the browser; PayDunya's
 * signed confirmation is the source of the payer identity used for any later refund.
 */
export async function startPayDunyaOrderPaymentWithDb(
  db: any,
  config: PayDunyaConfig,
  input: StartPayDunyaOrderPaymentInput,
  fetchImpl: typeof fetch = fetch
): Promise<StartPayDunyaOrderPaymentResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const slug = clean(input.restaurantSlug, 100);
  const orderId = clean(input.orderId, 128);
  const actorUid = clean(input.actorUid, 128);
  const key = clean(input.idempotencyKey, 128);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId) ||
      !actorUid || !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !CI_CHANNELS.has(input.channel)) {
    return { success: false, error: 'Paramètres de paiement PayDunya invalides.' };
  }
  for (const urlValue of [input.callbackUrl, input.returnUrl, input.cancelUrl]) {
    try {
      const url = new URL(urlValue);
      if (url.protocol !== 'https:' || url.hostname !== 'restaumax.vercel.app') {
        return { success: false, error: 'Les URL de retour PayDunya doivent appartenir au domaine HTTPS RestauMax.' };
      }
    } catch { return { success: false, error: 'URL de paiement PayDunya invalide.' }; }
  }

  const namespace = `${slug}::${orderId}::${key}`;
  const intentId = `pdi_${sha256(namespace).slice(0, 32)}`;
  const signature = sha256(JSON.stringify({ slug, orderId, channel: input.channel }));
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const orderRef = restaurantRef.collection('orders').doc(orderId);
  const intentRef = restaurantRef.collection('paymentIntents').doc(intentId);
  const reservation = await db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, orderSnap, intentSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(orderRef), tx.get(intentRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    const order = orderSnap.exists ? orderSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(member.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { ok: false, error: 'Compte inactif, session révoquée ou accès au restaurant refusé.' };
    }
    const authorized = (member.role === 'owner' && restaurant.ownerUid === actorUid) ||
      member.role === 'manager' ||
      (member.role === 'cashier' && Array.isArray(member.permissions) && member.permissions.includes('cash.manage'));
    if (!authorized) return { ok: false, error: 'Votre rôle ne permet pas de créer un paiement.' };
    if (!order || order.restaurantSlug !== slug || order.status === 'cancelled') {
      return { ok: false, error: 'Commande introuvable, annulée ou rattachée à un autre restaurant.' };
    }
    if (Number(order.splitGuests || 1) > 1 ||
        (Array.isArray(order.guestAccounts) && order.guestAccounts.length > 1)) {
      return { ok: false, error: 'Le paiement Mobile Money des factures partagées sera activé après validation du rapprochement par convive.' };
    }
    if (intentSnap.exists) {
      const previous = intentSnap.data();
      if (previous.signature !== signature || previous.actorUid !== actorUid) {
        return { ok: false, conflict: true, error: 'Clé d’idempotence déjà utilisée pour une autre demande.' };
      }
      if (previous.status === 'pending' && previous.checkoutUrl) {
        return { ok: true, replay: true, intentId, amount: previous.amount, checkoutUrl: previous.checkoutUrl };
      }
      return { ok: false, conflict: true, error: 'Cette demande de paiement existe déjà mais son résultat fournisseur doit être rapproché avant toute nouvelle tentative.' };
    }
    const total = Number(order.totalAmount);
    const paid = Number(order.paidAmount || 0);
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(paid) || paid < 0 || paid >= total) {
      return { ok: false, error: 'Le solde de la commande est nul ou incohérent.' };
    }
    if (order.pendingPayDunyaIntentId && order.pendingPayDunyaIntentId !== intentId) {
      return { ok: false, conflict: true, error: 'Une autre facture PayDunya est déjà ouverte pour cette commande. Attendez sa confirmation ou son annulation.' };
    }
    const amount = total - paid;
    const now = Date.now();
    tx.create(intentRef, {
      id: intentId, restaurantSlug: slug, orderId, actorUid,
      actorName: clean(input.actorName, 100), actorRole: member.role,
      signature, amount, currency: 'XOF', channel: input.channel,
      status: 'creating', createdAt: now, updatedAt: now
    });
    tx.update(orderRef, { pendingPayDunyaIntentId: intentId, pendingPayDunyaAmount: amount });
    return { ok: true, replay: false, intentId, amount, order, restaurant };
  });
  if (!reservation.ok) return { success: false, conflict: 'conflict' in reservation ? reservation.conflict : false, error: reservation.error };
  if (reservation.replay) {
    return { success: true, idempotentReplay: true, paymentIntentId: reservation.intentId,
      checkoutUrl: reservation.checkoutUrl, amount: reservation.amount };
  }

  const order = reservation.order;
  const restaurant = reservation.restaurant;
  const items = (Array.isArray(order.items) ? order.items : []).slice(0, 50).map((item: any) => {
    const quantity = Number(item.quantity || 1);
    const totalPrice = Number(item.totalPrice ?? (Number(item.unitPrice || 0) * quantity));
    const unitPrice = quantity > 0 ? Math.round(totalPrice / quantity) : 0;
    return { name: clean(item.name, 100), quantity, unitPrice, totalPrice };
  });
  const returnUrl = new URL(input.returnUrl);
  returnUrl.searchParams.set('paymentIntentId', reservation.intentId);
  const cancelUrl = new URL(input.cancelUrl);
  cancelUrl.searchParams.set('paymentIntentId', reservation.intentId);
  const checkout = await createPayDunyaCheckoutInvoice(config, {
    amount: reservation.amount,
    description: `RestauMax · commande ${clean(order.orderNumber || orderId, 48)}`,
    restaurantSlug: slug,
    restaurantName: clean(restaurant.name || restaurant.restaurantName, 100) || 'RestauMax',
    orderId,
    paymentIntentId: reservation.intentId,
    items,
    callbackUrl: input.callbackUrl,
    returnUrl: returnUrl.toString(),
    cancelUrl: cancelUrl.toString(),
    channels: [input.channel]
  }, fetchImpl);

  if (!checkout.success) {
    await intentRef.update({ status: 'creation_unknown', updatedAt: Date.now(), lastProviderError: clean(checkout.error, 180) });
    return { success: false, conflict: true, error: 'PayDunya n’a pas confirmé la création de la facture. La demande est bloquée pour rapprochement ; ne relancez pas avec la même référence.' };
  }

  const tokenHash = sha256(checkout.data.token);
  await db.runTransaction(async (tx: any) => {
    const mappingRef = db.collection('paydunya_invoice_tokens').doc(tokenHash);
    const [intentSnap, mappingSnap] = await Promise.all([tx.get(intentRef), tx.get(mappingRef)]);
    if (!intentSnap.exists || intentSnap.data()?.status !== 'creating') {
      throw new Error('Réservation de paiement modifiée pendant la création PayDunya.');
    }
    if (mappingSnap.exists && mappingSnap.data()?.intentId !== reservation.intentId) {
      throw new Error('Token PayDunya déjà associé à une autre facture.');
    }
    tx.set(mappingRef, { restaurantSlug: slug, intentId: reservation.intentId, createdAt: Date.now() });
    tx.update(intentRef, {
      status: 'pending', provider: 'paydunya', invoiceToken: checkout.data.token,
      checkoutUrl: checkout.data.checkoutUrl, updatedAt: Date.now()
    });
  });
  return { success: true, paymentIntentId: reservation.intentId,
    checkoutUrl: checkout.data.checkoutUrl, amount: reservation.amount };
}

export interface PayDunyaCallbackResult {
  success: boolean;
  conflict?: boolean;
  error?: string;
  status?: string;
  paymentId?: string;
  idempotentReplay?: boolean;
}

/**
 * The callback body is signature-checked, then the invoice is independently
 * confirmed server-to-server. Only COMPLETED + matching amount + matching
 * internal references can create a RestauMax payment ledger entry.
 */
export async function processPayDunyaInvoiceCallbackWithDb(
  db: any,
  config: PayDunyaConfig,
  callbackEnvelope: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaCallbackResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const envelope = unwrapPayDunyaCallback(callbackEnvelope);
  let callbackData: any = envelope.data ?? envelope;
  if (typeof callbackData === 'string') {
    try { callbackData = JSON.parse(callbackData); } catch {
      return { success: false, error: 'Corps de notification PayDunya illisible.' };
    }
  }
  const verifiedCallback = verifyPayDunyaCallback(config.masterKey, callbackData);
  if (!verifiedCallback.success) return { success: false, error: verifiedCallback.error };
  const token = clean(verifiedCallback.data.invoice?.token || verifiedCallback.data.token, 128);
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(token)) return { success: false, error: 'Token de facture absent de la notification signée.' };

  const confirmed = await confirmPayDunyaInvoice(config, token, fetchImpl);
  if (!confirmed.success) return { success: false, error: confirmed.error };
  const invoice = confirmed.data;
  if (invoice.status !== 'completed') {
    const tokenHash = sha256(token);
    const mappingSnap = await db.collection('paydunya_invoice_tokens').doc(tokenHash).get();
    if (mappingSnap.exists) {
      const map = mappingSnap.data();
      const restaurantRef = db.collection('restaurants').doc(map.restaurantSlug);
      const intentRef = restaurantRef.collection('paymentIntents').doc(map.intentId);
      const intentRead = await intentRef.get();
      const orderId = clean(intentRead.data()?.orderId, 128);
      if (!intentRead.exists || !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
        return { success: false, error: 'Intention de paiement PayDunya introuvable.' };
      }
      const orderRef = restaurantRef.collection('orders').doc(orderId);
      await db.runTransaction(async (tx: any) => {
        const [intentSnap, orderSnap] = await Promise.all([tx.get(intentRef), tx.get(orderRef)]);
        if (!intentSnap.exists) return;
        const terminal = invoice.status === 'cancelled' || invoice.status === 'failed';
        tx.update(intentRef, {
          status: invoice.status === 'cancelled' ? 'cancelled' : invoice.status === 'failed' ? 'failed' : 'pending',
          updatedAt: Date.now()
        });
        if (terminal && orderSnap.exists && orderSnap.data()?.pendingPayDunyaIntentId === map.intentId) {
          tx.update(orderRef, { pendingPayDunyaIntentId: null, pendingPayDunyaAmount: null });
        }
      });
    }
    return { success: true, status: invoice.status };
  }

  const custom = asObject(invoice.customData);
  const slug = clean(custom.restaurant_slug, 100);
  const orderId = clean(custom.order_id, 128);
  const intentId = clean(custom.payment_intent_id, 128);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId) ||
      !/^pdi_[a-f0-9]{32}$/.test(intentId)) {
    return { success: false, error: 'Références RestauMax absentes de la facture confirmée.' };
  }
  const tokenHash = sha256(token);
  const mappingRef = db.collection('paydunya_invoice_tokens').doc(tokenHash);
  const restaurantRef = db.collection('restaurants').doc(slug);
  const intentRef = restaurantRef.collection('paymentIntents').doc(intentId);
  const orderRef = restaurantRef.collection('orders').doc(orderId);
  const paymentId = `paydunya_${sha256(intentId).slice(0, 28)}`;
  const paymentRef = restaurantRef.collection('payments').doc(paymentId);

  return db.runTransaction(async (tx: any) => {
    const [mappingSnap, intentSnap, orderSnap, paymentSnap] = await Promise.all([
      tx.get(mappingRef), tx.get(intentRef), tx.get(orderRef), tx.get(paymentRef)
    ]);
    if (!mappingSnap.exists || mappingSnap.data()?.restaurantSlug !== slug ||
        mappingSnap.data()?.intentId !== intentId || !intentSnap.exists ||
        intentSnap.data()?.orderId !== orderId || intentSnap.data()?.invoiceToken !== token) {
      return { success: false, error: 'La facture PayDunya ne correspond à aucune intention RestauMax enregistrée.' };
    }
    if (paymentSnap.exists || intentSnap.data()?.status === 'completed') {
      return { success: true, status: 'completed', paymentId, idempotentReplay: true };
    }
    const intent = intentSnap.data();
    const order = orderSnap.exists ? orderSnap.data() : null;
    if (!order || order.restaurantSlug !== slug || order.status === 'cancelled' ||
        order.pendingPayDunyaIntentId !== intentId ||
        Number(invoice.totalAmount) !== Number(intent.amount) ||
        Number(intent.amount) <= 0 || intent.currency !== 'XOF') {
      return { success: false, conflict: true, error: 'Le montant ou la commande ne correspond plus à la facture PayDunya ; rapprochement manuel requis.' };
    }
    const alreadyPaid = Number(order.paidAmount || 0);
    const total = Number(order.totalAmount);
    if (!Number.isSafeInteger(alreadyPaid) || !Number.isSafeInteger(total) ||
        alreadyPaid + Number(intent.amount) > total) {
      return { success: false, conflict: true, error: 'Le solde de commande a changé depuis la création de la facture. Paiement reçu à rapprocher manuellement.' };
    }
    const payerPhone = normalizePhone(invoice.customer?.phone);
    // The invoice was restricted server-side to exactly one CI channel; this is
    // stronger evidence than a client-supplied channel or an undocumented callback field.
    const providerChannel = CI_CHANNELS.has(intent.channel as PayDunyaCiWithdrawMode)
      ? intent.channel as PayDunyaCiWithdrawMode : null;
    const now = Date.now();
    const paidAmount = alreadyPaid + Number(intent.amount);
    const remainingAmount = total - paidAmount;
    const payment = {
      id: paymentId, restaurantSlug: slug, orderId, orderNumber: order.orderNumber || orderId,
      tableNumber: order.tableNumber || null, actorUid: intent.actorUid,
      actorName: intent.actorName || 'Paiement client', actorRole: intent.actorRole || 'system',
      method: 'paydunya', provider: 'paydunya', providerChannel,
      providerInvoiceTokenHash: tokenHash, payerPhone,
      payerPhoneVerified: Boolean(payerPhone), refundEligible: Boolean(payerPhone && providerChannel),
      currency: 'XOF', amountTendered: Number(intent.amount), paidAmount: Number(intent.amount),
      changeAmount: 0, totalAmount: total, previouslyPaidAmount: alreadyPaid,
      remainingBefore: total - alreadyPaid, remainingAfter: remainingAmount,
      paymentStatus: remainingAmount === 0 ? 'paid' : 'partial',
      items: Array.isArray(order.items) ? order.items : [], createdAt: now,
      providerTransactionReference: clean((invoice as any).transactionId, 128) || null
    };
    tx.create(paymentRef, payment);
    tx.update(orderRef, {
      paidAmount, remainingAmount,
      paymentStatus: remainingAmount === 0 ? 'paid' : 'partial',
      lastPaymentAt: now, lastPaymentId: paymentId,
      pendingPayDunyaIntentId: null, pendingPayDunyaAmount: null
    });
    tx.update(intentRef, {
      status: 'completed', paymentId, completedAt: now, updatedAt: now,
      payerPhone, payerPhoneVerified: Boolean(payerPhone), providerChannel,
      refundEligible: Boolean(payerPhone && providerChannel)
    });
    return { success: true, status: 'completed', paymentId, idempotentReplay: false };
  });
}


import {
  createPayDunyaDisbursementInvoice,
  submitPayDunyaDisbursement,
  checkPayDunyaDisbursementStatus,
  type PayDunyaDisbursementConfig
} from './paydunyaService.js';

export interface StartPayDunyaRefundInput {
  restaurantSlug: string;
  paymentId: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  amount: number;
  reason: string;
  idempotencyKey: string;
  callbackUrl: string;
}

export interface PayDunyaRefundResult {
  success: boolean;
  conflict?: boolean;
  error?: string;
  refundId?: string;
  status?: string;
  idempotentReplay?: boolean;
}

async function finalizePayDunyaRefund(
  db: any,
  restaurantSlug: string,
  refundId: string,
  providerStatus: { status: string; token: string; amount?: number; withdrawMode?: string; transactionId?: string; providerReference?: string; disburseId?: string }
): Promise<PayDunyaRefundResult> {
  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const refundRef = restaurantRef.collection('refunds').doc(refundId);
  const snap = await refundRef.get();
  if (!snap.exists) return { success: false, error: 'Remboursement fournisseur introuvable.' };
  const refund = snap.data();
  const paymentRef = restaurantRef.collection('payments').doc(String(refund.paymentId));
  const orderRef = restaurantRef.collection('orders').doc(String(refund.orderId));
  return db.runTransaction(async (tx: any) => {
    const [refundSnap, paymentSnap, orderSnap] = await Promise.all([
      tx.get(refundRef), tx.get(paymentRef), tx.get(orderRef)
    ]);
    if (!refundSnap.exists || !paymentSnap.exists || !orderSnap.exists) {
      return { success: false, error: 'Registre de remboursement incomplet.' };
    }
    const current = refundSnap.data();
    const payment = paymentSnap.data();
    const order = orderSnap.data();
    if (current.status === 'completed' || current.status === 'failed') {
      return { success: true, refundId, status: current.status, idempotentReplay: true };
    }
    if (current.disbursementToken !== providerStatus.token ||
        Number(current.amount) !== Number(providerStatus.amount) ||
        current.providerChannel !== providerStatus.withdrawMode ||
        (providerStatus.disburseId && providerStatus.disburseId !== refundId)) {
      return { success: false, conflict: true, error: 'Le statut fournisseur ne correspond pas au montant, au token ou au canal réservé.' };
    }
    const pendingAmount = Number(payment.refundPendingAmount || 0);
    const refundedAmount = Number(payment.refundedAmount || 0);
    if (pendingAmount < Number(current.amount)) {
      return { success: false, conflict: true, error: 'Réservation de remboursement incohérente.' };
    }
    const now = Date.now();
    if (providerStatus.status === 'pending' || providerStatus.status === 'created') {
      const nextStatus = providerStatus.status;
      tx.update(refundRef, { status: nextStatus, providerTransactionId: providerStatus.transactionId || null, updatedAt: now });
      return { success: true, refundId, status: nextStatus };
    }
    if (providerStatus.status === 'failed') {
      tx.update(refundRef, { status: 'failed', failureAt: now, updatedAt: now });
      tx.update(paymentRef, { refundPendingAmount: Math.max(0, pendingAmount - Number(current.amount)) });
      return { success: true, refundId, status: 'failed' };
    }
    if (providerStatus.status !== 'success') {
      return { success: false, error: 'Statut de décaissement inconnu.' };
    }
    const nextRefunded = refundedAmount + Number(current.amount);
    const totalOrderRefunded = Number(order.refundedAmount || 0) + Number(current.amount);
    if (nextRefunded > Number(payment.paidAmount) ||
        totalOrderRefunded > Number(order.paidAmount || 0)) {
      return { success: false, conflict: true, error: 'Le cumul des remboursements dépasse les montants encaissés.' };
    }
    tx.update(refundRef, {
      status: 'completed', completedAt: now, updatedAt: now,
      providerTransactionId: providerStatus.transactionId || null,
      providerReference: providerStatus.providerReference || null
    });
    tx.update(paymentRef, {
      refundedAmount: nextRefunded,
      refundPendingAmount: Math.max(0, pendingAmount - Number(current.amount)),
      refundStatus: nextRefunded >= Number(payment.paidAmount) ? 'refunded' : 'partially_refunded',
      lastRefundAt: now, lastRefundId: refundId
    });
    tx.update(orderRef, {
      refundedAmount: totalOrderRefunded,
      netPaidAmount: Math.max(0, Number(order.paidAmount || 0) - totalOrderRefunded),
      refundStatus: totalOrderRefunded >= Number(order.paidAmount || 0) ? 'refunded' : 'partially_refunded',
      lastRefundAt: now, lastRefundId: refundId
    });
    return { success: true, refundId, status: 'completed' };
  });
}

/**
 * Mobile Money refund is a two-phase, server-only operation:
 * reserve amount atomically, send PUSH, then settle only after provider status
 * confirms success. A pending/ambiguous request keeps the amount reserved.
 */
export async function startPayDunyaRefundWithDb(
  db: any,
  config: PayDunyaDisbursementConfig,
  input: StartPayDunyaRefundInput,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaRefundResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  if (!config.pushEnabled || config.mode !== 'live') {
    return { success: false, error: 'Le remboursement Mobile Money réel est désactivé. Activation PUSH live explicite requise.' };
  }
  const slug = clean(input.restaurantSlug, 100);
  const paymentId = clean(input.paymentId, 128);
  const actorUid = clean(input.actorUid, 128);
  const key = clean(input.idempotencyKey, 128);
  const reason = clean(input.reason, 300);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(paymentId) || !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !Number.isSafeInteger(input.amount) || input.amount <= 0 ||
      reason.length < 3 || reason.length > 300) {
    return { success: false, error: 'Paramètres de remboursement Mobile Money invalides.' };
  }
  let callback: URL;
  try { callback = new URL(input.callbackUrl); } catch { return { success: false, error: 'URL callback de remboursement invalide.' }; }
  if (callback.protocol !== 'https:' || callback.hostname !== 'restaumax.vercel.app') {
    return { success: false, error: 'Le callback de remboursement doit appartenir au domaine HTTPS RestauMax.' };
  }

  const namespace = `${slug}::${paymentId}::${key}`;
  const refundId = `refund_${sha256(namespace).slice(0, 32)}`;
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const paymentRef = restaurantRef.collection('payments').doc(paymentId);
  const refundRef = restaurantRef.collection('refunds').doc(refundId);
  const reservation = await db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, paymentSnap, refundSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(paymentRef), tx.get(refundRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    const payment = paymentSnap.exists ? paymentSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(member.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { ok: false, error: 'Compte inactif, session révoquée ou accès au restaurant refusé.' };
    }
    const canRefund = (member.role === 'owner' && restaurant.ownerUid === actorUid) ||
      member.role === 'manager' ||
      (member.role === 'cashier' && Array.isArray(member.permissions) && member.permissions.includes('payments.refund'));
    if (!canRefund) return { ok: false, error: 'La permission distincte payments.refund est requise.' };
    if (refundSnap.exists) {
      const previous = refundSnap.data();
      if (previous.actorUid !== actorUid || Number(previous.amount) !== input.amount ||
          previous.paymentId !== paymentId || previous.reason !== reason) {
        return { ok: false, conflict: true, error: 'Clé de remboursement déjà utilisée pour une autre opération.' };
      }
      if (previous.status === 'completed' || previous.status === 'pending' || previous.status === 'created' ||
          previous.status === 'initiating' || previous.status === 'manual_review') {
        return { ok: true, replay: true, status: previous.status };
      }
      return { ok: false, conflict: true, error: 'Cette demande est déjà clôturée. Créez une nouvelle demande après rapprochement.' };
    }
    if (!payment || payment.restaurantSlug !== slug || payment.id !== paymentId ||
        payment.method !== 'paydunya' || payment.payerPhoneVerified !== true ||
        !payment.payerPhone || !CI_CHANNELS.has(payment.providerChannel as PayDunyaCiWithdrawMode)) {
      return { ok: false, error: 'Paiement PayDunya sans numéro et canal d’origine vérifiés : remboursement automatique impossible.' };
    }
    const paid = Number(payment.paidAmount || 0);
    const refunded = Number(payment.refundedAmount || 0);
    const pending = Number(payment.refundPendingAmount || 0);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(refunded) ||
        !Number.isSafeInteger(pending) || input.amount > paid - refunded - pending || input.amount <= 0) {
      return { ok: false, error: 'Le montant dépasse le solde disponible après remboursements déjà exécutés ou en attente.' };
    }
    const orderId = clean(payment.orderId, 128);
    const orderRef = restaurantRef.collection('orders').doc(orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || orderSnap.data()?.restaurantSlug !== slug) {
      return { ok: false, error: 'Commande d’origine introuvable.' };
    }
    const now = Date.now();
    tx.create(refundRef, {
      id: refundId, restaurantSlug: slug, paymentId, orderId,
      amount: input.amount, currency: 'XOF', method: 'paydunya',
      provider: 'paydunya', providerChannel: payment.providerChannel,
      beneficiaryPhone: payment.payerPhone, beneficiaryPhoneVerified: true,
      status: 'initiating', reason, actorUid,
      actorName: clean(input.actorName, 100), actorRole: member.role,
      createdAt: now, idempotencyKeyHash: sha256(key)
    });
    tx.update(paymentRef, { refundPendingAmount: pending + input.amount });
    return {
      ok: true, replay: false, refundId, amount: input.amount,
      phone: payment.payerPhone, channel: payment.providerChannel
    };
  });
  if (!reservation.ok) return { success: false, conflict: 'conflict' in reservation ? reservation.conflict : false, error: reservation.error };
  if (reservation.replay) return { success: true, refundId, status: reservation.status, idempotentReplay: true };

  const created = await createPayDunyaDisbursementInvoice(config, {
    accountAlias: reservation.phone,
    amount: reservation.amount,
    withdrawMode: reservation.channel as PayDunyaCiWithdrawMode,
    callbackUrl: input.callbackUrl,
    disburseId: refundId
  }, fetchImpl);
  if (!created.success) {
    await refundRef.update({ status: 'manual_review', lastProviderError: clean(created.error, 180), updatedAt: Date.now() });
    return { success: false, conflict: true, refundId, error: 'PayDunya n’a pas confirmé la création du décaissement. Le montant reste réservé pour rapprochement manuel ; aucune nouvelle soumission automatique.' };
  }
  const tokenHash = sha256(created.data.token);
  const mappingRef = db.collection('paydunya_disbursement_tokens').doc(tokenHash);
  await db.runTransaction(async (tx: any) => {
    const [refundSnap, mappingSnap] = await Promise.all([tx.get(refundRef), tx.get(mappingRef)]);
    if (!refundSnap.exists || mappingSnap.exists) throw new Error('Conflit de token PayDunya pour ce remboursement.');
    tx.set(mappingRef, { restaurantSlug: slug, refundId, tokenHash, createdAt: Date.now() });
    tx.update(refundRef, { status: 'created', disbursementToken: created.data.token, disbursementTokenHash: tokenHash, updatedAt: Date.now() });
  });

  const submitted = await submitPayDunyaDisbursement(config, created.data.token, refundId, fetchImpl);
  // Even a non-00/ambiguous submit response must be reconciled using the same token
  // before deciding whether another submit is safe.
  let status = await checkPayDunyaDisbursementStatus(config, created.data.token, fetchImpl);
  // PayDunya explicitly permits resubmitting the SAME token only when its
  // check-status endpoint still says "created". This is not a new payout.
  if (status.success && status.data.status === 'created') {
    await submitPayDunyaDisbursement(config, created.data.token, refundId, fetchImpl);
    status = await checkPayDunyaDisbursementStatus(config, created.data.token, fetchImpl);
  }
  if (!status.success) {
    await refundRef.update({
      status: 'pending_verification',
      lastProviderError: submitted.success ? null : clean(submitted.error, 180),
      updatedAt: Date.now()
    });
    return { success: true, refundId, status: 'pending_verification' };
  }
  const finalized = await finalizePayDunyaRefund(db, slug, refundId, status.data);
  return finalized;
}

/** Signed provider callback; the server still checks the token status directly with PayDunya. */
export async function processPayDunyaDisbursementCallbackWithDb(
  db: any,
  config: PayDunyaDisbursementConfig,
  callbackEnvelope: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaRefundResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const envelope = unwrapPayDunyaCallback(callbackEnvelope);
  let callbackData: any = envelope.data ?? envelope;
  if (typeof callbackData === 'string') {
    try { callbackData = JSON.parse(callbackData); } catch {
      return { success: false, error: 'Corps de callback de décaissement illisible.' };
    }
  }
  const verified = verifyPayDunyaCallback(config.masterKey, callbackData);
  if (!verified.success) return { success: false, error: verified.error };
  const token = clean(verified.data.token, 128);
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(token)) return { success: false, error: 'Token de décaissement absent.' };
  const tokenHash = sha256(token);
  const mappingSnap = await db.collection('paydunya_disbursement_tokens').doc(tokenHash).get();
  if (!mappingSnap.exists) return { success: false, error: 'Token de décaissement inconnu.' };
  const mapping = mappingSnap.data();
  const configResult = config;
  const status = await checkPayDunyaDisbursementStatus(configResult, token, fetchImpl);
  if (!status.success) return { success: false, error: status.error };
  if (status.data.token !== token) return { success: false, error: 'Token de statut fournisseur incohérent.' };
  return finalizePayDunyaRefund(db, mapping.restaurantSlug, mapping.refundId, status.data);
}


/**
 * Authenticated staff reconciliation for a customer return when the IPN is delayed.
 * The synthetic local envelope is never exposed to the browser; the actual provider
 * confirmation response must still carry a valid SHA-512 MasterKey hash.
 */
export async function reconcilePayDunyaInvoiceIntentWithDb(
  db: any,
  config: PayDunyaConfig,
  restaurantSlug: string,
  paymentIntentId: string,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaCallbackResult> {
  const slug = clean(restaurantSlug, 100);
  const intentId = clean(paymentIntentId, 128);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^pdi_[a-f0-9]{32}$/.test(intentId)) {
    return { success: false, error: 'Référence de rapprochement PayDunya invalide.' };
  }
  const intentRef = db.collection('restaurants').doc(slug).collection('paymentIntents').doc(intentId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) return { success: false, error: 'Intention de paiement PayDunya introuvable.' };
  const intent = intentSnap.data();
  if (!intent.invoiceToken || !['pending', 'creating', 'creation_unknown'].includes(intent.status)) {
    if (intent.status === 'completed') {
      return { success: true, status: 'completed', paymentId: intent.paymentId, idempotentReplay: true };
    }
    return { success: false, error: 'Cette intention ne peut pas être rapprochée automatiquement.' };
  }
  const token = clean(intent.invoiceToken, 128);
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(token)) {
    return { success: false, error: 'Token PayDunya absent ; rapprochement manuel requis.' };
  }
  const localEnvelope = {
    hash: createHash('sha512').update(config.masterKey).digest('hex'),
    invoice: { token }
  };
  return processPayDunyaInvoiceCallbackWithDb(db, config, localEnvelope, fetchImpl);
}
