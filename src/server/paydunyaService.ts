import { createHash, timingSafeEqual } from 'node:crypto';

export type PayDunyaMode = 'test' | 'live';

export interface PayDunyaConfig {
  mode: PayDunyaMode;
  masterKey: string;
  privateKey: string;
  token: string;
  perEnabled: boolean;
  createInvoiceUrl: string;
  confirmInvoiceBaseUrl: string;
}

export interface PayDunyaInvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  description?: string;
}

export interface PayDunyaCheckoutInput {
  amount: number;
  description: string;
  restaurantSlug: string;
  restaurantName: string;
  orderId: string;
  paymentIntentId: string;
  guestNumber?: number;
  guestAccountId?: string;
  customer?: { name?: string; email?: string; phone?: string };
  items?: PayDunyaInvoiceItem[];
  callbackUrl: string;
  returnUrl: string;
  cancelUrl: string;
  channels?: string[];
}

export type PayDunyaResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PayDunyaCreatedInvoice {
  token: string;
  checkoutUrl: string;
  responseText: string;
}

export interface PayDunyaConfirmedInvoice {
  token: string;
  status: 'completed' | 'pending' | 'cancelled' | 'failed' | string;
  totalAmount: number;
  customData: Record<string, unknown>;
  receiptUrl?: string;
  customer?: Record<string, unknown>;
  transactionId?: string;
  providerChannel?: string;
}

const PAYDUNYA_CI_CHANNELS = [
  'orange-money-ci',
  'wave-ci',
  'mtn-ci',
  'moov-ci',
  'djamo-ci'
] as const;

export function getPayDunyaConfig(
  env: Record<string, string | undefined>
): PayDunyaResult<PayDunyaConfig> {
  if (env.PAYDUNYA_ENABLED !== 'true') {
    return { success: false, error: 'Le paiement PayDunya est désactivé.' };
  }

  const mode = (env.PAYDUNYA_MODE || 'test').trim().toLowerCase();
  if (mode !== 'test' && mode !== 'live') {
    return { success: false, error: 'Mode PayDunya invalide.' };
  }
  if (mode === 'live' && env.PAYDUNYA_LIVE_ENABLED !== 'true') {
    return { success: false, error: 'Le mode PayDunya Production exige PAYDUNYA_LIVE_ENABLED=true.' };
  }

  const masterKey = String(env.PAYDUNYA_MASTER_KEY || '').trim();
  const privateKey = String(env.PAYDUNYA_PRIVATE_KEY || '').trim();
  const token = String(env.PAYDUNYA_TOKEN || '').trim();
  if (!masterKey || !privateKey || !token) {
    return { success: false, error: 'Les clés PayDunya serveur ne sont pas configurées.' };
  }

  const base = mode === 'test'
    ? 'https://app.paydunya.com/sandbox-api/v1'
    : 'https://app.paydunya.com/api/v1';

  return {
    success: true,
    data: {
      mode,
      masterKey,
      privateKey,
      token,
      perEnabled: env.PAYDUNYA_PER_ENABLED === 'true',
      createInvoiceUrl: `${base}/checkout-invoice/create`,
      confirmInvoiceBaseUrl: `${base}/checkout-invoice/confirm`
    }
  };
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

export function buildPayDunyaCheckoutPayload(input: PayDunyaCheckoutInput): Record<string, unknown> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 100_000_000) {
    throw new Error('Montant PayDunya invalide.');
  }
  if (!cleanText(input.restaurantSlug, 100) || !cleanText(input.orderId, 128) ||
      !cleanText(input.paymentIntentId, 128)) {
    throw new Error('Références de paiement PayDunya invalides.');
  }

  const items: Record<string, Record<string, unknown>> = {};
  (input.items || []).slice(0, 50).forEach((item, index) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0 ||
        !Number.isSafeInteger(item.totalPrice) || item.totalPrice < 0) {
      throw new Error('Article de facture PayDunya invalide.');
    }
    items[`item_${index}`] = {
      name: cleanText(item.name, 100),
      quantity: item.quantity,
      unit_price: String(item.unitPrice),
      total_price: String(item.totalPrice),
      description: cleanText(item.description, 200)
    };
  });

  const customer = input.customer ? {
    name: cleanText(input.customer.name, 100),
    email: cleanText(input.customer.email, 160),
    phone: cleanText(input.customer.phone, 32)
  } : undefined;

  const customData = {
    provider: 'paydunya',
    restaurant_slug: cleanText(input.restaurantSlug, 100),
    order_id: cleanText(input.orderId, 128),
    payment_intent_id: cleanText(input.paymentIntentId, 128),
    guest_number: Number.isSafeInteger(input.guestNumber) ? input.guestNumber : 1,
    guest_account_id: cleanText(input.guestAccountId, 64)
  };

  return {
    invoice: {
      items,
      customer,
      channels: [...(input.channels?.length ? input.channels : PAYDUNYA_CI_CHANNELS)],
      total_amount: input.amount,
      description: cleanText(input.description, 250)
    },
    store: {
      name: cleanText(input.restaurantName, 100) || 'RestauMax',
      tagline: 'Paiement sécurisé avec RestauMax',
      website_url: 'https://restaumax.vercel.app'
    },
    custom_data: customData,
    actions: {
      callback_url: input.callbackUrl,
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl
    }
  };
}

