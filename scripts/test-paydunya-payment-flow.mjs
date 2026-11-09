import { createHash } from 'node:crypto';
import {
  getPayDunyaConfig,
  getPayDunyaDisbursementConfig
} from '../src/server/paydunyaService.ts';
import {
  startPayDunyaOrderPaymentWithDb,
  processPayDunyaInvoiceCallbackWithDb,
  reconcilePayDunyaInvoiceIntentWithDb,
  startPayDunyaRefundWithDb,
  processPayDunyaDisbursementCallbackWithDb
} from '../src/server/paydunyaPaymentService.ts';

class Snapshot {
  constructor(ref, value) { this.id = ref.id; this.exists = value !== undefined; this.value = value; }
  data() { return this.value; }
}
class DocRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); }
  async get() { return new Snapshot(this, this.db.store.get(this.path)); }
  async update(data) {
    const old = this.db.store.get(this.path);
    if (!old) throw new Error('document missing: ' + this.path);
    this.db.store.set(this.path, { ...old, ...data });
  }
}
class QueryRef {
  constructor(db, path, field, value, max = 10) { this.db = db; this.path = path; this.field = field; this.value = value; this.max = max; }
  limit(max) { return new QueryRef(this.db, this.path, this.field, this.value, max); }
}
class CollectionRef {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new DocRef(this.db, `${this.path}/${id}`); }
  where(field, operator, value) {
    if (operator !== '==') throw new Error('FakeDb supports equality queries only');
    return new QueryRef(this.db, this.path, field, value);
  }
}
class FakeDb {
  constructor() { this.store = new Map(); }
  collection(name) { return new CollectionRef(this, name); }
  seed(path, value) { this.store.set(path, structuredClone(value)); }
  read(path) { return this.store.get(path); }
  async runTransaction(fn) {
    const tx = {
      get: async (ref) => {
        if (ref instanceof QueryRef) {
          const prefix = ref.path + '/';
          const docs = [...this.store.entries()]
            .filter(([path, value]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && value?.[ref.field] === ref.value)
            .slice(0, ref.max)
            .map(([path, value]) => {
              const docRef = new DocRef(this, path);
              return { id: docRef.id, ref: docRef, exists: true, data: () => value };
            });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
        return new Snapshot(ref, this.store.get(ref.path));
      },
      create: (ref, value) => {
        if (this.store.has(ref.path)) throw new Error('already exists: ' + ref.path);
        this.store.set(ref.path, structuredClone(value));
      },
      set: (ref, value) => this.store.set(ref.path, structuredClone(value)),
      update: (ref, value) => {
        const old = this.store.get(ref.path);
        if (!old) throw new Error('document missing: ' + ref.path);
        this.store.set(ref.path, { ...old, ...structuredClone(value) });
      }
    };
    return fn(tx);
  }
}
const masterKey = 'flow-test-master';
const privateKey = 'flow-test-private';
const apiToken = 'flow-test-token';
const testEnv = {
  PAYDUNYA_ENABLED: 'true', PAYDUNYA_MODE: 'test',
  PAYDUNYA_MASTER_KEY: masterKey, PAYDUNYA_PRIVATE_KEY: privateKey, PAYDUNYA_TOKEN: apiToken
};
const configResult = getPayDunyaConfig(testEnv);
if (!configResult.success) throw new Error(configResult.error);
const config = configResult.data;
const db = new FakeDb();
db.seed('restaurants/maquis-awa', {
  status: 'active', isActive: true, ownerUid: 'owner-1', name: 'Maquis Awa', loyaltyFcfaPerPoint: 1000
});
db.seed('managers/manager-1', {
  active: true, restaurantSlug: 'maquis-awa', role: 'manager', sessionVersion: 3, permissions: ['payments.refund']
});
db.seed('restaurants/maquis-awa/orders/order-100', {
  id: 'order-100', restaurantSlug: 'maquis-awa', orderNumber: 'CMD-100',
  status: 'pending', totalAmount: 7500, subtotalAmount: 7500, paidAmount: 0, currency: 'FCFA',
  customerName: 'Client PayDunya', customerPhone: '+225 07 00 00 00 00', customerPhoneNormalized: '0700000000',
  items: [{ name: 'Attiéké poisson', quantity: 1, unitPrice: 7500, totalPrice: 7500 }]
});
let passed = 0;
const assert = (ok, label) => {
  if (!ok) throw new Error('Échec : ' + label);
  passed++;
  console.log('✓ ' + label);
};

const checkout = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-100', actorUid: 'manager-1',
  actorName: 'Manager', sessionVersion: 3, idempotencyKey: 'mobile_pay_100',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel',
  channel: 'orange-money-ci'
}, async (url, options) => {
  assert(String(url) === config.createInvoiceUrl, 'La facture est créée par le backend sur le bon endpoint sandbox');
  const body = JSON.parse(options.body);
  assert(body.invoice.total_amount === 7500 && body.invoice.channels.length === 1 &&
    body.invoice.channels[0] === 'orange-money-ci', 'Le montant serveur et le canal unique sont verrouillés');
  assert(body.custom_data.payment_intent_id && body.custom_data.order_id === 'order-100',
    'La facture contient les références internes RestauMax');
  return { ok: true, json: async () => ({
    response_code: '00', token: 'test_FLOW123',
    response_text: 'https://app.paydunya.com/sandbox-checkout/invoice/test_FLOW123'
  }) };
});
assert(checkout.success && checkout.amount === 7500 && checkout.checkoutUrl.includes('sandbox-checkout'),
  'Le checkout retourne un montant exact et une URL PayDunya validée');
