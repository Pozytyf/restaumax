import assert from 'node:assert/strict';
import fs from 'node:fs';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(rules.includes('function isBoundRestaurantOwner') && rules.includes('/private/ownership'), 'owner UID is bound to private restaurant ownership metadata');
assert(rules.includes("match /private/{privateDoc}") && rules.includes('allow read, write: if false;'), 'private owner metadata cannot be read or written by client SDK');
assert(!rules.includes("role == 'staff'"), 'legacy staff role must not be accepted');
assert(rules.includes("'payments.refund'"), 'refund permission ceiling must be represented in Firestore rules');
assert(rules.includes('match /menuCustomizationRecipes/{recipeId}'), 'customization stock recipes have an explicit Firestore rule');
assert(rules.includes("resource.data.get('restaurantSlug', '') == restaurantSlug"), 'menu reads and deletes must verify the tenant slug stored in each document');
assert(rules.includes("existing().get('restaurantSlug', '') == restaurantSlug"), 'menu updates must verify the previous document tenant');
assert(rules.includes("incoming().restaurantSlug == restaurantSlug"), 'menu writes must bind the item to the restaurant path');
assert(rules.includes("match /menuStockMovements/{movementId}"), 'sellable menu stock movements have an explicit tenant-scoped audit rule');
assert(rules.includes("data.stockQuantity is int && data.stockQuantity >= 0"), 'menu stock quantities must be non-negative integers');
assert(rules.includes("data.get('trackStock', false) != true || (data.keys().hasAny(['stockQuantity'])"), 'stock tracking requires a persisted quantity');
assert(rules.includes("hasRestaurantPermission(restaurantSlug, 'inventory.view')") &&
  rules.includes("hasRestaurantPermission(restaurantSlug, 'inventory.manage')"), 'only inventory-authorized restaurant staff can read customization recipes');
assert(rules.includes('allow create, update: if false;'), 'customization recipes can only be written through the trusted server API');
console.log('Firestore owner and role rule checks passed');
