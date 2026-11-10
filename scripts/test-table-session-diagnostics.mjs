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
assert.match(handler, /console\.error\('\[RestauMax table session\] Session lookup failed:'/,
  'Le code et le message Firestore sont conservés dans les logs serveur.');
assert.match(handler, /statusCode: 503,/,
  'Une panne Firestore/index renvoie 503 et non un faux 401.');
assert.match(handler, /String\(error\?\.code \|\| 'unknown'\)/,
  'Le code d’erreur Firestore est journalisé.');
assert.doesNotMatch(handler, /console\.error[^\n]*(secret|cookie)/i,
  'Aucun secret de session/cookie ne doit être journalisé.');

console.log('Tests diagnostic session QR : 7/7 réussis.');
