import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const firebase = read('../src/lib/firebase.ts');
const app = read('../src/App.tsx');
const server = read('../server.ts');
const orderService = read('../src/server/orderService.ts');
const cartDrawer = read('../src/components/restaumax/CartDrawer.tsx');
const indexConfig = JSON.parse(read('../firestore.indexes.json'));

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
assert.ok(submit.includes("!data || typeof data !== 'object' || Array.isArray(data)"),
  'Une réponse vide ou mal formée ne doit jamais être traitée comme un échec certain après un POST.');

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
assert(cartDrawer.includes('{submitError && (') && cartDrawer.includes('Vérification toujours incertaine :'),
  'Le panier doit afficher aussi le résultat de la tentative de vérification quand il reste verrouillé.');

const tokenHashOverride = indexConfig.fieldOverrides.find(
  item => item.collectionGroup === 'table_qr_tokens' && item.fieldPath === 'tokenHash'
);
const sessionHashOverride = indexConfig.fieldOverrides.find(
  item => item.collectionGroup === 'table_sessions' && item.fieldPath === 'sessionHash'
);
const hasCollectionGroupAscending = override => override?.indexes.some(
  index => index.queryScope === 'COLLECTION_GROUP' && index.order === 'ASCENDING'
);
assert.ok(hasCollectionGroupAscending(tokenHashOverride), 'tokenHash doit être déclaré en exemption collection-group croissante.');
assert.ok(hasCollectionGroupAscending(sessionHashOverride), 'sessionHash doit être déclaré en exemption collection-group croissante.');
assert.ok(!indexConfig.indexes.some(index => ['table_qr_tokens', 'table_sessions'].includes(index.collectionGroup)),
  'Les index à champ unique QR ne doivent pas être déclarés comme index composites manuels.');
assert.ok([tokenHashOverride, sessionHashOverride].every(override =>
  ['ASCENDING', 'DESCENDING'].every(order =>
    override?.indexes.some(index => index.queryScope === 'COLLECTION' && index.order === order)
  ) && override?.indexes.some(index => index.queryScope === 'COLLECTION' && index.arrayConfig === 'CONTAINS')
), 'Les index automatiques à portée collection restent activés.');

console.log('Tests transport commande QR, idempotence et index Firestore : 19/19 assertions réussies.');
