import assert from 'node:assert/strict';
import {
  buildTotpUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, totpAt, verifyTotp
} from '../src/server/platformAdminMfa.ts';

const previousKey = process.env.RESTAUMAX_MFA_ENCRYPTION_KEY;
try {
  process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = 'a'.repeat(64);
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const fixedTime = 1_800_000_000_000;
  const generated = totpAt(secret, fixedTime);
  assert.equal(verifyTotp(secret, generated.code, fixedTime, -1), generated.step);
  assert.equal(verifyTotp(secret, '000000', fixedTime, generated.step), null,
    'a consumed time-step cannot be accepted again');
  assert.equal(verifyTotp(secret, 'bad', fixedTime), null,
    'malformed codes are rejected');
  assert.equal(decryptTotpSecret(encryptTotpSecret(secret)), secret,
    'AES-256-GCM encryption round-trips the TOTP seed');
  assert.match(buildTotpUri(secret, 'admin@example.test'), /^otpauth:\/\/totp\//);
  assert.throws(() => {
    process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = 'invalid';
    encryptTotpSecret(secret);
  }, /clé de chiffrement MFA/);
  console.log('Platform-admin TOTP cryptography tests passed (6 assertions).');
} finally {
  if (previousKey === undefined) delete process.env.RESTAUMAX_MFA_ENCRYPTION_KEY;
  else process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = previousKey;
}