const duplicateInvoice = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-100', actorUid: 'manager-1',
  actorName: 'Manager', sessionVersion: 3, idempotencyKey: 'mobile_pay_100_second',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel',
  channel: 'wave-ci'
}, async () => { throw new Error('must not create second invoice'); });
assert(!duplicateInvoice.success && duplicateInvoice.conflict === true,
  'Une commande ne peut pas avoir deux factures Mobile Money actives en parallèle');

const signedHash = createHash('sha512').update(masterKey).digest('hex');
const callback = { data: JSON.stringify({
  hash: signedHash, status: 'completed', invoice: { token: 'test_FLOW123', total_amount: '7500' }
}) };
const returnReconciliation = await reconcilePayDunyaInvoiceIntentWithDb(
  db, config, 'maquis-awa', checkout.paymentIntentId, async () => ({
    ok: true, json: async () => ({
      response_code: '00', hash: signedHash,
      invoice: { token: 'test_FLOW123', total_amount: '7500' },
      status: 'completed',
      custom_data: {
        restaurant_slug: 'maquis-awa', order_id: 'order-100',
        payment_intent_id: checkout.paymentIntentId
      },
      customer: { phone: '+225 07 00 00 00 00' },
      transaction_id: 'PAY-TX-100'
    })
  })
);
assert(returnReconciliation.success && returnReconciliation.status === 'completed',
  'Le retour navigateur peut rapprocher le paiement par confirmation serveur sécurisée');
const callbackResult = await processPayDunyaInvoiceCallbackWithDb(db, config, callback, async (url) => {
  assert(String(url).endsWith('/checkout-invoice/confirm/test_FLOW123'),
    'Le callback déclenche une confirmation serveur-à-serveur avec le token');
  return { ok: true, json: async () => ({
    response_code: '00', hash: signedHash,
    invoice: { token: 'test_FLOW123', total_amount: '7500' },
    status: 'completed',
    custom_data: {
      restaurant_slug: 'maquis-awa', order_id: 'order-100',
      payment_intent_id: checkout.paymentIntentId
    },
    customer: { phone: '+225 07 00 00 00 00' },
    transaction_id: 'PAY-TX-100'
  }) };
});
assert(callbackResult.success && callbackResult.status === 'completed',
  'Une notification signée et confirmée en serveur-à-serveur règle la commande');