function isTrustedCheckoutUrl(value: unknown, mode: PayDunyaMode): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const expectedPath = mode === 'test' ? '/sandbox-checkout/invoice/' : '/checkout/invoice/';
    return url.protocol === 'https:' && url.hostname === 'app.paydunya.com' &&
      url.pathname.startsWith(expectedPath);
  } catch {
    return false;
  }
}

function payDunyaHeaders(config: PayDunyaConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': config.masterKey,
    'PAYDUNYA-PRIVATE-KEY': config.privateKey,
    'PAYDUNYA-TOKEN': config.token
  };
}

export async function createPayDunyaCheckoutInvoice(
  config: PayDunyaConfig,
  input: PayDunyaCheckoutInput,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<PayDunyaCreatedInvoice>> {
  let payload: Record<string, unknown>;
  try {
    payload = buildPayDunyaCheckoutPayload(input);
  } catch (error: any) {
    return { success: false, error: error?.message || 'Données de facture PayDunya invalides.' };
  }

  try {
    const response = await fetchImpl(config.createInvoiceUrl, {
      method: 'POST',
      headers: payDunyaHeaders(config),
      body: JSON.stringify(payload)
    });
    if (!response.ok) return { success: false, error: 'PayDunya ne répond pas correctement à la création de facture.' };
    const data = await response.json() as Record<string, unknown>;
    const token = cleanText(data.token, 128);
    const checkoutUrl = data.response_text;
    if (data.response_code !== '00' || !token || !isTrustedCheckoutUrl(checkoutUrl, config.mode)) {
      return { success: false, error: cleanText(data.description || data.response_text, 250) || 'Facture PayDunya non créée.' };
    }
    return {
      success: true,
      data: { token, checkoutUrl, responseText: cleanText(data.description, 250) }
    };
  } catch {
    return { success: false, error: 'Impossible de joindre PayDunya. Réessayez plus tard.' };
  }
}

export async function confirmPayDunyaInvoice(
  config: PayDunyaConfig,
  invoiceToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<PayDunyaConfirmedInvoice>> {
  const token = cleanText(invoiceToken, 128);
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(token)) {
    return { success: false, error: 'Token de facture PayDunya invalide.' };
  }

  try {
    const response = await fetchImpl(
      `${config.confirmInvoiceBaseUrl}/${encodeURIComponent(token)}`,
      { method: 'GET', headers: payDunyaHeaders(config) }
    );
    if (!response.ok) return { success: false, error: 'PayDunya ne permet pas de confirmer cette facture.' };
    const data = await response.json() as Record<string, any>;
    const signature = verifyPayDunyaCallback(config.masterKey, data);
    const confirmedToken = cleanText(data.invoice?.token || data.token, 128);
    const totalAmount = Number(data.invoice?.total_amount);
    if (data.response_code !== '00' || !signature.success || confirmedToken !== token ||
        !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
      return { success: false, error: 'Réponse de confirmation PayDunya invalide ou signature fournisseur non vérifiée.' };
    }
    const status = String(data.status || '').toLowerCase();
    if (!['completed', 'pending', 'cancelled', 'failed'].includes(status)) {
      return { success: false, error: 'Statut de paiement PayDunya inconnu.' };
    }
    const customer = data.customer && typeof data.customer === 'object' ? data.customer : undefined;
    return {
      success: true,
      data: {
        token,
        status,
        totalAmount,
        customData: data.custom_data && typeof data.custom_data === 'object' ? data.custom_data : {},
        receiptUrl: typeof data.receipt_url === 'string' ? data.receipt_url : undefined,
        customer,
        transactionId: cleanText(data.transaction_id, 128) || undefined,
        providerChannel: cleanText(customer?.payment_method || customer?.channel || customer?.payment_channel, 40) || undefined
      }
    };
  } catch {
    return { success: false, error: 'Impossible de vérifier le statut PayDunya.' };
  }
}

export interface PayDunyaRedistributionResult {
  transactionId: string;
  description: string;
}

export async function createPayDunyaRedistribution(
  config: PayDunyaConfig,
  accountAlias: string,
  amount: number,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<PayDunyaRedistributionResult>> {
  if (!config.perEnabled) {
    return { success: false, error: 'La redistribution PER PayDunya n’est pas activée côté serveur.' };
  }
  const alias = cleanText(accountAlias, 160);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias);
  const isPhone = /^[0-9]{8,15}$/.test(alias);
  const isPayDunyaAccountId = /^BBJ[A-Z0-9]{8,20}$/i.test(alias);
  if ((!isEmail && !isPhone && !isPayDunyaAccountId) ||
      !Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) {
    return { success: false, error: 'Destinataire PayDunya ou montant de redistribution invalide.' };
  }

  const baseUrl = config.createInvoiceUrl.replace('/checkout-invoice/create', '');
  const endpoint = `${baseUrl}/direct-pay/credit-account`;
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: payDunyaHeaders(config),
      body: JSON.stringify({ account_alias: alias, amount })
    });
    if (!response.ok) return { success: false, error: 'PayDunya ne répond pas correctement à la demande de redistribution.' };
    const data = await response.json() as Record<string, unknown>;
    const transactionId = cleanText(data.transaction_id, 128);
    if (data.response_code !== '00' || !transactionId) {
      return { success: false, error: cleanText(data.description || data.response_text, 250) || 'Redistribution PayDunya refusée.' };
    }
    return {
      success: true,
      data: {
        transactionId,
        description: cleanText(data.description || data.response_text, 250)
      }
    };
  } catch {
    return { success: false, error: 'Impossible de confirmer la redistribution PayDunya. Vérifiez le tableau de bord avant toute nouvelle tentative.' };
  }
}

