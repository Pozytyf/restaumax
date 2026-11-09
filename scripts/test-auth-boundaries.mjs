import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const firebase = read('src/lib/firebase.ts');
const adminView = read('src/components/restaumax/PlatformAdminView.tsx');
const platformAdmin = read('src/server/platformAdmin.ts');
const server = read('server.ts');
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
assert.match(platformAdmin, /nextSessionVersion = Math\.max\([\s\S]*?Number\(user\.sessionVersion \|\| 0\)[\s\S]*?\) \+ 1;[\s\S]*?membershipRef\.update\([\s\S]*?sessionVersion: nextSessionVersion/,
  'promoting a former restaurant identity invalidates all previously issued restaurant sessions');

// Cross-login in the opposite direction: the admin console stays hidden until
// the platform API authorizes the current Firebase identity. A 401/403 closes it.
assert.match(adminView, /isPlatformAdminAuthorized/,
  'platform console has a separate server-authorization state');
assert.match(adminView, /useState<User \| null>\(auth\.currentUser\)/,
  'an already-open Firebase session is evaluated when /admin mounts');
assert.match(adminView, /onAuthStateChanged\(auth, \(nextUser\)/,
  'a restored or changed Firebase session is revalidated on /admin');
assert.match(adminView, /response\.status === 401 \|\| response\.status === 403/,
  'platform API rejection is explicitly handled');
assert.match(adminView, /await signOut\(auth\)/,
  'a rejected owner/staff Firebase session is closed after platform API denial');
assert.match(adminView, /!isPlatformAdminAuthorized \? <section/,
  'platform dashboard is not rendered before server authorization');

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
assert.equal(tokenChecks.length, 6, 'all six authenticated restaurant API handlers are covered');
for (const [index, match] of tokenChecks.entries()) {
  assert.match(match[1], /decoded\.role === 'super_admin' \|\| decoded\.role === 'admin'/,
    `restaurant API handler ${index + 1} rejects platform-admin identities`);
}

// The two route renderers must remain distinct and role-gated.
assert.match(app, /Le super-administrateur n’a pas accès aux opérations d’un restaurant\./,
  'the required platform-admin refusal message is displayed on /gestion');
assert.match(app, /!authUser \|\| !isAuthorizedManager/,
  '/gestion requires an authenticated, active restaurant membership');
assert.match(app, /!\(isRestaurantOwner \|\| authRestaurantRole === 'manager'\)/,
  'the management hub is limited to owners and managers');
console.log('RestauMax authentication boundary checks passed.');
