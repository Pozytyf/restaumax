import crypto from 'node:crypto';
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
  return crypto.createHash('sha256').update(value).digest('hex');
}
function clean(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
}
function normalizePhone(value: unknown): string | null {
  const phone = clean(value, 32).replace(/[\s().-]/g, '');
  return /^[0-9]{8,15}$/.test(phone) ? phone : null;
}
function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
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
    const amount = total - paid;
    const now = Date.now();
    tx.create(intentRef, {
      id: intentId, restaurantSlug: slug, orderId, actorUid,
      actorName: clean(input.actorName, 100), actorRole: member.role,
      signature, amount, currency: 'XOF', channel: input.channel,
      status: 'creating', createdAt: now, updatedAt: now
    });
    return { ok: true, replay: false, intentId, amount, order, restaurant };
  });
  if (!reservation.ok) return { success: false, conflict: reservation.conflict, error: reservation.error };
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
  const checkout = await createPayDunyaCheckoutInvoice(config, {
    amount: reservation.amount,
    description: `RestauMax · commande ${clean(order.orderNumber || orderId, 48)}`,
    restaurantSlug: slug,
    restaurantName: clean(restaurant.name || restaurant.restaurantName, 100) || 'RestauMax',
    orderId,
    paymentIntentId: reservation.intentId,
    items,
    callbackUrl: input.callbackUrl,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
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
  const envelope = asObject(callbackEnvelope);
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
      await db.collection('restaurants').doc(map.restaurantSlug)
        .collection('paymentIntents').doc(map.intentId)
        .update({ status: invoice.status === 'cancelled' ? 'cancelled' : invoice.status === 'failed' ? 'failed' : 'pending', updatedAt: Date.now() });
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
    const possibleChannel = clean(invoice.customer?.payment_method || invoice.customer?.channel ||
      (invoice.customer as any)?.payment_channel, 40).toLowerCase();
    const providerChannel = CI_CHANNELS.has(possibleChannel as PayDunyaCiWithdrawMode) ? possibleChannel : null;
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
      lastPaymentAt: now, lastPaymentId: paymentId
    });
    tx.update(intentRef, {
      status: 'completed', paymentId, completedAt: now, updatedAt: now,
      payerPhone, payerPhoneVerified: Boolean(payerPhone), providerChannel,
      refundEligible: Boolean(payerPhone && providerChannel)
    });
    return { success: true, status: 'completed', paymentId, idempotentReplay: false };
  });
}
