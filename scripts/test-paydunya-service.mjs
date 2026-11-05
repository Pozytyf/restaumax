import { createHash } from 'node:crypto';
import {
  getPayDunyaConfig,
  buildPayDunyaCheckoutPayload,
  createPayDunyaCheckoutInvoice,
  createPayDunyaRedistribution,
  confirmPayDunyaInvoice,
  verifyPayDunyaCallback,
  getPayDunyaDisbursementConfig,
  createPayDunyaDisbursementInvoice,
  submitPayDunyaDisbursement,
  checkPayDunyaDisbursementStatus,
  PAYDUNYA_CI_PAYMENT_CHANNELS,
  PAYDUNYA_CI_WITHDRAW_MODES_SUPPORTED
} from '../src/server/paydunyaService.ts';

let passed = 0;
let failed = 0;
const assert = (condition, label) => {
  if (condition) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
};

const env = {
  PAYDUNYA_ENABLED: 'true',
  PAYDUNYA_MODE: 'test',
  PAYDUNYA_MASTER_KEY: 'test-master-key',
  PAYDUNYA_PRIVATE_KEY: 'test-private-key',
  PAYDUNYA_TOKEN: 'test-token'
};
const configResult = getPayDunyaConfig(env);
assert(configResult.success === true, 'La configuration sandbox est acceptée');
const config = configResult.success ? configResult.data : null;
assert(config?.createInvoiceUrl === 'https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create',
  'Le mode test utilise exclusivement l’endpoint sandbox');
assert(getPayDunyaConfig({ ...env, PAYDUNYA_ENABLED: 'false' }).success === false,
  'Le fournisseur reste désactivé par défaut');
assert(getPayDunyaConfig({ ...env, PAYDUNYA_MODE: 'live' }).success === false,
  'Le mode production exige une activation explicite');
assert(getPayDunyaConfig({ ...env, PAYDUNYA_MODE: 'live', PAYDUNYA_LIVE_ENABLED: 'true' }).success === true,
  'Le mode production ne peut être configuré qu’avec son garde-fou');

console.log('\n--- Construction de la facture ---');
const invoiceInput = {
  amount: 7500,
  description: 'Règlement commande #CMD-42 · Convive 2',
  restaurantSlug: 'chez-awa',
  restaurantName: 'Maquis Chez Awa',
  orderId: 'order-42',
  paymentIntentId: 'intent-42',
  guestNumber: 2,
  guestAccountId: 'guest_2',
  customer: { name: 'Awa', phone: '+2250700000000' },
  items: [{ name: 'Attiéké poisson', quantity: 1, unitPrice: 7500, totalPrice: 7500 }],
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel'
};
const payload = buildPayDunyaCheckoutPayload(invoiceInput);
const invoiceNode = payload.invoice;
assert(invoiceNode.total_amount === 7500, 'Le montant facturé est défini côté serveur');
assert(invoiceNode.channels.length === 5 && PAYDUNYA_CI_PAYMENT_CHANNELS.includes('wave-ci') &&
  PAYDUNYA_CI_PAYMENT_CHANNELS.includes('orange-money-ci'),
  'Les canaux Mobile Money de Côte d’Ivoire sont disponibles');
assert(payload.custom_data.payment_intent_id === 'intent-42' &&
  payload.custom_data.guest_account_id === 'guest_2',
  'Les références internes du paiement et du sous-compte sont transmises en données personnalisées');
let invalidAmount = false;
try { buildPayDunyaCheckoutPayload({ ...invoiceInput, amount: 1.5 }); } catch { invalidAmount = true; }
assert(invalidAmount, 'Un montant non entier est refusé avant appel fournisseur');

