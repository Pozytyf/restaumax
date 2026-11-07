import assert from 'node:assert/strict';
import {
  encryptRestaurantPayDunyaCredentials,
  decryptRestaurantPayDunyaCredentials,
  saveRestaurantPayDunyaCredentials,
  loadRestaurantPayDunyaConfig
} from '../src/server/paydunyaMerchantConfig.ts';

const env = {
  PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  PAYDUNYA_LIVE_ENABLED: 'false'
};
const credentials = {
  mode: 'test',
  masterKey: 'merchant-master-key-test',
  privateKey: 'merchant-private-key-test',
  token: 'merchant-token-test'
};
const encrypted = encryptRestaurantPayDunyaCredentials(credentials, env);

// Exercise the same persistence path used by POST /api/payments. Credentials
// must survive a fresh read, remain encrypted at rest, and stay tenant-isolated.
const persisted = new Map();
const persistenceDb = {
  collection: (name) => ({
    doc: (slug) => ({
      collection: (subcollection) => ({
        doc: (id) => ({
          set: async (value, options) => {
            const key = `${name}/${slug}/${subcollection}/${id}`;
            persisted.set(key, { ...(persisted.get(key) || {}), ...structuredClone(value) });
          },
          get: async () => {
            const value = persisted.get(`${name}/${slug}/${subcollection}/${id}`);
            return { exists: Boolean(value), data: () => value };
          }
        })
      })
    })
  })
};
await saveRestaurantPayDunyaCredentials(persistenceDb, 'alpha', credentials, env);
const persistedAlpha = await loadRestaurantPayDunyaConfig(persistenceDb, 'alpha', env);
assert.equal(persistedAlpha.success, true);
if (persistedAlpha.success) assert.equal(persistedAlpha.data.privateKey, credentials.privateKey);
const persistedRecord = persisted.get('restaurants/alpha/_private/paydunya');
assert.equal(JSON.stringify(persistedRecord).includes(credentials.privateKey), false);
await saveRestaurantPayDunyaCredentials(persistenceDb, 'beta', {
  ...credentials, masterKey: 'different-merchant-master-key'
}, env);
const persistedBeta = await loadRestaurantPayDunyaConfig(persistenceDb, 'beta', env);
assert.equal(persistedBeta.success, true);
if (persistedBeta.success) assert.notEqual(persistedBeta.data.masterKey, credentials.masterKey);

assert.equal(encrypted.algorithm, 'aes-256-gcm');
assert.equal(JSON.stringify(encrypted).includes(credentials.masterKey), false);
assert.deepEqual(decryptRestaurantPayDunyaCredentials(encrypted, env), credentials);
assert.throws(() => decryptRestaurantPayDunyaCredentials(encrypted, {
  ...env,
  PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
}));

const docs = {
  alpha: { enabled: true, credentials: encrypted },
  beta: { enabled: false, credentials: encrypted }
};
const db = {
  collection: () => ({
    doc: (slug) => ({
      collection: () => ({
        doc: () => ({
          get: async () => {
            const data = docs[slug];
            return { exists: Boolean(data), data: () => data };
          }
        })
      })
    })
  })
};
const alpha = await loadRestaurantPayDunyaConfig(db, 'alpha', env);
assert.equal(alpha.success, true);
if (alpha.success) {
  assert.equal(alpha.data.mode, 'test');
  assert.equal(alpha.data.masterKey, credentials.masterKey);
  assert.match(alpha.data.createInvoiceUrl, /sandbox-api/);
}
const beta = await loadRestaurantPayDunyaConfig(db, 'beta', env);
assert.equal(beta.success, false);

// Existing live transactions must remain reconcilable after the merchant is
// disabled or new live operations are globally paused. This mode is settlement-only.
const liveCredentials = { ...credentials, mode: 'live' };
const liveEncrypted = encryptRestaurantPayDunyaCredentials(liveCredentials, env);
docs.live = { enabled: false, credentials: liveEncrypted };
const liveBlocked = await loadRestaurantPayDunyaConfig(db, 'live', env);
assert.equal(liveBlocked.success, false);
const liveSettlement = await loadRestaurantPayDunyaConfig(db, 'live', env, true);
assert.equal(liveSettlement.success, true);
if (liveSettlement.success) {
  assert.equal(liveSettlement.data.mode, 'live');
  assert.match(liveSettlement.data.createInvoiceUrl, /api\/v1/);
  assert.doesNotMatch(liveSettlement.data.createInvoiceUrl, /sandbox-api/);
}

const missing = await loadRestaurantPayDunyaConfig(db, 'gamma', env);
assert.equal(missing.success, false);
const invalidSlug = await loadRestaurantPayDunyaConfig(db, '../alpha', env);
assert.equal(invalidSlug.success, false);
console.log('PayDunya merchant encryption, persistence, isolation and settlement-only access passed.');
