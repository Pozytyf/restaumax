import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('export async function handleGetTableSession');
const end = server.indexOf('export async function handleTableQrManagement', start);
assert(start >= 0 && end > start, 'Le handler de session de table doit exister.');
const handler = server.slice(start, end);

assert.match(handler, /if \(!session \|\| !csrfCookie \|\| !validateCsrf\(session, csrfCookie\)\)/,
  'Une session absente ou invalide reste refusée explicitement.');
assert.match(handler, /statusCode: 401, body: \{ success: false, error: 'Session de table absente, expirée ou révoquée\.'/,
  'Une absence/expiration/révocation réelle reste une réponse 401.');
assert.match(handler, /catch \(error: any\)/,
  'Les exceptions d’infrastructure sont capturées avec leur diagnostic.');
assert.match(handler, /console\\.error\\('\\[RestauMax table session\\] Session lookup failed:'/,
  'Le code et le message Firestore sont conservés dans les logs serveur.');
assert.match(handler, /statusCode: 503,/,
  'Une panne Firestore/index renvoie 503 et non un faux 401.');
assert.match(handler, /String\(error\?\.code \|\| 'unknown'\)/,
  'Le code d’erreur Firestore est journalisé.');
assert.doesNotMatch(handler, /console\.error[^\n]*(secret|cookie)/i,
  'Aucun secret de session/cookie ne doit être journalisé.');

const indexConfig = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
const qrTokenOverride = indexConfig.fieldOverrides.find(
  item => item.collectionGroup === 'table_qr_tokens' && item.fieldPath === 'tokenHash'
);
const tableSessionOverride = indexConfig.fieldOverrides.find(
  item => item.collectionGroup === 'table_sessions' && item.fieldPath === 'sessionHash'
);
const hasCollectionGroupAscending = override => override?.indexes.some(
  index => index.queryScope === 'COLLECTION_GROUP' && index.order === 'ASCENDING'
);
assert.ok(hasCollectionGroupAscending(qrTokenOverride), 'tokenHash doit être un index automatique de groupe de collections.');
assert.ok(hasCollectionGroupAscending(tableSessionOverride), 'sessionHash doit être un index automatique de groupe de collections.');
assert.ok(!indexConfig.indexes.some(index => ['table_qr_tokens', 'table_sessions'].includes(index.collectionGroup)),
  'Les index à un seul champ ne doivent pas être déclarés comme index manuels composites.');
for (const override of [qrTokenOverride, tableSessionOverride]) {
  for (const expected of [
    { queryScope: 'COLLECTION', order: 'ASCENDING' },
    { queryScope: 'COLLECTION', order: 'DESCENDING' },
    { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' }
  ]) {
    assert.ok(override.indexes.some(index => Object.entries(expected).every(([key, value]) => index[key] === value)),
      'Les index automatiques par collection existants doivent être préservés.');
  }
}

console.log('Tests diagnostic session QR et configuration des index : 11/11 réussis.');