const paymentPath = 'restaurants/maquis-awa/payments/paydunya_' +
  createHash('sha256').update(checkout.paymentIntentId).digest('hex').slice(0, 28);
const storedPayment = db.read(paymentPath);
assert(storedPayment?.method === 'paydunya' && storedPayment.payerPhoneVerified === true &&
  storedPayment.payerPhone === '0700000000' && storedPayment.providerChannel === 'orange-money-ci' &&
  storedPayment.refundEligible === true,
  'Le paiement conserve uniquement le téléphone confirmé et le canal unique de la facture');
assert(db.read('restaurants/maquis-awa/orders/order-100').paidAmount === 7500,
  'Le montant payé est appliqué atomiquement à la commande');
assert(db.read('restaurants/maquis-awa/orders/order-100').loyaltyPointsAwarded === 7,
  'Les points de fidélité sont attribués automatiquement après règlement Mobile Money intégral');
const loyaltyCustomer = db.read('restaurants/maquis-awa/customers/loyalty_' +
  createHash('sha256').update('0700000000').digest('hex').slice(0, 32));
assert(loyaltyCustomer?.loyaltyPoints === 7,
  'Le compte client reçoit les points issus du paiement PayDunya');
assert(db.read('restaurants/maquis-awa/loyaltyLedger/order_' +
  createHash('sha256').update('order-100').digest('hex').slice(0, 32))?.points === 7,
  'Le journal fidélité enregistre une seule attribution liée à la commande');
const replay = await processPayDunyaInvoiceCallbackWithDb(db, config, callback, async () => ({
  ok: true, json: async () => ({
    response_code: '00', hash: signedHash,
    invoice: { token: 'test_FLOW123', total_amount: '7500' }, status: 'completed',
    custom_data: {
      restaurant_slug: 'maquis-awa', order_id: 'order-100',
      payment_intent_id: checkout.paymentIntentId
    }, customer: { phone: '+225 07 00 00 00 00' }, transaction_id: 'PAY-TX-100'
  })
}));
assert(replay.success && replay.idempotentReplay === true,
  'La notification répétée ne crée pas de deuxième paiement');
const forged = await processPayDunyaInvoiceCallbackWithDb(db, config, {
  data: JSON.stringify({ hash: '0'.repeat(128), invoice: { token: 'test_FLOW123' } })
});
assert(!forged.success, 'Une notification IPN falsifiée est rejetée');

// A Mobile Money invoice may cover only part of the remaining order balance.
db.seed('restaurants/maquis-awa/orders/order-200', {
  id: 'order-200', restaurantSlug: 'maquis-awa', orderNumber: 'CMD-200',
  status: 'pending', totalAmount: 7500, paidAmount: 2000, remainingAmount: 5500,
  paymentStatus: 'partial', currency: 'FCFA',
  items: [{ name: 'Poulet braisé', quantity: 1, unitPrice: 7500, totalPrice: 7500 }]
});
const partialCheckout = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-200', actorUid: 'manager-1',
  actorName: 'Manager', sessionVersion: 3, idempotencyKey: 'mobile_partial_200',
  amount: 3000,
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel',
  channel: 'wave-ci'
}, async (url, options) => {
  const body = JSON.parse(options.body);
  assert(body.invoice.total_amount === 3000 && body.invoice.items.item_0.total_price === '3000', 'La facture Mobile Money partielle utilise le montant demandé et des lignes cohérentes avec ce montant');
  return { ok: true, json: async () => ({
    response_code: '00', token: 'test_PARTIAL200',
    response_text: 'https://app.paydunya.com/sandbox-checkout/invoice/test_PARTIAL200'
  }) };
});
assert(partialCheckout.success && partialCheckout.amount === 3000,
  'Un paiement Mobile Money partiel est accepté par le backend');

