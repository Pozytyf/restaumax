import assert from 'node:assert/strict';
import { CHEZ_AWA_MENU_ITEMS, CHEZ_AWA_RESTAURANT } from './seed-catalog.mjs';
import { validateDemoSeedTarget } from './seed-chez-awa-demo.mjs';

assert.equal(CHEZ_AWA_RESTAURANT.slug, 'chez-awa');
assert.equal(CHEZ_AWA_MENU_ITEMS.length, 5);
assert.ok(CHEZ_AWA_MENU_ITEMS.every(item => item.restaurantSlug === 'chez-awa' && item.available === true));
assert.equal(validateDemoSeedTarget({
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: '(default)',
}, { project_id: 'restaumax-demo' }), undefined);
assert.throws(() => validateDemoSeedTarget({
  FIREBASE_PROJECT_ID: 'gen-lang-client-0138815290',
  FIRESTORE_DATABASE_ID: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
}, { project_id: 'gen-lang-client-0138815290' }), /seule la cible restaumax-demo/);
assert.throws(() => validateDemoSeedTarget({
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: '(default)',
}, { project_id: 'gen-lang-client-0138815290' }), /doit appartenir à restaumax-demo/);
console.log('Chez Awa Preview seed tests: OK (5 items, immutable Demo target, Production rejected).');
