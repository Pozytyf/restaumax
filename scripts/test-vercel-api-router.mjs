import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTAUMAX_API_ROUTES,
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

assert.equal(RESTAUMAX_API_ROUTES.length, 17, 'Les 17 anciens points d’entrée doivent être conservés.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.path)).size, 17, 'Chaque chemin doit être unique.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.id)).size, 17, 'Chaque identifiant doit être unique.');

const expectedMethods = {
  health: ['GET'],
  inventory: ['POST'],
  'kitchen-item': ['POST'],
  'order-status': ['POST'],
  orders: ['POST'],
  payments: ['GET', 'POST'],
  'platform-admin': ['GET', 'POST'],
  'pos-orders': ['POST'],
  reports: ['GET'],
  'table-session': ['GET'],
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
assert.equal(resolveRestauMaxApiRouteFromRequest({ url: '/api/unknown' }), null);
assert.equal(resolveRestauMaxApiRoute(undefined), null);
assert.equal(resolveRestauMaxApiRoute(['orders']), null);
assert.equal(resolveRestauMaxApiRoute('unknown'), null);
assert.equal(resolveRestauMaxApiRoute('../server.ts'), null);

console.log('PASS: 1 fonction Vercel, 17 routes conservées, réécritures et méthodes HTTP vérifiées.');