export function verifyPayDunyaCallback(
  masterKey: string,
  callbackData: unknown
): PayDunyaResult<Record<string, any>> {
  let data: Record<string, any>;
  try {
    const candidate = typeof callbackData === 'string' ? JSON.parse(callbackData) : callbackData;
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid callback payload');
    data = candidate as Record<string, any>;
  } catch {
    return { success: false, error: 'Notification PayDunya invalide.' };
  }

  const receivedHash = cleanText(data.hash, 128).toLowerCase();
  if (!masterKey || !/^[a-f0-9]{128}$/.test(receivedHash)) {
    return { success: false, error: 'Signature PayDunya absente ou invalide.' };
  }
  const expectedHash = createHash('sha512').update(masterKey).digest('hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const receivedBuffer = Buffer.from(receivedHash, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { success: false, error: 'Signature de notification PayDunya non valide.' };
  }
  return { success: true, data };
}

export const PAYDUNYA_CI_PAYMENT_CHANNELS = [...PAYDUNYA_CI_CHANNELS];


/**
 * PayDunya PUSH (v2) — décaissement vers un wallet ivoirien.
 * La documentation ne publie pas d'endpoint sandbox PUSH : cet adaptateur
 * reste donc désactivé en configuration test et exige deux garde-fous live.
 * Aucun retry automatique n'est effectué après une réponse réseau ambiguë.
 */
