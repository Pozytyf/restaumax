import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebase = readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const productionConfig = JSON.parse(readFileSync(new URL('../firebase.production.json', import.meta.url), 'utf8'));
const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

assert(firebase.includes("storageBucket: viteEnv?.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket"),
  'Firebase Storage bucket must resolve from the selected environment before falling back to committed config');
assert(firebase.includes('viteEnv?.VITE_FIREBASE_STORAGE_BUCKET,'),
  'Preview must fail closed when its dedicated Storage bucket is not configured');
assert.equal(typeof config.storageBucket, 'string');
assert(config.storageBucket.length > 0, 'Production Firebase config must declare its Storage bucket');
assert(firebase.includes("from 'firebase/storage'") && firebase.includes('export const storage = getStorage(app)'),
  'Firebase Storage SDK must be initialized from the selected Firebase app');
assert(firebase.includes('uploadRestaurantImage') && firebase.includes('uploadBytes') && firebase.includes('getDownloadURL'),
  'Restaurant images must upload to Firebase Storage and return their hosted URL');
assert(firebaseJson.storage?.rules === 'storage.rules' && firebaseJson.emulators?.storage?.port === 9199,
  'The default Firebase project must declare Storage rules and its emulator');
assert(productionConfig.storage?.rules === 'storage.rules',
  'Production Firebase config must deploy the reviewed Storage rules');
assert(rules.includes("request.auth.token.restaurantSlug == restaurantSlug") &&
  rules.includes("hasManagerPermission('menu.manage')") &&
  rules.includes("request.resource.size <= 5242880") &&
  rules.includes("request.resource.contentType.matches('image/(jpeg|png|webp)')"),
  'Storage uploads are tenant-bound, permission-gated, size-limited and image-only');
console.log('Firebase Storage config and upload pipeline checks passed.');
