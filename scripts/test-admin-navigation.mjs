import assert from 'node:assert/strict';
import fs from 'node:fs';

const hub = fs.readFileSync(new URL('../src/components/restaumax/RestaurantHubView.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
assert(hub.includes("actionLabel: 'Gérer les options, suppléments et prix'"), 'module 3 is clearly labelled as catalogue management');
assert(hub.includes("id: 'options-prices'") && hub.includes("setActiveTab('menu_catalog')"), 'module 3 opens the administrative catalogue instead of the public client menu');
assert(hub.includes('Carte bancaire non activée en V1'), 'the cash register module does not advertise an unavailable card payment method');
assert(app.includes("canManageStaff={isRestaurantOwner || (authRestaurantRole === 'manager' && userPermissions.includes('staff.manage'))}"), 'authorized managers can manage subordinate staff');
assert(!app.includes('canManageStaff={isRestaurantOwner || authIsSuperAdmin}'), 'super-admin is not granted restaurant staff operations');
assert(firebase.includes("['owner', 'manager', 'cashier', 'server', 'kitchen'].includes(data.role)"), 'only restaurant roles may enter operational workspaces');
assert(firebase.includes("restaurantSnap.data()?.ownerUid === user.uid"), 'owner workspace access is bound to the restaurant owner UID');
assert(app.includes("token.claims.role === 'super_admin' || token.claims.role === 'admin'\n          ? []"), 'super-admin receives no restaurant operational permissions in the login flow');
console.log('Restaurant management navigation checks passed.');
