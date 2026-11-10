import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const server = read('../server.ts');
const firebase = read('../src/lib/firebase.ts');
const app = read('../src/App.tsx');
const clientMenu = read('../src/components/restaumax/ClientMenuView.tsx');
const modal = read('../src/components/restaumax/OrderConfirmationModal.tsx');
const paydunya = read('../src/server/paydunyaPaymentService.ts');
const types = read('../src/types/restaumax.ts');
const pos = read('../src/components/pos/PosView.tsx');

const handlerStart = server.indexOf('export async function handleCustomerCashPreferenceRequest');
const handlerEnd = server.indexOf('export async function handleCustomerPayDunyaInvoiceRequest', handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, 'Le handler de préférence espèces QR doit exister.');
const handler = server.slice(handlerStart, handlerEnd);
assert(handler.includes('requestHasValidOrigin(req)'), 'Le choix espèces exige une origine autorisée.');
assert(handler.includes('getActiveTableSession(adminDb, sessionSecret)'), 'Le choix espèces exige une session QR active.');
assert(handler.includes('validateCsrf(session, csrfHeader)'), 'Le choix espèces exige le contrôle CSRF.');
assert(handler.includes("paymentPreference: 'especes'"), 'Le choix espèces est enregistré sur la commande.');
assert(handler.includes("paymentPreferenceSource: 'customer_qr'"), 'La provenance client QR est conservée.');
assert(handler.includes('pendingPayDunyaIntentId'), 'Un paiement Mobile Money déjà en cours bloque le basculement vers espèces.');
assert(!handler.includes('startPayDunyaOrderPaymentWithDb') && !handler.includes('loadRestaurantPayDunyaConfig'),
  'Le choix espèces ne doit appeler ni config ni service PayDunya.');
assert(!handler.includes("paymentStatus: 'paid'") && !handler.includes('paidAmount:'),
  'Le choix espèces ne doit ni solder ni augmenter le montant payé de la commande.');

assert(server.includes("app.post('/api/payments/customer-cash-preference'"), 'La route client espèces doit être exposée.');
assert(firebase.includes("fetch('/api/payments/customer-cash-preference'"), 'Le client appelle la route espèces dédiée.');
assert(firebase.includes('App Check token unavailable; continuing to server-side validation.'), 'Une erreur de jeton App Check navigateur ne doit pas empêcher l’appel serveur idempotent ; le serveur garde la décision de sécurité.');
assert(app.includes('selectCustomerCashPaymentWithServerValidation'), 'App branche le choix espèces sécurisé.');
assert(app.includes("userPermissions.includes('reports.cash.view')"), 'Le journal de paiements est accessible aux rôles explicitement autorisés à consulter la caisse.');
assert(app.includes('window.setInterval(() => void refreshPayments(), 15000)'), 'Le journal de paiements est actualisé automatiquement pour recevoir les confirmations PayDunya et espèces sans recharger la page.');
assert(clientMenu.includes('onSelectCashPayment={onSelectCashPayment}'), 'Le choix espèces est transmis à la confirmation.');

assert(modal.includes('Choisir le règlement en espèces'), 'Le client voit une option espèces.');
assert(modal.includes('ne passe jamais par PayDunya'), 'Le client est informé que les espèces sont hors PayDunya.');
assert(modal.includes('après réception effective des espèces'), 'La caisse n’enregistre les espèces qu’après réception effective.');
assert(paydunya.includes("if (order.paymentPreference === 'especes')"), 'PayDunya refuse les commandes affectées aux espèces.');
assert(types.includes("paymentPreference?: 'especes' | 'mobile_money'"), 'Le type de commande expose la préférence de règlement.');
assert(pos.includes("order.paymentPreference === 'especes' ? 'Espèces demandées'"), 'La caisse identifie les commandes dont le client a choisi les espèces.');
assert(modal.includes('|| cashPreferenceSaved'), 'Le client ne peut pas lancer PayDunya après avoir confirmé son choix espèces.');

console.log('Tests QR, caisse et actualisation du journal / séparation PayDunya : 22 assertions réussies.');
