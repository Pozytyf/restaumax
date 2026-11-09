import { strict as assert } from 'node:assert';
import { sanitizePublicMenuItem } from '../src/server/publicMenu.ts';
import { getRestauMaxRequestQueryParam } from '../src/server/apiRouteMap.ts';

const privateRecord = {
  id: 'dish-1', restaurantSlug: 'chez-awa', name: 'Capitaine', category: 'grillades',
  price: 14500, available: true, description: 'Poisson braisé', imageUrl: 'https://example.test/dish.jpg',
  prepTimeMinutes: 20, trackStock: true, stockQuantity: 8, lowStockThreshold: 3,
  unitCost: 5000, supplierName: 'Fournisseur secret', recipeCost: 6500, internalMargin: 8000,
  tags: ['Signature'], allergens: ['poisson'], spiceLevel: 2, pairings: ['attiéké'],
  optionGroups: [{
    id: 'side', name: 'Accompagnement', required: true, internalCost: 300,
    options: [{ id: 'alloco', name: 'Alloco', extraPrice: 500, supplierCost: 150, margin: 350 }]
  }],
  availableExtras: [{ id: 'sauce', name: 'Sauce', price: 300, costPrice: 50 }],
  translations: { en: { name: 'Captain', description: 'Grilled fish', internalNote: 'private' } }
};
const publicItem = sanitizePublicMenuItem(privateRecord);
assert.ok(publicItem, 'available menu item should be returned');
for (const key of ['trackStock','stockQuantity','lowStockThreshold','unitCost','supplierName','recipeCost','internalMargin']) {
  assert.equal(Object.hasOwn(publicItem, key), false, key + ' must not be exposed');
}
assert.deepEqual(publicItem.optionGroups[0].options[0], {
  id: 'alloco', name: 'Alloco', extraPrice: 500
});
assert.deepEqual(publicItem.availableExtras[0], { id: 'sauce', name: 'Sauce', price: 300 });
assert.deepEqual(publicItem.translations.en, { name: 'Captain', description: 'Grilled fish' });
assert.equal(sanitizePublicMenuItem({ ...privateRecord, available: false }), null);
assert.equal(sanitizePublicMenuItem({ ...privateRecord, stockQuantity: 0 }), null);
assert.equal(sanitizePublicMenuItem({ ...privateRecord, price: 1.5 }), null);
assert.equal(sanitizePublicMenuItem({ ...privateRecord, category: 'internal' }), null);
assert.equal(getRestauMaxRequestQueryParam({ url: '/api/index?__restaumax_route=public-menu&restaurantSlug=chez-awa' }, 'restaurantSlug'), 'chez-awa');
assert.equal(getRestauMaxRequestQueryParam({ query: { restaurantSlug: 'chez-awa' } }, 'restaurantSlug'), 'chez-awa');
assert.equal(getRestauMaxRequestQueryParam({ url: '/api/index?restaurantSlug=other' }, 'restaurantSlug'), 'other');
console.log('Public menu privacy tests: 12 assertions passed.');