console.log('\n--- Création et confirmation d’une facture ---');
if (config) {
  let capturedUrl = '';
  let capturedOptions = null;
  const createMock = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({
        response_code: '00',
        response_text: 'https://app.paydunya.com/sandbox-checkout/invoice/test_ABC123',
        token: 'test_ABC123'
      })
    };
  };
  const created = await createPayDunyaCheckoutInvoice(config, invoiceInput, createMock);
  assert(created.success === true && created.data.token === 'test_ABC123',
    'Une réponse fournisseur valide retourne le token de facture');
  assert(created.success === true && created.data.checkoutUrl.startsWith('https://app.paydunya.com/sandbox-checkout/'),
    'Seule une URL de paiement PayDunya HTTPS est acceptée');
  assert(capturedUrl === config.createInvoiceUrl &&
    capturedOptions.headers['PAYDUNYA-MASTER-KEY'] === 'test-master-key',
    'La requête utilise l’endpoint et les en-têtes serveur PayDunya');

  const badUrl = await createPayDunyaCheckoutInvoice(config, invoiceInput, async () => ({
    ok: true,
    json: async () => ({
      response_code: '00', response_text: 'https://evil.example/pay', token: 'test_BAD123'
    })
  }));
  assert(badUrl.success === false, 'Une URL de redirection externe est refusée');

  const failedProvider = await createPayDunyaCheckoutInvoice(config, invoiceInput, async () => ({
    ok: true,
    json: async () => ({ response_code: '99', response_text: 'Rejected' })
  }));
  assert(failedProvider.success === false, 'Une réponse fournisseur non réussie ne crée pas de paiement');

  let confirmUrl = '';
  const confirmMock = async (url) => {
    confirmUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        response_code: '00',
        invoice: { token: 'test_ABC123', total_amount: 7500 },
        status: 'completed',
        custom_data: { payment_intent_id: 'intent-42' },
        receipt_url: 'https://app.paydunya.com/sandbox-checkout/receipt/pdf/test_ABC123.pdf'
      })
    };
  };
  const confirmed = await confirmPayDunyaInvoice(config, 'test_ABC123', confirmMock);
  assert(confirmed.success === true && confirmed.data.status === 'completed' &&
    confirmed.data.totalAmount === 7500,
    'La confirmation récupère le statut et le montant exacts de la facture');
  assert(confirmUrl.endsWith('/checkout-invoice/confirm/test_ABC123'),
    'La confirmation utilise le token de facture encodé dans l’endpoint');
  const invalidToken = await confirmPayDunyaInvoice(config, 'bad token', confirmMock);
  assert(invalidToken.success === false, 'Un token de facture mal formé est refusé');
}

console.log('\n--- Redistribution PER vers un restaurant ---');
if (config) {
  const perDisabled = await createPayDunyaRedistribution(config, 'restaurant@example.com', 6500,
    async () => ({ ok: true, json: async () => ({ response_code: '00', transaction_id: 'TEST000001' }) }));
  assert(perDisabled.success === false, 'La redistribution reste bloquée tant que PER n’est pas activé');

  const perConfigResult = getPayDunyaConfig({ ...env, PAYDUNYA_PER_ENABLED: 'true' });
  if (perConfigResult.success) {
    let perUrl = '';
    let perBody = null;
    const perSuccess = await createPayDunyaRedistribution(
      perConfigResult.data, '0700000000', 6500,
      async (url, options) => {
        perUrl = String(url);
        perBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({
          response_code: '00',
          response_text: 'Transaction completed successfully',
          transaction_id: 'TEST000001'
        }) };
      }
    );
    assert(perSuccess.success === true && perSuccess.data.transactionId === 'TEST000001',
      'Une redistribution PER sandbox valide retourne son identifiant de transaction');
    assert(perUrl.endsWith('/direct-pay/credit-account') &&
      perBody.account_alias === '0700000000' && perBody.amount === 6500,
      'La redistribution utilise le bon endpoint, destinataire et montant');
    const accountIdPayout = await createPayDunyaRedistribution(perConfigResult.data, 'BBJ1234567890', 6500,
      async () => ({ ok: true, json: async () => ({ response_code: '00', transaction_id: 'TEST000002' }) }));
    assert(accountIdPayout.success === true, 'Un identifiant de compte PayDunya est accepté');
    const invalidAlias = await createPayDunyaRedistribution(perConfigResult.data, 'unknown-alias', 6500);
    assert(invalidAlias.success === false, 'Un alias de destinataire invalide est refusé');
    const countryCodePhone = await createPayDunyaRedistribution(perConfigResult.data, '+2250700000000', 6500);
    assert(countryCodePhone.success === false, 'Le numéro de wallet doit être fourni sans indicatif pays');
    const invalidPayoutAmount = await createPayDunyaRedistribution(perConfigResult.data, 'restaurant@example.com', 0);
    assert(invalidPayoutAmount.success === false, 'Un montant nul de redistribution est refusé');
    const failedPayout = await createPayDunyaRedistribution(perConfigResult.data, 'restaurant@example.com', 6500,
      async () => ({ ok: true, json: async () => ({ response_code: '99', response_text: 'Rejected' }) }));
    assert(failedPayout.success === false, 'Une redistribution refusée par PayDunya n’est pas déclarée réussie');
  }
}


console.log('\n--- PayDunya PUSH : décaissements contrôlés ---');
const pushDisabled = getPayDunyaDisbursementConfig({
  ...env, PAYDUNYA_MODE: 'live', PAYDUNYA_LIVE_ENABLED: 'true'
});
assert(pushDisabled.success === true && pushDisabled.data.pushEnabled === false,
  'Les décaissements PUSH restent désactivés sans activation dédiée');
const pushEnabled = getPayDunyaDisbursementConfig({
  ...env, PAYDUNYA_MODE: 'live', PAYDUNYA_LIVE_ENABLED: 'true', PAYDUNYA_PUSH_ENABLED: 'true'
});
assert(pushEnabled.success === true && pushEnabled.data.pushEnabled === true,
  'Le PUSH exige le mode live et deux drapeaux explicites');
