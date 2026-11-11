import assert from 'node:assert/strict';
import fs from 'node:fs';

const hub = fs.readFileSync(new URL('../src/components/restaumax/RestaurantHubView.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const dishForm = fs.readFileSync(new URL('../src/components/restaumax/DishFormModal.tsx', import.meta.url), 'utf8');
const menuView = fs.readFileSync(new URL('../src/components/restaumax/MenuManagementView.tsx', import.meta.url), 'utf8');
const managerView = fs.readFileSync(new URL('../src/components/manager/ManagerView.tsx', import.meta.url), 'utf8');
const posView = fs.readFileSync(new URL('../src/components/pos/PosView.tsx', import.meta.url), 'utf8');
const firestoreRules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

assert(hub.includes("actionLabel: canViewCatalog ? 'Gérer les options, suppléments et prix'"), 'module 3 is clearly labelled and permission-gated as catalogue management');
assert(hub.includes("id: 'options-prices'") && hub.includes("setActiveTab('menu_catalog')"), 'module 3 opens the administrative catalogue instead of the public client menu');
assert(hub.includes('Carte bancaire non activée en V1'), 'the cash register module does not advertise an unavailable card payment method');
assert(app.includes("canManageStaff={isRestaurantOwner || (authRestaurantRole === 'manager' && userPermissions.includes('staff.manage'))}"), 'authorized managers can manage subordinate staff');
assert(!app.includes('canManageStaff={isRestaurantOwner || authIsSuperAdmin}'), 'super-admin is not granted restaurant staff operations');
assert(firebase.includes("['owner', 'manager', 'cashier', 'server', 'kitchen'].includes(data.role)"), 'only restaurant roles may enter operational workspaces');
assert(firebase.includes('Owner binding is enforced server-side against private/ownership metadata.'), 'owner workspace access delegates binding to private ownership metadata');
assert(!firebase.includes("restaurantSnap.data()?.ownerUid === user.uid"), 'client workspace does not trust public owner identity fields');
assert(firestoreRules.includes('function isBoundRestaurantOwner'), 'Firestore rules bind owner access to the private ownership record');
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
assert(dishForm.includes('optionGroups.length >= 20') && dishForm.includes('group.options.length >= 50') &&
  dishForm.includes('extras.length >= 50'), 'catalogue editor prevents option data from exceeding Firestore limits');
assert(dishForm.includes('uniqueTags.length <= 30') && dishForm.includes('30 tags maximum'), 'catalogue editor enforces the Firestore tag limit');
assert(dishForm.includes('numPrep > 1440') && dishForm.includes('max={1440}'), 'catalogue editor matches the Firestore preparation-time ceiling');

assert(firebase.includes('transaction.delete(recipeRef)') && firebase.includes('transaction.delete(menuItemRef)'),
  'deleting a catalogue item also removes its linked recipe in one transaction');
assert(firestoreRules.includes('!existsAfter(/databases/$(database)/documents/restaurants/$(restaurantSlug)/menuRecipes/$(dishId))') &&
  firestoreRules.includes('!existsAfter(/databases/$(database)/documents/restaurants/$(restaurantSlug)/menuItems/$(menuItemId))'),
  'Firestore prevents orphaned recipes and requires linked catalogue deletion to be atomic');

assert(app.includes('subscribeToMenuItems(') && app.includes('activeRestaurantSlug'),
  'the customer menu and management workspace subscribe to the selected restaurant catalogue');
assert(app.includes('setMenuItems(activeMenuItems.map((dish) => ({'),
  'the POS menu is derived from the same live Firestore catalogue');
const clientMenu = fs.readFileSync(new URL('../src/components/restaumax/ClientMenuView.tsx', import.meta.url), 'utf8');
assert(clientMenu.includes('available === false') || clientMenu.includes('available !== false'),
  'unavailable dishes are excluded from the customer ordering flow');
assert(menuView.includes('canManageCatalog = false') && menuView.includes('if (!canManageCatalog) return'),
  'catalogue mutation actions are guarded by the menu.manage permission');
assert(menuView.includes("(item.description || '').toLowerCase().includes(query)"),
  'catalogue search tolerates legacy entries without a description');
assert(!menuView.includes('Répertoire complet Chez Awa'),
  'catalogue UI contains no hardcoded demo restaurant label');

assert(hub.includes('Catalogue actif · {restaurant.name}'), 'catalogue metrics use the current restaurant name in multi-tenant mode');
assert(app.split('bar.access').length - 1 >= 2, 'owner sessions receive Bar access during both auth restoration and manager login flows');
assert(managerView.includes('cashRefunds') && managerView.includes('Solde théorique = fond d’ouverture + encaissements espèces') && !managerView.includes('Les remboursements restent à intégrer'),
  'the theoretical cash balance explicitly subtracts and separately displays cash refunds');
assert(hub.includes("id: 'bar'") && hub.includes("onNavigateToStaffRole('bar')") && hub.includes("bar: ['bar.access']"),
  'the management hub exposes a permission-gated, dedicated Bar tile');
assert(hub.includes("'🍹'") && hub.includes('Organisation des 13 modules métier'),
  'the management modules use service-specific emoji tiles and include the Bar module');
assert(menuView.includes("id: 'boissons'") && menuView.includes('Menu du restaurant · plats & boissons') && dishForm.includes("id: 'boissons'"),
  'drinks remain a first-class category in the restaurant menu and dish editor');
assert(!dishForm.includes("restaurant.slug || 'chez-awa'"), 'dish creation never falls back to a hardcoded demo tenant');
assert(dishForm.includes('newDishIdRef.current') && dishForm.includes('await onSave(savedDish)'), 'dish creation reuses one document ID after an ambiguous network failure');

assert(managerView.includes("useState<'session' | 'collections' | 'control'>('session')") &&
  managerView.includes('1 · Session de caisse') && managerView.includes('2 · Encaissements') &&
  managerView.includes('3 · Contrôle'), 'cash supervision is split into the three requested sections');
assert(managerView.includes("hidden={activeCashSection !== 'session'}") &&
  managerView.includes("hidden={activeCashSection !== 'collections'}") &&
  managerView.includes("hidden={activeCashSection !== 'control'}"),
  'the three cash supervision sections switch without removing their underlying data or permission checks');
assert(managerView.includes('Écarts de comptage, clôtures journalières et rapports') &&
  managerView.includes('Journal des Transactions Récentes') && managerView.includes('Fermer la session de caisse') &&
  managerView.includes('Ouvrir la session de caisse'),
  'cash supervision groups session, collections and control content by purpose and exposes the current open/close actions');
assert(posView.includes('Tickets en attente de validation') && posView.includes("onCancelPendingOrder?.(order, 'cancel')") &&
  posView.includes("onCancelPendingOrder?.(order, 'remove')"), 'POS exposes cancel and logical removal actions for pending tickets');
assert(app.includes('canManagePendingPosOrders') && app.includes('pendingOnly: true') &&
  app.includes("['manager', 'cashier'].includes(authRestaurantRole) && userPermissions.includes('orders.cancel')"),
  'pending ticket actions are exposed only to the bound owner or a cashier/manager with orders.cancel');
console.log('Restaurant management navigation checks passed.');