export type PayDunyaCiWithdrawMode =
  | 'orange-money-ci'
  | 'wave-ci'
  | 'mtn-ci'
  | 'moov-ci'
  | 'djamo-ci';

export type PayDunyaDisbursementStatus = 'created' | 'pending' | 'success' | 'failed';

export interface PayDunyaDisbursementConfig extends PayDunyaConfig {
  pushEnabled: boolean;
}

export interface PayDunyaDisbursementInput {
  accountAlias: string;
  amount: number;
  withdrawMode: PayDunyaCiWithdrawMode;
  callbackUrl: string;
  disburseId: string;
}

export interface PayDunyaDisbursement {
  token: string;
  status: PayDunyaDisbursementStatus;
  transactionId?: string;
  providerReference?: string;
  amount?: number;
  withdrawMode?: string;
}

const PAYDUNYA_CI_WITHDRAW_MODES: readonly PayDunyaCiWithdrawMode[] = [
  'orange-money-ci', 'wave-ci', 'mtn-ci', 'moov-ci', 'djamo-ci'
];

export function getPayDunyaDisbursementConfig(
  env: Record<string, string | undefined>
): PayDunyaResult<PayDunyaDisbursementConfig> {
  const base = getPayDunyaConfig(env);
  if (!base.success) return base;
  return {
    success: true,
    data: {
      ...base.data,
      pushEnabled: base.data.mode === 'live' &&
        env.PAYDUNYA_LIVE_ENABLED === 'true' &&
        env.PAYDUNYA_PUSH_ENABLED === 'true'
    }
  };
}

function validDisbursementToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{5,128}$/.test(value.trim());
}

function validateDisbursementInput(input: PayDunyaDisbursementInput): string | null {
  const alias = cleanText(input.accountAlias, 32);
  const isPhone = /^[0-9]{8,15}$/.test(alias);
  const isPayDunyaAccount = /^BBJ[A-Z0-9]{8,20}$/i.test(alias);
  let callback: URL | null = null;
  try { callback = new URL(input.callbackUrl); } catch { /* invalid URL */ }
  if ((!isPhone && !isPayDunyaAccount) ||
      !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 100_000_000 ||
      !PAYDUNYA_CI_WITHDRAW_MODES.includes(input.withdrawMode) ||
      !callback || callback.protocol !== 'https:' ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(input.disburseId)) {
    return 'Paramètres de déboursement PayDunya invalides.';
  }
  return null;
}

function disbursementHeaders(config: PayDunyaConfig): Record<string, string> {
  return payDunyaHeaders(config);
}

