import assert from 'node:assert/strict';
import fs from 'node:fs';

const hub = fs.readFileSync(new URL('../src/components/restaumax/RestaurantHubView.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const dishForm = fs.readFileSync(new URL('../src/components/restaumax/DishFormModal.tsx', import.meta.url), 'utf8');
const menuView = fs.readFileSync(new URL('../src/components/restaumax/MenuManagementView.tsx', import.meta.url), 'utf8');
assert(hub.includes("actionLabel: 'Gérer les options, suppléments et prix'"), 'module 3 is clearly labelled as catalogue management');
assert(hub.includes("id: 'options-prices'") && hub.includes("setActiveTab('menu_catalog')"), 'module 3 opens the administrative catalogue instead of the public client menu');
assert(hub.includes('Carte bancaire non activée en V1'), 'the cash register module does not advertise an unavailable card payment method');
assert(app.includes("canManageStaff={isRestaurantOwner || (authRestaurantRole === 'manager' && userPermissions.includes('staff.manage'))}"), 'authorized managers can manage subordinate staff');
assert(!app.includes('canManageStaff={isRestaurantOwner || authIsSuperAdmin}'), 'super-admin is not granted restaurant staff operations');
assert(firebase.includes("['owner', 'manager', 'cashier', 'server', 'kitchen'].includes(data.role)"), 'only restaurant roles may enter operational workspaces');
assert(firebase.includes("restaurantSnap.data()?.ownerUid === user.uid"), 'owner workspace access is bound to the restaurant owner UID');
assert(firebase.includes("restaurantSnap.data()?.deletedAt"), 'logically deleted restaurants cannot authenticate operational staff');
assert(app.includes("token.claims.role === 'super_admin' || token.claims.role === 'admin'\n          ? []"), 'super-admin receives no restaurant operational permissions in the login flow');
assert(app.includes("const canViewTables = !!authUser && (\n      isRestaurantOwner || userPermissions.includes('tables.view')"), 'table subscriptions require an explicit tables.view permission');
assert(app.includes("authUser && authIsSuperAdmin"), 'super-admins are redirected away from restaurant operations');
assert(app.includes("!(isRestaurantOwner || authRestaurantRole === 'manager')"), 'only owners and managers can open the management hub');
assert(!app.includes('if (!isAuthorizedManager && !isRestaurantHubRoute) return;'), 'opening a protected route alone does not trigger tenant data subscriptions');
assert(dishForm.includes('onSave: (dish: RestauMenuItem) => Promise<void>'), 'dish form awaits asynchronous catalogue persistence');
assert(dishForm.includes('await onSave(savedDish)'), 'dish form closes only after the catalogue save resolves');
assert(dishForm.includes('setSaveError(message)'), 'dish form preserves the form and displays persistence errors');
assert(dishForm.includes('disabled={isSaving}'), 'dish form prevents duplicate submissions and closing while saving');
assert(menuView.includes('await onCreateDish(dish)') && menuView.includes('await onUpdateDish(dish)'), 'catalogue view awaits create and update operations');
assert(app.includes('subscribeToMenuItems(') && app.includes('activeRestaurantSlug'),
  'the customer menu and management workspace subscribe to the selected restaurant catalogue');
assert(app.includes('setMenuItems(activeMenuItems.map((dish) => ({'),
  'the POS menu is derived from the same live Firestore catalogue');
const clientMenu = fs.readFileSync(new URL('../src/components/restaumax/ClientMenuView.tsx', import.meta.url), 'utf8');
assert(clientMenu.includes('available === false') || clientMenu.includes('available !== false'),
  'unavailable dishes are excluded from the customer ordering flow');
assert(menuView.includes('canManageCatalog = false') && menuView.includes('if (!canManageCatalog) return'),
  'catalogue mutation actions are guarded by the menu.manage permission');
assert(!menuView.includes('Répertoire complet Chez Awa'),
  'catalogue UI contains no hardcoded demo restaurant label');

assert(hub.includes('Catalogue actif · {restaurant.name}'), 'catalogue metrics use the current restaurant name in multi-tenant mode');
assert(!dishForm.includes("restaurant.slug || 'chez-awa'"), 'dish creation never falls back to a hardcoded demo tenant');
assert(dishForm.includes('newDishIdRef.current') && dishForm.includes('await onSave(savedDish)'), 'dish creation reuses one document ID after an ambiguous network failure');
console.log('Restaurant management navigation checks passed.');