const conflictingAmount = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-200', actorUid: 'manager-1',
  actorName: 'Manager', sessionVersion: 3, idempotencyKey: 'mobile_partial_200',
  amount: 2500,
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel',
  channel: 'wave-ci'
}, async () => { throw new Error('must not create a second invoice for the same idempotency key'); });
assert(!conflictingAmount.success && conflictingAmount.conflict === true,
  'La même clé idempotente ne peut pas être réutilisée avec un autre montant');

const partialReconciliation = await reconcilePayDunyaInvoiceIntentWithDb(
  db, config, 'maquis-awa', partialCheckout.paymentIntentId, async (url) => {
    assert(String(url).endsWith('/checkout-invoice/confirm/test_PARTIAL200'),
      'Le paiement partiel est confirmé auprès de PayDunya côté serveur');
    return { ok: true, json: async () => ({
      response_code: '00', hash: signedHash,
      invoice: { token: 'test_PARTIAL200', total_amount: '3000' },
      status: 'completed',
      custom_data: {
        restaurant_slug: 'maquis-awa', order_id: 'order-200',
        payment_intent_id: partialCheckout.paymentIntentId
      },
      customer: { phone: '+225 05 00 00 00 00' },
      transaction_id: 'PAY-TX-200'
    }) };
  }
);
assert(partialReconciliation.success && partialReconciliation.status === 'completed',
  'La confirmation du paiement partiel est rapprochée');
assert(db.read('restaurants/maquis-awa/orders/order-200').paidAmount === 5000 &&
  db.read('restaurants/maquis-awa/orders/order-200').remainingAmount === 2500 &&
  db.read('restaurants/maquis-awa/orders/order-200').paymentStatus === 'partial',
  'Le paiement partiel met à jour le montant payé et le solde restant sans clôturer la commande');

const overBalance = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-200', actorUid: 'manager-1',
  actorName: 'Manager', sessionVersion: 3, idempotencyKey: 'mobile_over_balance_200',
  amount: 3000,
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/cancel',
  channel: 'wave-ci'
}, async () => { throw new Error('must reject over-balance before provider call'); });
assert(!overBalance.success && overBalance.error?.includes('dépasser le solde restant'),
  'Le backend refuse tout montant supérieur au solde restant');

const payoutConfigResult = getPayDunyaDisbursementConfig({
  ...testEnv, PAYDUNYA_MODE: 'live', PAYDUNYA_LIVE_ENABLED: 'true', PAYDUNYA_PUSH_ENABLED: 'true'
});
if (!payoutConfigResult.success) throw new Error(payoutConfigResult.error);
const payoutConfig = payoutConfigResult.data;
const refund = await startPayDunyaRefundWithDb(db, payoutConfig, {
  restaurantSlug: 'maquis-awa', paymentId: storedPayment.id,
  actorUid: 'manager-1', actorName: 'Manager', sessionVersion: 3,
  amount: 2500, reason: 'Commande partiellement annulée',
  idempotencyKey: 'mobile_refund_100',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-disbursement-callback'
}, async (url, options) => {
  const endpoint = String(url);
  if (endpoint.endsWith('/get-invoice')) {
    const body = JSON.parse(options.body);
    assert(body.account_alias === '0700000000' && body.withdraw_mode === 'orange-money-ci' &&
      body.amount === 2500, 'Le remboursement utilise le téléphone vérifié, le canal d’origine et le montant demandé');
    return { ok: true, json: async () => ({ response_code: '00', disburse_token: 'PUSH_FLOW123' }) };
  }
  if (endpoint.endsWith('/submit-invoice')) {
    return { ok: true, json: async () => ({ response_code: '00', status: 'pending', transaction_id: 'REFUND-TX-1' }) };
  }
  return { ok: true, json: async () => ({
    response_code: '00', status: 'success', token: 'PUSH_FLOW123',
    amount: '2500', withdraw_mode: 'orange-money-ci',
    transaction_id: 'REFUND-TX-1', disburse_tx_id: 'OM-REF-1'
  }) };
});
assert(refund.success && refund.status === 'completed',
  'Le remboursement est terminé uniquement après check-status success');
