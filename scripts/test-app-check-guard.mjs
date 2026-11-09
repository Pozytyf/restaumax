import assert from 'node:assert/strict';
import { verifyPublicOrderAppCheck } from '../src/server/appCheckGuard.ts';

const prodNotConfigured = await verifyPublicOrderAppCheck({
  isProduction: true, enforcementEnabled: false, token: '', verifier: null
});
assert.equal(prodNotConfigured.allowed, false);
assert.equal(prodNotConfigured.statusCode, 503);
assert.equal(prodNotConfigured.reason, 'not-configured');

const previewWithoutEnforcement = await verifyPublicOrderAppCheck({
  isProduction: false, enforcementEnabled: false, token: '', verifier: null
});
assert.equal(previewWithoutEnforcement.allowed, true, 'controlled Preview stays usable before enforcement');

const missingToken = await verifyPublicOrderAppCheck({
  isProduction: true, enforcementEnabled: true, token: '', verifier: { async verifyToken() {} }
});
assert.equal(missingToken.allowed, false);
assert.equal(missingToken.statusCode, 401);
assert.equal(missingToken.reason, 'missing-token');

const missingVerifier = await verifyPublicOrderAppCheck({
  isProduction: true, enforcementEnabled: true, token: 'valid-looking-token', verifier: null
});
assert.equal(missingVerifier.allowed, false);
assert.equal(missingVerifier.reason, 'missing-token');

let verified = '';
const accepted = await verifyPublicOrderAppCheck({
  isProduction: true, enforcementEnabled: true, token: 'real-token-value',
  verifier: { async verifyToken(value) { verified = value; return { appId: 'verified-app' }; } }
});
assert.equal(accepted.allowed, true);
assert.equal(verified, 'real-token-value', 'the server verifies the exact client App Check token');

const rejected = await verifyPublicOrderAppCheck({
  isProduction: true, enforcementEnabled: true, token: 'forged-token',
  verifier: { async verifyToken() { throw Object.assign(new Error('invalid'), { code: 'app-check/invalid-token' }); } }
});
assert.equal(rejected.allowed, false);
assert.equal(rejected.statusCode, 401);
assert.equal(rejected.reason, 'invalid-token');
assert.equal(rejected.code, 'app-check/invalid-token');

console.log('App Check enforcement guard tests passed (7 assertions).');