assert(PAYDUNYA_CI_WITHDRAW_MODES_SUPPORTED.length === 5 &&
  PAYDUNYA_CI_WITHDRAW_MODES_SUPPORTED.includes('orange-money-ci') &&
  PAYDUNYA_CI_WITHDRAW_MODES_SUPPORTED.includes('wave-ci'),
  'Les cinq modes de retrait ivoiriens documentés sont autorisés');
if (pushEnabled.success) {
  const pushConfig = pushEnabled.data;
  const payoutInput = {
    accountAlias: '0700000000', amount: 2500, withdrawMode: 'orange-money-ci',
    callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-disbursement-callback',
    disburseId: 'refund_test_0001'
  };
  let calls = [];
  const pushFetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith('/get-invoice')) {
      return { ok: true, json: async () => ({ response_code: '00', disburse_token: 'PUSH_TOKEN_123' }) };
    }
    if (String(url).endsWith('/submit-invoice')) {
      return { ok: true, json: async () => ({ response_code: '00', status: 'pending', transaction_id: 'TX-123' }) };
    }
    return { ok: true, json: async () => ({
      response_code: '00', status: 'success', token: 'PUSH_TOKEN_123',
      amount: '2500', withdraw_mode: 'orange-money-ci',
      transaction_id: 'TX-123', provider_ref: 'OM-REF-123'
    }) };
  };
  const createdPush = await createPayDunyaDisbursementInvoice(pushConfig, payoutInput, pushFetch);
  assert(createdPush.success && createdPush.data.token === 'PUSH_TOKEN_123' &&
    createdPush.data.status === 'created',
    'L’initiation retourne uniquement un token created, sans déclarer le transfert réussi');
  assert(calls[0]?.url.endsWith('/get-invoice') && calls[0]?.body.withdraw_mode === 'orange-money-ci',
    'L’initiation utilise l’endpoint PUSH v2 et le mode CI demandé');
  const submittedPush = await submitPayDunyaDisbursement(pushConfig, 'PUSH_TOKEN_123', 'refund_test_0001', pushFetch);
  assert(submittedPush.success && submittedPush.data.status === 'pending',
    'Une soumission pending reste pending et n’est pas comptabilisée comme remboursée');
  const checkedPush = await checkPayDunyaDisbursementStatus(pushConfig, 'PUSH_TOKEN_123', pushFetch);
  assert(checkedPush.success && checkedPush.data.status === 'success' &&
    checkedPush.data.amount === 2500 && checkedPush.data.providerReference === 'OM-REF-123',
    'Le statut final est relu côté serveur avec montant et référence fournisseur');
  let disabledCalls = 0;
  const disabledPush = await createPayDunyaDisbursementInvoice(
    { ...pushConfig, pushEnabled: false }, payoutInput,
    async () => { disabledCalls++; throw new Error('must not call'); }
  );
  assert(!disabledPush.success && disabledCalls === 0,
    'Un décaissement désactivé ne déclenche aucun appel réseau');
  const invalidMode = await createPayDunyaDisbursementInvoice(pushConfig,
    { ...payoutInput, withdrawMode: 'orange-money-senegal' }, pushFetch);
  assert(!invalidMode.success, 'Un mode de retrait hors Côte d’Ivoire est refusé');
  const invalidPhone = await createPayDunyaDisbursementInvoice(pushConfig,
    { ...payoutInput, accountAlias: '+2250700000000' }, pushFetch);
  assert(!invalidPhone.success, 'Le numéro bénéficiaire doit être fourni sans indicatif pays');
  const failedProvider = await submitPayDunyaDisbursement(pushConfig, 'PUSH_TOKEN_123', 'refund_test_0001',
    async () => ({ ok: true, json: async () => ({ response_code: '00', status: 'failed' }) }));
  assert(!failedProvider.success, 'Un statut failed ne peut pas être interprété comme un succès');
}

console.log('\n--- Vérification de notification IPN ---');
const masterKey = 'test-master-key';
const validHash = createHash('sha512').update(masterKey).digest('hex');
const callback = { hash: validHash, status: 'completed', invoice: { total_amount: 7500, token: 'test_ABC123' } };
assert(verifyPayDunyaCallback(masterKey, callback).success === true,
  'Une notification signée avec la Master Key est acceptée');
assert(verifyPayDunyaCallback(masterKey, JSON.stringify(callback)).success === true,
  'Une notification encodée en JSON est acceptée');
assert(verifyPayDunyaCallback(masterKey, { ...callback, hash: '0'.repeat(128) }).success === false,
  'Une notification dont la signature est falsifiée est rejetée');
assert(verifyPayDunyaCallback('', callback).success === false,
  'Une notification ne peut pas être validée sans clé serveur');

console.log('\nRésultats PayDunya : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
if (failed > 0) process.exit(1);
