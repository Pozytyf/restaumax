import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');
const orderService = fs.readFileSync(new URL('../src/server/orderService.ts', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../src/server/orderLifecycleService.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tsconfig = JSON.parse(fs.readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'));

const reportStart = server.indexOf('export async function handleRestaurantReportsRequest');
const reportEnd = server.indexOf('\nexport async function ', reportStart + 10);
const reportHandler = server.slice(reportStart, reportEnd > reportStart ? reportEnd : undefined);
assert(reportHandler.includes('verifyIdToken') && !reportHandler.includes('requestHasValidOrigin'),
  'same-origin authenticated GET reports do not depend on a browser Origin header');

const healthHandler = api.slice(api.indexOf("if (route.id === 'health')"), api.indexOf("if (route.id === 'platform-admin')"));
assert(healthHandler.includes("if (!adminDb)") && !healthHandler.includes('listCollections') &&
  !healthHandler.includes('firestoreCollectionCount'), 'public health does not expose Firestore probes or collection metadata');
const healthFunction = server.slice(server.indexOf('export function getServerHealth'), server.indexOf('export async function handleResolveTableQr'));
assert(!healthFunction.includes('projectId') && !healthFunction.includes('databaseId') && !healthFunction.includes('hasAdminDb'),
  'health response does not reveal infrastructure identifiers or configuration state');

assert(server.includes("res.setHeader('Content-Security-Policy', RESTAUMAX_CSP)") && server.includes("res.setHeader('X-Frame-Options', 'DENY')"),
  'Express production responses also receive CSP and anti-clickjacking headers');
assert(vercel.headers?.some(h => h.source === '/(.*)' &&
  h.headers.some(x => x.key === 'Content-Security-Policy' && x.value.includes("frame-ancestors 'none'") && x.value.includes('fonts.googleapis.com'))),
  'global CSP blocks framing and explicitly permits Google Fonts');
const securityHeaders = vercel.headers.find(h => h.source === '/(.*)').headers.map(h => h.key);
for (const key of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy','Strict-Transport-Security']) {
  assert(securityHeaders.includes(key), `global security header ${key} is configured`);
}
assert(packageJson.scripts.start.includes('NODE_ENV=production'), 'npm start always launches the production server');
assert(tsconfig.compilerOptions.strict === true, 'TypeScript strict mode is enabled');

assert(orderService.includes('cart.length > 50') && orderService.includes('requestedUnits > 100'),
  'public orders enforce line-count and total-unit limits before Firestore reads');
assert(!orderService.includes('error: `Statut d\'écriture ambigu dans Firestore : ${writeErr.message}') &&
  !orderService.includes('error: `La commande a été enregistrée dans Firestore mais la confirmation d\'idempotence a échoué (${commitErr.message})'),
  'public order responses do not expose raw Firestore write or idempotency errors');
assert(!server.includes('Service de commande indisponible : Firebase Admin non configuré'),
  'public order availability errors do not reveal Firebase Admin configuration');
assert(orderService.includes('hash.substring(0, 12)'), 'fallback ticket identifiers use a longer collision-resistant suffix');
assert(server.includes('consumePublicOrderRateLimit') && server.includes('maxRequests: 5'),
  'takeaway submissions use a persistent per-IP rate limiter');
assert(server.includes("FIREBASE_APPCHECK_ENFORCE_PUBLIC_ORDERS === 'true'") && server.includes('adminAppCheck.verifyToken'),
  'the backend can enforce Firebase App Check on public takeaway orders');
assert(client.includes('VITE_FIREBASE_APPCHECK_SITE_KEY') && client.includes('X-Firebase-AppCheck'),
  'the browser can initialize App Check and attach its token to public orders');
assert(server.includes('orderCounters') && server.includes('lastSequence') && server.includes('padStart(4'),
  'human ticket numbers are sequential per restaurant and UTC day');
assert(server.includes('menuStockDeferred: true') && lifecycle.includes('shouldConsumeMenuStock') &&
  lifecycle.includes('menuStockConsumptions'), 'tracked menu stock is consumed only when staff starts preparation');

assert(rules.includes('function isPublicRestaurant') && rules.includes('match /private/{privateDoc}'),
  'restaurant owner identity is stored outside the public profile');
const restaurantRuleStart = rules.indexOf('match /restaurants/{restaurantSlug}');
const restaurantRuleEnd = rules.indexOf('match /menuItems/{dishId}', restaurantRuleStart);
const restaurantRules = rules.slice(restaurantRuleStart, restaurantRuleEnd);
assert(restaurantRules.includes('isPublicRestaurant(resource.data)'),
  'legacy restaurant documents containing private owner metadata are denied to public readers until migration');
const customerRuleStart = rules.indexOf('match /customers/{customerId}');
const customerRuleEnd = rules.indexOf('\n      }', customerRuleStart);
const customerRules = rules.slice(customerRuleStart, customerRuleEnd);
assert(customerRules.includes("hasOnly(['name', 'phone', 'email', 'notes', 'updatedAt'])") &&
  !customerRules.includes("incoming().loyaltyPoints is number"), 'loyalty points cannot be changed directly by a client SDK');

console.log('RestauMax security audit hardening checks passed.');
