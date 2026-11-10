import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const firebase = read('../src/lib/firebase.ts');
const app = read('../src/App.tsx');
const server = read('../server.ts');
const orderService = read('../src/server/orderService.ts');

const submitStart = firebase.indexOf('export async function submitOrderWithServerValidation');
const submitEnd = firebase.indexOf('Soumet une commande POS', submitStart);
assert(submitStart >= 0 && submitEnd > submitStart, 'Le helper de soumission publique doit exister.');
const submit = firebase.slice(submitStart, submitEnd);

assert.ok(submit.includes("if (params.orderMode !== 'sur_place' && appCheck)"),
  'Les commandes sur place ne doivent pas dépendre du jeton App Check navigateur.');
assert.ok(submit.includes("outcomeUnknown: false"),
  'Un échec App Check avant le fetch doit être déclaré certain.');
assert.ok(submit.includes("outcomeUnknown: true"),
  'Une coupure réseau ou une réponse illisible après le POST doit rester ambiguë.');
assert.ok(submit.includes("typeof data.outcomeUnknown !== 'boolean' && response.status >= 500"),
  'Le serveur peut distinguer une panne certaine d’un résultat de transaction ambigu.');

const appStart = app.indexOf('const handleClientOrderConfirm = async');
const appEnd = app.indexOf('const handleSaveTable =', appStart);
assert(appStart >= 0 && appEnd > appStart, 'Le handler client de commande doit exister.');
const clientOrder = app.slice(appStart, appEnd);
assert(clientOrder.includes('loadPendingOrderIntent(activeRestaurantSlug)'),
  'La tentative précédente doit être restaurée depuis sessionStorage.');
assert(clientOrder.includes('savedIntent?.customerNote') &&
       clientOrder.includes('savedIntent?.customerName') &&
       clientOrder.includes('savedIntent?.customerPhone'),
  'Une reprise doit réutiliser exactement les champs signés de l’intention initiale.');
assert(clientOrder.includes('if (submitRes.outcomeUnknown === true)'),
  'Le panier ne doit être verrouillé que lorsque le résultat est réellement ambigu.');
const conflictStart = clientOrder.indexOf('if (submitRes.conflict)');
const conflictEnd = clientOrder.indexOf('if (submitRes.outcomeUnknown === true)', conflictStart);
assert(conflictStart >= 0 && conflictEnd > conflictStart, 'Le conflit d’idempotence doit être traité explicitement.');
assert(!clientOrder.slice(conflictStart, conflictEnd).includes('generateClientOrderIdempotencyKey'),
  'Un conflit ne doit jamais effacer la clé et créer une nouvelle tentative automatiquement.');

assert(orderService.includes('outcomeUnknown: true'),
  'Une exception de transaction atomique doit être signalée comme ambiguë.');
assert(server.includes('if (result.outcomeUnknown) return { statusCode: 503, body: result };'),
  'Le serveur doit renvoyer un statut retryable pour une transaction dont le résultat est ambigu.');

console.log('Tests transport commande QR et idempotence : 13/13 assertions réussies.');
