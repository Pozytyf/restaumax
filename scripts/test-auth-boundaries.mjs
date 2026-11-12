import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const firebase = read('src/lib/firebase.ts');
const adminView = read('src/components/restaumax/PlatformAdminView.tsx');
const platformAdmin = read('src/server/platformAdmin.ts');
const server = read('server.ts');
const tableSecurity = read('src/server/tableSecurityService.ts');
const imageService = read('src/server/restaurantImageService.ts');
const rules = read('firestore.rules');

// Cross-login: a platform identity cannot pass the restaurant membership gate,
// even if an old managers/{uid} document still grants an owner/staff role.
assert.match(firebase, /tokenResult\.claims\?\.role === 'super_admin' \|\| tokenResult\.claims\?\.role === 'admin'\) return false/,
  'restaurant login rejects platform-admin custom claims before membership lookup');
assert.match(firebase, /await signOut\(auth\)/,
  'a Firebase identity rejected by restaurant login is signed out');
assert.match(platformAdmin, /verifyIdToken\(token, true\)/,
  'platform API verifies token revocation');
assert.match(platformAdmin, /function isSuperAdmin\(user: DecodedIdToken\)/,
  'platform API independently checks the super-admin allowlist/custom claim');
assert.match(platformAdmin, /existingMembership\?\.active === true[\s\S]*?\['owner', 'manager', 'cashier', 'server', 'kitchen', 'staff'\]/,
  'a Firebase identity with an active restaurant membership is refused platform-admin access');
assert.ok(
  platformAdmin.includes('const tokenVersion = Number(user.sessionVersion || 0);') &&
  platformAdmin.includes('nextSessionVersion = Math.max(') &&
  platformAdmin.includes('sessionVersion: nextSessionVersion'),
  'promoting a former restaurant identity invalidates all previously issued restaurant sessions'
);

// Cross-login in the opposite direction: the admin console stays hidden until
// the platform API authorizes the current Firebase identity. A 401/403 closes it.
assert.match(adminView, /isPlatformAdminAuthorized/,
  'platform console has a separate server-authorization state');
assert.match(adminView, /useState<User \| null>\(auth\.currentUser\)/,
  'an already-open Firebase session is evaluated when /admin mounts');