async function postPayDunyaDisbursement(
  config: PayDunyaDisbursementConfig,
  endpoint: 'get-invoice' | 'submit-invoice' | 'check-status',
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<PayDunyaResult<Record<string, any>>> {
  if (!config.pushEnabled) {
    return { success: false, error: 'Les décaissements PayDunya PUSH sont désactivés. Activation live explicite requise.' };
  }
  try {
    const response = await fetchImpl(`https://app.paydunya.com/api/v2/disburse/${endpoint}`, {
      method: 'POST',
      headers: disbursementHeaders(config),
      body: JSON.stringify(body)
    });
    if (!response.ok) return { success: false, error: 'PayDunya PUSH est temporairement indisponible.' };
    const data = await response.json() as Record<string, any>;
    if (String(data.response_code) !== '00') {
      return { success: false, error: cleanText(data.response_text, 250) || 'PayDunya a refusé la demande de décaissement.' };
    }
    return { success: true, data };
  } catch {
    return { success: false, error: 'Réponse réseau PayDunya incertaine. Vérifiez le statut avec le même token avant toute nouvelle soumission.' };
  }
}

/** Crée seulement le jeton de déboursement (statut created), sans envoyer l'argent. */
export async function createPayDunyaDisbursementInvoice(
  config: PayDunyaDisbursementConfig,
  input: PayDunyaDisbursementInput,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<{ token: string; status: 'created' }>> {
  const invalid = validateDisbursementInput(input);
  if (invalid) return { success: false, error: invalid };
  const result = await postPayDunyaDisbursement(config, 'get-invoice', {
    account_alias: cleanText(input.accountAlias, 32),
    amount: input.amount,
    withdraw_mode: input.withdrawMode,
    callback_url: input.callbackUrl
  }, fetchImpl);
  if (!result.success) return result;
  const token = result.data.disburse_token;
  if (!validDisbursementToken(token)) {
    return { success: false, error: 'PayDunya n’a pas retourné de token de déboursement valide.' };
  }
  return { success: true, data: { token: token.trim(), status: 'created' } };
}

/**
 * Soumet un token déjà créé. Ne jamais appeler automatiquement cette fonction
 * après un timeout : interroger d'abord check-status avec le même token.
 */
export async function submitPayDunyaDisbursement(
  config: PayDunyaDisbursementConfig,
  token: string,
  disburseId: string,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<PayDunyaDisbursement>> {
  if (!validDisbursementToken(token) || !/^[A-Za-z0-9_-]{8,100}$/.test(disburseId)) {
    return { success: false, error: 'Références de soumission PayDunya invalides.' };
  }
  const result = await postPayDunyaDisbursement(config, 'submit-invoice', {
    disburse_invoice: token.trim(),
    disburse_id: disburseId
  }, fetchImpl);
  if (!result.success) return result;
  const status = String(result.data.status || '').toLowerCase();
  if (status !== 'success' && status !== 'pending') {
    return { success: false, error: 'Statut de soumission PayDunya absent ou non reconnu. Vérification obligatoire.' };
  }
  return {
    success: true,
    data: {
      token: token.trim(),
      status,
      transactionId: cleanText(result.data.transaction_id, 128) || undefined,
      providerReference: cleanText(result.data.provider_ref || result.data.disburse_tx_id, 128) || undefined
    }
  };
}

/** Vérifie l'état réel auprès de PayDunya ; pending ne vaut jamais succès. */
export async function checkPayDunyaDisbursementStatus(
  config: PayDunyaDisbursementConfig,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<PayDunyaResult<PayDunyaDisbursement>> {
  if (!validDisbursementToken(token)) {
    return { success: false, error: 'Token de vérification PayDunya invalide.' };
  }
  const result = await postPayDunyaDisbursement(config, 'check-status', {
    disburse_invoice: token.trim()
  }, fetchImpl);
  if (!result.success) return result;
  const status = String(result.data.status || '').toLowerCase();
  if (!['created', 'pending', 'success', 'failed'].includes(status)) {
    return { success: false, error: 'PayDunya a retourné un statut de déboursement inconnu.' };
  }
  const amountRaw = result.data.amount;
  const amount = amountRaw === undefined ? undefined : Number(amountRaw);
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0)) {
    return { success: false, error: 'Le montant confirmé par PayDunya est invalide.' };
  }
  return {
    success: true,
    data: {
      token: token.trim(),
      status: status as PayDunyaDisbursementStatus,
      transactionId: cleanText(result.data.transaction_id, 128) || undefined,
      providerReference: cleanText(result.data.provider_ref || result.data.disburse_tx_id, 128) || undefined,
      amount,
      withdrawMode: cleanText(result.data.withdraw_mode, 64) || undefined
    }
  };
}

export const PAYDUNYA_CI_WITHDRAW_MODES_SUPPORTED = [...PAYDUNYA_CI_WITHDRAW_MODES];
