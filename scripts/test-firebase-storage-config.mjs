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
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
assert(rules.includes('allow read: if true') && rules.includes('allow write: if false'),
  'Storage images are public-read and all client-side writes are denied');
assert(server.includes('adminAuth.verifyIdToken(idToken, true)') &&
  server.includes('member.active !== true') &&
  server.includes('member.restaurantSlug !== restaurantSlug') &&
  server.includes('member.permissions.includes(requiredPermission)') &&
  server.includes('bytes.length > 3 * 1024 * 1024'),
  'Image writes are server-mediated, revocation-aware, tenant-bound and size-limited');
console.log('Firebase Storage config and upload pipeline checks passed.');