assert.match(adminView, /onAuthStateChanged\(auth, \(nextUser\)/,
  'a restored or changed Firebase session is revalidated on /admin');
assert.match(adminView, /!\['super_admin', 'platform_admin'\]\.includes\(String\(token\.claims\.role \|\| ''\)\)/,
  'only super-admin and delegated platform-admin claims can restore the platform console session');
assert.match(adminView, /adminLoginInProgress\.current = true[\s\S]*?const data = await request\(\)/,
  'the dedicated admin login explicitly authenticates before requesting platform access');
assert.match(adminView, /\(!user \|\| needsPlatformAdminLogin\) \? \([\s\S]*?mfaResolver \?/,
  'a pre-existing non-platform Firebase session remains behind the dedicated admin login boundary');
assert.match(adminView, /: <form onSubmit=\{login\}/,
  'the dedicated admin login form remains available when no MFA challenge is pending');
assert.match(adminView, /getMultiFactorResolver\(auth, authError\)/,
  'Firebase multi-factor sign-in challenges are resolved explicitly');
assert.match(adminView, /TotpMultiFactorGenerator\.assertionForSignIn/,
  'the super-admin login supports authenticator-app TOTP challenges');
assert.match(adminView, /PhoneMultiFactorGenerator\.assertion/,
  'the super-admin login supports enrolled SMS second factors');
assert.match(adminView, /response\.status === 401 \|\| response\.status === 403/,
  'platform API rejection is explicitly handled');
assert.match(adminView, /await signOut\(auth\)/,
  'a rejected owner/staff Firebase session is closed after platform API denial');
assert.match(adminView, /!isPlatformAdminAuthorized \? \([\s\S]*?<section/,
  'platform dashboard is not rendered before server authorization');
assert.doesNotMatch(adminView, /onOpenRestaurant/,
  'platform administration cannot navigate into a restaurant operations workspace');

// Refresh/session restoration: role resolution completes before protected
// management routes leave their loading state; token changes re-run the check.
assert.match(app, /setIsLoadingAuth\(true\)[\s\S]*?user\.getIdTokenResult\(\)[\s\S]*?finally\(\(\) => \{[\s\S]*?setIsLoadingAuth\(false\)/,
  'protected routes wait for restored Firebase claims before rendering');
assert.match(firebase, /onIdTokenChanged\(auth, async \(user\)/,
  'restored and refreshed Firebase sessions re-run restaurant authorization');
assert.match(firebase, /Number\(tokenResult\.claims\?\.sessionVersion \|\| 0\) !== Number\(data\.sessionVersion \|\| 0\)/,
  'restaurant sessions are rejected when their membership session version was revoked');
assert.match(rules, /request\.auth\.token\.get\('role', ''\) in \['super_admin', 'admin'\]/,
  'Firestore rules deny platform-admin identities from restaurant data');
assert.match(rules, /request\.auth\.token\.get\('sessionVersion', 0\) == get\([\s\S]*?sessionVersion/,
  'Firestore rules enforce the current membership session version');

// Server-side route boundary: all authenticated restaurant API handlers verify
// revocation and then reject platform-admin identities before reading tenant data.
const tokenChecks = [...server.matchAll(/const decoded = await adminAuth\.verifyIdToken\(idToken, true\);([\s\S]{0,280})/g)];
assert.equal(tokenChecks.length, 8, 'all eight direct-token restaurant API handlers are covered');
assert(server.includes('export async function handleTableCreateRequest') &&
  server.includes('await authorizeTableManager(adminDb, adminAuth, req, restaurantSlug);') &&
  server.includes('createTableWithDb(adminDb, restaurantSlug, input.table)'),
  'table creation delegates identity, session and tables.manage checks to the shared table authorization service');
assert.match(server, /handleCustomerLoyaltyAdjustmentRequest[\s\S]*?verifyIdToken\(idToken, true\)[\s\S]*?adjustCustomerLoyaltyPointsWithDb/,
  'manual loyalty adjustments verify a non-revoked identity before invoking the tenant-scoped service');
for (const [index, match] of tokenChecks.entries()) {
  assert.match(match[1], /decoded\.role === 'super_admin' \|\| decoded\.role === 'admin'/,
    `restaurant API handler ${index + 1} rejects platform-admin identities`);
}
const tableTokenChecks = [...tableSecurity.matchAll(/const decoded = await auth\.verifyIdToken\(match\[1\], true\);([\s\S]{0,220})/g)];
assert.equal(tableTokenChecks.length, 2, 'both table/service manager entry points are covered');
for (const [index, match] of tableTokenChecks.entries()) {
  assert.match(match[1], /decoded\?\.role === 'super_admin' \|\| decoded\?\.role === 'admin'/,
    `table/service authorization ${index + 1} rejects platform-admin identities`);
}
assert.match(imageService, /decoded\?\.role === 'super_admin' \|\| decoded\?\.role === 'admin'/,
  'restaurant image upload and deletion reject platform-admin identities');

// The two route renderers must remain distinct and role-gated.
assert.match(app, /Le super-administrateur n’a pas accès aux opérations d’un restaurant\./,
  'the required platform-admin refusal message is displayed on /gestion');
assert.match(app, /!authUser \|\| !isAuthorizedManager/,
  '/gestion requires an authenticated, active restaurant membership');
assert.match(app, /!\(isRestaurantOwner \|\| authRestaurantRole === 'manager'\)/,
  'the management hub is limited to owners and managers');
console.log('RestauMax authentication boundary checks passed.');