assert(db.read(paymentPath).refundedAmount === 2500 &&
  db.read('restaurants/maquis-awa/orders/order-100').refundedAmount === 2500,
  'Le remboursement confirmé met à jour paiement et commande');
const refundReplay = await startPayDunyaRefundWithDb(db, payoutConfig, {
  restaurantSlug: 'maquis-awa', paymentId: storedPayment.id,
  actorUid: 'manager-1', actorName: 'Manager', sessionVersion: 3,
  amount: 2500, reason: 'Commande partiellement annulée',
  idempotencyKey: 'mobile_refund_100',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-disbursement-callback'
});
assert(refundReplay.success && refundReplay.idempotentReplay === true,
  'La répétition de la même demande ne déclenche pas un second décaissement');

const pendingBeforeUnauthorizedManager = Number(db.read(paymentPath).refundPendingAmount || 0);
db.seed('managers/manager-no-refund', {
  active: true, restaurantSlug: 'maquis-awa', role: 'manager',
  sessionVersion: 3, permissions: ['orders.view']
});
const managerWithoutRefund = await startPayDunyaRefundWithDb(db, payoutConfig, {
  restaurantSlug: 'maquis-awa', paymentId: storedPayment.id,
  actorUid: 'manager-no-refund', actorName: 'Manager without refund', sessionVersion: 3,
  amount: 500, reason: 'Test permission manager',
  idempotencyKey: 'manager_without_refund_001',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-disbursement-callback'
});
assert(!managerWithoutRefund.success && managerWithoutRefund.error?.includes('payments.refund'),
  'Un manager sans permission explicite payments.refund ne peut pas initier un décaissement');
assert.equal(Number(db.read(paymentPath).refundPendingAmount || 0), pendingBeforeUnauthorizedManager,
  'Un remboursement refusé ne réserve aucun montant sur le paiement');

const disbursementCallback = await processPayDunyaDisbursementCallbackWithDb(db, payoutConfig, {
  data: JSON.stringify({ hash: signedHash, token: 'PUSH_FLOW123', status: 'success' })
}, async () => ({ ok: true, json: async () => ({
  response_code: '00', status: 'success', token: 'PUSH_FLOW123',
  amount: '2500', withdraw_mode: 'orange-money-ci',
  transaction_id: 'REFUND-TX-1', disburse_tx_id: 'OM-REF-1'
}) }));
assert(disbursementCallback.success && disbursementCallback.idempotentReplay === true,
  'Le callback de décaissement signé est rapproché sans doubler le remboursement');

db.seed('managers/cashier-no-refund', {
  active: true, restaurantSlug: 'maquis-awa', role: 'cashier',
  sessionVersion: 3, permissions: ['cash.manage']
});
const unauthorizedRefund = await startPayDunyaRefundWithDb(db, payoutConfig, {
  restaurantSlug: 'maquis-awa', paymentId: storedPayment.id,
  actorUid: 'cashier-no-refund', actorName: 'Cashier', sessionVersion: 3,
  amount: 1000, reason: 'Test permission',
  idempotencyKey: 'unauthorized_refund_1',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-disbursement-callback'
});
assert(!unauthorizedRefund.success && unauthorizedRefund.error?.includes('payments.refund'),
  'Un caissier sans permission payments.refund ne peut pas initier un décaissement');

