import assert from 'node:assert/strict';
import fs from 'node:fs';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(rules.includes("data.ownerUid == request.auth.uid"), 'owner UID must match restaurant ownerUid');
assert(!rules.includes("role == 'staff'"), 'legacy staff role must not be accepted');
assert(rules.includes("'payments.refund'"), 'refund permission ceiling must be represented in Firestore rules');
assert(rules.includes('match /menuCustomizationRecipes/{recipeId}'), 'customization stock recipes have an explicit Firestore rule');
assert(rules.includes("hasRestaurantPermission(restaurantSlug, 'inventory.view')") &&
  rules.includes("hasRestaurantPermission(restaurantSlug, 'inventory.manage')"), 'only inventory-authorized restaurant staff can read customization recipes');
assert(rules.includes('allow create, update: if false;'), 'customization recipes can only be written through the trusted server API');
console.log('Firestore owner and role rule checks passed');
