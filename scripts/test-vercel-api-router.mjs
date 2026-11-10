import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTAUMAX_API_ROUTES,
  getRestauMaxRequestQueryParam,
  resolveRestauMaxApiRoute,
  resolveRestauMaxApiRouteFromRequest
} from '../src/server/apiRouteMap.ts';

const apiRoot = fileURLToPath(new URL('../api/', import.meta.url));
const apiFiles = [];
function collectApiFiles(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collectApiFiles(join(directory, entry.name), relative);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs') || entry.name.endsWith('.ts')) apiFiles.push(relative);
  }
}
collectApiFiles(apiRoot);
assert.deepEqual(apiFiles.sort(), ['index.ts'], 'Hobby doit compiler un seul point d’entrée de fonction Vercel.');

assert.equal(RESTAUMAX_API_ROUTES.length, 22, 'Les 22 points d’entrée actifs doivent être conservés.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.path)).size, 22, 'Chaque chemin doit être unique.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.id)).size, 22, 'Chaque identifiant doit être unique.');

const expectedMethods = {
  health: ['GET'],
  'app-check-probe': ['POST'],
  inventory: ['POST'],
  'customer-loyalty': ['POST'],
  'kitchen-item': ['POST'],
  'order-status': ['POST'],
  'public-menu': ['GET'],
  'restaurant-images': ['POST', 'DELETE'],
  orders: ['POST'],
  payments: ['GET', 'POST'],
  'platform-admin': ['GET', 'POST'],
  'pos-orders': ['POST'],
  reports: ['GET'],
  'restaurant-service': ['POST'],
  'table-session': ['GET'],
  'customer-cash-preference': ['POST'],
  'customer-paydunya': ['POST'],
  'customer-paydunya-reconcile': ['POST'],
  'paydunya-callback': ['POST'],
  'paydunya-disbursement-callback': ['POST'],
  'subscription-billing-cycle': ['GET'],
  'tables-qr': ['GET', 'POST', 'DELETE'],
  'tables-resolve-qr': ['GET']
};

const handler = readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

assert.deepEqual(Object.keys(vercel.functions), ['api/index.ts'], 'vercel.json doit déclarer uniquement api/index.ts.');

for (const route of RESTAUMAX_API_ROUTES) {
  assert.equal(resolveRestauMaxApiRoute(route.path), route, `Résolution incorrecte pour ${route.path}`);
  assert.equal(resolveRestauMaxApiRoute(route.id), route, `Résolution incorrecte pour l’identifiant ${route.id}`);
  assert.equal(resolveRestauMaxApiRoute(` /api/${route.path}/ `), null, 'Le résolveur doit rejeter les chemins non fournis par la réécriture.');
  assert.deepEqual([...route.methods], expectedMethods[route.id], `Méthodes HTTP modifiées pour ${route.path}`);

  const rewrite = vercel.rewrites.find((item) => item.source === `/api/${route.path}`);
  assert.ok(rewrite, `Réécriture Vercel manquante pour /api/${route.path}`);
  assert.equal(rewrite.destination, `/api/index?__restaumax_route=${route.id}`);

  if (route.id === 'health' || route.id === 'platform-admin') {
    assert.ok(handler.includes(`route.id === '${route.id}'`), `Traitement manquant pour ${route.id}`);
  } else {
    assert.ok(handler.includes(`case '${route.id}'`), `Traitement manquant pour ${route.id}`);
  }
}

const qrRewrite = vercel.rewrites.find((item) => item.source === '/q/:token');
assert.equal(
  qrRewrite?.destination,
  '/api/index?__restaumax_route=tables-resolve-qr&token=:token',
  'Le QR physique doit continuer à résoudre la table via le routeur central.'
);

assert.equal(resolveRestauMaxApiRouteFromRequest({ query: { __restaumax_route: 'tables-qr' } })?.id, 'tables-qr');
assert.equal(resolveRestauMaxApiRouteFromRequest({ url: '/api/index?__restaumax_route=tables-qr' })?.id, 'tables-qr');
assert.equal(resolveRestauMaxApiRouteFromRequest({ url: '/api/tables/qr' })?.id, 'tables-qr');
assert.equal(resolveRestauMaxApiRouteFromRequest({ originalUrl: '/api/tables/qr' })?.id, 'tables-qr');
assert.equal(
  getRestauMaxRequestQueryParam({
    query: { __restaumax_route: 'tables-resolve-qr' },
    url: '/api/index?__restaumax_route=tables-resolve-qr&token=opaque-qr-token'
  }, 'token'),
  'opaque-qr-token',
  'Le jeton QR est récupéré dans req.url même si Vercel ne le fournit pas dans req.query.'
);
assert.equal(
  getRestauMaxRequestQueryParam({ url: '/api/index?token=from-original-url' }, 'token'),
  'from-original-url',
  'Le jeton QR est récupéré depuis l’URL brute en l’absence de req.query.'
);
assert.equal(getRestauMaxRequestQueryParam({ query: { token: 'parsed-token' }, url: '/api/index?token=raw-token' }, 'token'), 'parsed-token');
assert.equal(resolveRestauMaxApiRouteFromRequest({ url: '/api/unknown' }), null);
assert.equal(resolveRestauMaxApiRoute(undefined), null);
assert.equal(resolveRestauMaxApiRoute(['orders']), null);
assert.equal(resolveRestauMaxApiRoute('unknown'), null);
assert.equal(resolveRestauMaxApiRoute('../server.ts'), null);

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
assert.ok(server.includes('export async function handleAppCheckProbeRequest'), 'Le diagnostic doit être partagé avec l’adaptateur Vercel.');
assert.ok(server.includes("process.env.VERCEL_ENV !== 'preview'"), 'Le diagnostic doit refuser tout environnement autre que Preview.');
assert.ok(server.includes("appletConfig?.projectId !== 'restaumax-demo'"), 'Le diagnostic doit refuser tout projet Firebase autre que restaumax-demo.');

console.log('PASS: 1 fonction Vercel, 22 routes conservées, réécritures, méthodes HTTP et garde Preview vérifiées.');
