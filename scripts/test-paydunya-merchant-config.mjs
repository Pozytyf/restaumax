import assert from 'node:assert/strict';
import {
  encryptRestaurantPayDunyaCredentials,
  decryptRestaurantPayDunyaCredentials,
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
const missing = await loadRestaurantPayDunyaConfig(db, 'gamma', env);
assert.equal(missing.success, false);
const invalidSlug = await loadRestaurantPayDunyaConfig(db, '../alpha', env);
assert.equal(invalidSlug.success, false);
console.log('PayDunya merchant isolation: 12 assertions passed.');
