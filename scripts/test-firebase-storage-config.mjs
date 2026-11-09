import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebase = readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));

assert(firebase.includes("storageBucket: viteEnv?.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket"),
  'Firebase Storage bucket must resolve from the selected environment before falling back to committed config');
assert(firebase.includes('viteEnv?.VITE_FIREBASE_STORAGE_BUCKET,'),
  'Preview must fail closed when its dedicated Storage bucket is not configured');
assert.equal(typeof config.storageBucket, 'string');
assert(config.storageBucket.length > 0, 'Production Firebase config must declare its Storage bucket');
console.log('Firebase Storage bucket isolation checks passed.');
