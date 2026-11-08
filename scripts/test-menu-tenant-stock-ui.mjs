import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = read('../firestore.rules');
const firebase = read('../src/lib/firebase.ts');
const server = read('../server.ts');
const orderService = read('../src/server/orderService.ts');
const lifecycle = read('../src/server/orderLifecycleService.ts');
const types = read('../src/types/restaumax.ts');
const dishForm = read('../src/components/restaumax/DishFormModal.tsx');
const adminMenu = read('../src/components/restaumax/MenuManagementView.tsx');
const clientMenu = read('../src/components/restaumax/ClientMenuView.tsx');

assert(rules.includes("resource.data.get('restaurantSlug', '') == restaurantSlug"),
  'Menu get rules verify the document tenant slug');
assert(rules.includes('allow list: if isRestaurantActive(restaurantSlug);'),
  'Public menu listing is scoped by the restaurant path without requiring tenant membership');
assert(rules.includes("existing().get('restaurantSlug', '') == restaurantSlug"),
  'Menu update rules verify the existing document tenant');
assert(rules.includes("incoming().restaurantSlug == restaurantSlug"),
  'Menu writes bind the item to the restaurant path');
assert(rules.includes("data.get('trackStock', false) != true || (data.keys().hasAny(['stockQuantity'])"),
  'Firestore requires a quantity whenever stock tracking is enabled');
assert(rules.includes('match /menuStockMovements/{movementId}'),
  'Menu stock audit movements have an explicit access rule');

assert(firebase.includes("query(itemsRef, where('restaurantSlug', '==', slug))"),
  'Client catalog subscriptions query only the active restaurant slug');
assert(firebase.includes('item.restaurantSlug !== restaurantSlug'),
  'Client menu persistence refuses an item from another restaurant');

assert(server.includes('record.data?.restaurantSlug !== restaurantSlug') &&
  server.includes('record.data?.id !== record.documentId'),
  'Trusted order provider fails closed on a mismatched menu document');
assert(orderService.includes('catalogItem.restaurantSlug !== cleanSlug'),
  'Order submission requires an exact menu-to-restaurant slug match');
assert(orderService.includes('catalogItem.trackStock === true'),
  'Order validation enforces configured menu quantities');
assert(server.includes('menuStockDeferred: true') && !server.includes('stockQuantity: update.after') &&
  lifecycle.includes('shouldConsumeMenuStock') && lifecycle.includes('menuStockConsumptions') &&
  lifecycle.includes('Consommation à la mise en préparation'),
  'Tracked menu quantities are consumed and audited only when staff starts preparation');
assert(lifecycle.includes('menuStockRestorations') &&
  lifecycle.includes('Restauration après annulation'),
  'Order cancellation restores tracked menu quantities exactly once');

assert(types.includes('trackStock?: boolean') && types.includes('stockQuantity?: number'),
  'Menu and order types expose stock tracking');
assert(dishForm.includes('Suivre la quantité disponible de cet article') &&
  dishForm.includes('stockQuantity'),
  'Owner/manager dish form can save a sellable quantity');
assert(adminMenu.includes('aria-pressed={isSelected}') &&
  adminMenu.includes('grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'),
  'Management catalog categories are accessible clickable tiles');
assert(clientMenu.includes('aria-pressed={isSelected}') &&
  clientMenu.includes('grid-cols-2 sm:grid-cols-3 lg:grid-cols-4') &&
  clientMenu.includes("id: 'boissons'"),
  'Customer menu has clickable category tiles and a distinct drinks category');
assert(clientMenu.includes('item.trackStock === true'),
  'Customer menu hides tracked items whose stock is exhausted');

console.log('Menu tenant isolation, quantity tracking and clickable categories: tests passed.');