const qrBinding = {
  sessionHash: 'session-hash-qr-4', qrTokenHash: 'qr-token-hash-4',
  qrVersion: 2, tableId: 'table-4'
};
db.seed('restaurants/maquis-awa/table_sessions/session-hash-qr-4', {
  status: 'active', expiresAt: Date.now() + 60_000,
  restaurantSlug: 'maquis-awa', ...qrBinding, restaurantSessionVersion: 0
});
db.seed('restaurants/maquis-awa/table_qr_tokens/qr-token-hash-4', {
  status: 'active', tokenHash: 'qr-token-hash-4', restaurantSlug: 'maquis-awa',
  tableId: 'table-4', version: 2
});
db.seed('restaurants/maquis-awa/tables/table-4', {
  id: 'table-4', isActive: true, qrVersion: 2, tableNumber: '4'
});
db.seed('restaurants/maquis-awa/orders/order-qr', {
  id: 'order-qr', restaurantSlug: 'maquis-awa', orderNumber: 'CMD-QR-4',
  orderMode: 'sur_place', tableNumber: '4', status: 'pending',
  totalAmount: 4500, paidAmount: 0, items: [],
  tableSession: qrBinding
});
const qrCheckout = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-qr',
  actorUid: 'table_session-hash-qr-4', actorName: 'Client QR', sessionVersion: 2,
  idempotencyKey: 'qr_mobile_pay_001',
  amount: 2500,
  callbackUrl: 'https://restaumax-git-preview-test.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax-git-preview-test.vercel.app/payments/return?restaurantSlug=maquis-awa&orderId=order-qr',
  cancelUrl: 'https://restaumax-git-preview-test.vercel.app/payments/return?cancelled=1&restaurantSlug=maquis-awa&orderId=order-qr',
  channel: 'wave-ci',
  customerTableSession: { ...qrBinding, tableNumber: '4' }
}, async (url, options) => {
  const body = JSON.parse(options.body);
  assert(body.invoice.total_amount === 2500 && body.invoice.items.item_0.total_price === '2500' && body.invoice.channels[0] === 'wave-ci',
    'Le paiement QR accepte un montant partiel et le canal Wave choisi');
  return { ok: true, json: async () => ({
    response_code: '00', token: 'test_QR123',
    response_text: 'https://app.paydunya.com/sandbox-checkout/invoice/test_QR123'
  }) };
});
assert(qrCheckout.success, 'Une session QR de table valide peut initier son paiement Mobile Money');
const qrMismatch = await startPayDunyaOrderPaymentWithDb(db, config, {
  restaurantSlug: 'maquis-awa', orderId: 'order-qr',
  actorUid: 'table_session-hash-other', actorName: 'Client QR', sessionVersion: 2,
  idempotencyKey: 'qr_mobile_pay_bad',
  callbackUrl: 'https://restaumax.vercel.app/api/payments/paydunya-callback',
  returnUrl: 'https://restaumax.vercel.app/payments/return',
  cancelUrl: 'https://restaumax.vercel.app/payments/return',
  channel: 'wave-ci',
  customerTableSession: { ...qrBinding, sessionHash: 'different-session', tableNumber: '4' }
}, async () => { throw new Error('must not create invoice'); });
assert(!qrMismatch.success, 'Une autre session QR ne peut pas payer la commande d’une table');

const qrReconciliation = await reconcilePayDunyaInvoiceIntentWithDb(
  db, config, 'maquis-awa', qrCheckout.paymentIntentId, async () => ({
    ok: true, json: async () => ({
      response_code: '00', hash: signedHash,
      invoice: { token: 'test_QR123', total_amount: '2500' },
      status: 'completed',
      custom_data: {
        restaurant_slug: 'maquis-awa', order_id: 'order-qr',
        payment_intent_id: qrCheckout.paymentIntentId
      },
      customer: { phone: '0700000000' }, transaction_id: 'PAY-QR-4'
    })
  })
);
assert(qrReconciliation.success && qrReconciliation.status === 'completed',
  'Le paiement QR est rapproché par confirmation PayDunya côté serveur');
assert(db.read('restaurants/maquis-awa/orders/order-qr').paidAmount === 2500 &&
  db.read('restaurants/maquis-awa/orders/order-qr').remainingAmount === 2000,
  'Le paiement QR partiel conserve le solde restant de la commande');

console.log(`Résultats PayDunya end-to-end : ${passed}/${passed} réussis.`);
