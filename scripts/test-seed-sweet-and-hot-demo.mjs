import assert from 'node:assert/strict';
import {
  SWEET_AND_HOT_DEMO_MENU_ITEMS,
  validateTarget,
} from './seed-sweet-and-hot-demo.mjs';

assert.equal(SWEET_AND_HOT_DEMO_MENU_ITEMS.length, 29);
assert.equal(new Set(SWEET_AND_HOT_DEMO_MENU_ITEMS.map((item) => item.id)).size, 29);
assert.deepEqual(
  SWEET_AND_HOT_DEMO_MENU_ITEMS.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {}),
  { plats: 12, grillades: 16, accompagnements: 1 },
);
for (const entry of SWEET_AND_HOT_DEMO_MENU_ITEMS) {
  assert.equal(entry.restaurantSlug, 'restaumax-demo');
  assert.ok(Number.isInteger(entry.price) && entry.price > 0);
  assert.ok(['plats', 'grillades', 'accompagnements'].includes(entry.category));
  if (entry.optionGroups) {
    const options = entry.optionGroups[0].options;
    assert.equal(options.filter((option) => option.isDefault).length, 1);
    assert.ok(options.every((option) => Number.isInteger(option.extraPrice) && option.extraPrice >= 0));
  }
}
assert.equal(validateTarget({
  projectId: 'restaumax-demo',
  firestoreDatabaseId: '(default)',
}, {
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: '(default)',
}), true);
assert.throws(() => validateTarget({
  projectId: 'gen-lang-client-0138815290',
  firestoreDatabaseId: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
}, {
  FIREBASE_PROJECT_ID: 'gen-lang-client-0138815290',
  FIRESTORE_DATABASE_ID: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
}), /Cible Firebase incorrecte/);
assert.throws(() => validateTarget({
  projectId: 'restaumax-demo',
  firestoreDatabaseId: '(default)',
}, {
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
}), /Définis explicitement/);
console.log('Sweet and Hot seed tests: OK (29 items, target guard, price formats).');
