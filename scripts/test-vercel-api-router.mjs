import assert from 'node:assert/strict';
import {
  RESTAUMAX_API_ROUTES,
  resolveRestauMaxApiRoute
} from '../src/server/apiRouteMap.ts';

assert.equal(RESTAUMAX_API_ROUTES.length, 17, 'Les 17 anciens points d’entrée doivent être conservés.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.path)).size, 17, 'Chaque chemin doit être unique.');
assert.equal(new Set(RESTAUMAX_API_ROUTES.map((route) => route.id)).size, 17, 'Chaque identifiant doit être unique.');

for (const route of RESTAUMAX_API_ROUTES) {
  assert.equal(resolveRestauMaxApiRoute(route.path), route, `Résolution incorrecte pour ${route.path}`);
  assert.equal(resolveRestauMaxApiRoute(` /api/${route.path}/ `), null, 'Le résolveur reçoit le suffixe déjà normalisé par la réécriture.');
  assert.ok(route.methods.length > 0, `Méthodes HTTP absentes pour ${route.path}`);
}

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
  'tables-qr': ['POST', 'DELETE'],
  'tables-resolve-qr': ['GET']
};

for (const route of RESTAUMAX_API_ROUTES) {
  assert.deepEqual([...route.methods], expectedMethods[route.id], `Méthodes HTTP modifiées pour ${route.path}`);
}

assert.equal(resolveRestauMaxApiRoute(undefined), null);
assert.equal(resolveRestauMaxApiRoute(['orders']), null);
assert.equal(resolveRestauMaxApiRoute('unknown'), null);
assert.equal(resolveRestauMaxApiRoute('../server.ts'), null);

console.log('PASS: 17 routes API conservées, chemins uniques et méthodes HTTP contrôlées.');
