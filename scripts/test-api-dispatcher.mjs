import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CORE_API_ROUTES,
  getCoreApiAllowedMethods,
  isCoreApiMethodAllowed,
  resolveCoreApiRoute
} from '../src/utils/apiRoute.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedRoutes = [
  'health',
  'inventory',
  'kitchen-item',
  'orders',
  'platform-admin',
  'pos-orders',
  'table-session',
  'tables/qr',
  'tables/resolve-qr'
];

assert.deepEqual(Object.keys(CORE_API_ROUTES), expectedRoutes);
for (const route of expectedRoutes) {
  assert.equal(resolveCoreApiRoute(route), route);
}
assert.equal(resolveCoreApiRoute(undefined), null);
assert.equal(resolveCoreApiRoute(['orders']), null);
assert.equal(resolveCoreApiRoute('unknown'), null);

assert.equal(isCoreApiMethodAllowed('health', 'GET'), true);
assert.equal(isCoreApiMethodAllowed('health', 'POST'), false);
assert.equal(isCoreApiMethodAllowed('inventory', 'POST'), true);
assert.equal(isCoreApiMethodAllowed('inventory', 'GET'), false);
assert.equal(isCoreApiMethodAllowed('tables/qr', 'DELETE'), true);
assert.equal(isCoreApiMethodAllowed('tables/qr', 'PUT'), false);
assert.equal(isCoreApiMethodAllowed('tables/resolve-qr', 'GET'), true);
assert.equal(isCoreApiMethodAllowed('tables/resolve-qr', 'POST'), false);
assert.equal(isCoreApiMethodAllowed('platform-admin', 'PATCH'), true);
assert.deepEqual(getCoreApiAllowedMethods('tables/qr'), ['POST', 'DELETE']);
assert.equal(getCoreApiAllowedMethods('platform-admin'), null);

const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const rewrites = new Map(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
for (const route of expectedRoutes) {
  const source = `/api/${route}`;
  assert.equal(rewrites.get(source), `/api/core?route=${route}`, `rewrite manquant: ${source}`);
}
assert.equal(
  rewrites.get('/q/:token'),
  '/api/core?route=tables/resolve-qr&token=:token'
);

const apiRoot = join(root, 'api');
const topLevelFunctions = readdirSync(apiRoot).filter((name) => name.endsWith('.ts'));
const nestedPaymentFunctions = readdirSync(join(apiRoot, 'payments')).filter((name) => name.endsWith('.ts'));
assert.deepEqual(topLevelFunctions.sort(), ['core.ts', 'payments.ts']);
assert.equal(nestedPaymentFunctions.length, 4);
assert.equal(topLevelFunctions.length + nestedPaymentFunctions.length, 6);

for (const removed of [
  'health.ts',
  'inventory.ts',
  'kitchen-item.ts',
  'orders.ts',
  'platform-admin.ts',
  'pos-orders.ts',
  'table-session.ts'
]) {
  assert.equal(existsSync(join(apiRoot, removed)), false, `ancien wrapper encore présent: ${removed}`);
}
for (const preserved of [
  'payments.ts',
  'payments/customer-paydunya.ts',
  'payments/customer-paydunya-reconcile.ts',
  'payments/paydunya-callback.ts',
  'payments/paydunya-disbursement-callback.ts'
]) {
  assert.equal(existsSync(join(apiRoot, preserved)), true, `endpoint protégé absent: ${preserved}`);
}

console.log('API dispatcher Vercel : 9 routes, méthodes, rewrites et 6 fonctions vérifiés.');
