import assert from 'node:assert/strict';
import {
  beginPlatformAdminMfaEnrollment, buildTotpUri, confirmPlatformAdminMfaEnrollment,
  decryptTotpSecret, encryptTotpSecret, generateTotpSecret, getPlatformAdminMfaSessionDetails, regeneratePlatformAdminRecoveryCodes,
  totpAt, verifyPlatformAdminMfaAndCreateSession, verifyTotp
} from '../src/server/platformAdminMfa.ts';

class MemoryDoc {
  constructor(store, id) { this.store = store; this.id = id; }
  async get() { const value = this.store.get(this.id); return { exists: value !== undefined, data: () => value }; }
  async set(value, options = {}) { this.store.set(this.id, options.merge ? { ...(this.store.get(this.id) || {}), ...value } : value); }
  async create(value) { if (this.store.has(this.id)) throw new Error('already exists'); this.store.set(this.id, value); }
  async update(value) { if (!this.store.has(this.id)) throw new Error('missing document'); this.store.set(this.id, { ...this.store.get(this.id), ...value }); }
  async delete() { this.store.delete(this.id); }
}
class MemoryDb {
  constructor() { this.collections = new Map(); }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const store = this.collections.get(name);
    return { doc: id => new MemoryDoc(store, id) };
  }
  async runTransaction(callback) {
    const tx = {
      get: ref => ref.get(),
      set: (ref, value, options) => ref.set(value, options),
      update: (ref, value) => ref.update(value),
      create: (ref, value) => ref.create(value)
    };
    return callback(tx);
  }
}

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
  const db = new MemoryDb();
  const uid = 'recovery-test-admin';
  const enrollment = await beginPlatformAdminMfaEnrollment(db, uid, 'admin@example.test');
  const enrollmentTime = Date.now();
  const enrollmentCode = totpAt(enrollment.secret, enrollmentTime).code;
  const firstRecoverySet = await confirmPlatformAdminMfaEnrollment(db, uid, enrollmentCode, enrollmentTime);
  assert.equal(firstRecoverySet?.length, 10, 'initial enrollment generates ten one-time recovery codes');
  const recoverySession = await verifyPlatformAdminMfaAndCreateSession(db, uid, firstRecoverySet[0], 1);
  assert.equal(recoverySession?.recoveryUsed, true, 'a recovery code is consumed to create a recovery-only session');
  const sessionDetails = await getPlatformAdminMfaSessionDetails(db, uid, 1, recoverySession.token);
  assert.equal(sessionDetails?.factorSource, 'recovery', 'recovery session is explicitly distinguished from TOTP sessions');
  assert.equal(await verifyPlatformAdminMfaAndCreateSession(db, uid, firstRecoverySet[0], 1), null,
    'a consumed recovery code cannot be replayed');
  const rotationTime = enrollmentTime + 30_000;
  const rotatedCodes = await regeneratePlatformAdminRecoveryCodes(db, uid, totpAt(enrollment.secret, rotationTime).code, rotationTime);
  assert.equal(rotatedCodes?.length, 10, 'a fresh TOTP proof rotates all ten recovery codes');
  assert.equal(await verifyPlatformAdminMfaAndCreateSession(db, uid, firstRecoverySet[1], 1), null,
    'rotation invalidates every previously issued recovery code');
  const replacement = await beginPlatformAdminMfaEnrollment(db, uid, 'admin@example.test', true);
  const replacementTime = Date.now();
  const replacementCodes = await confirmPlatformAdminMfaEnrollment(db, uid, totpAt(replacement.secret, replacementTime).code, replacementTime);
  assert.equal(replacementCodes?.length, 10, 'lost-factor replacement rotates all recovery codes');
  const replacedRecord = await db.collection('platform_admin_mfa').doc(uid).get();
  assert.equal(decryptTotpSecret(replacedRecord.data().secret), replacement.secret,
    'recovery enrollment replaces the previous encrypted TOTP secret');
  assert.notEqual(replacement.secret, enrollment.secret, 'replacement factor is a newly generated secret');
  assert.throws(() => {
    process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = 'invalid';
    encryptTotpSecret(secret);
  }, /clé de chiffrement MFA/);
  console.log('Platform-admin TOTP cryptography and recovery lifecycle tests passed (15 assertions).');
} finally {
  if (previousKey === undefined) delete process.env.RESTAUMAX_MFA_ENCRYPTION_KEY;
  else process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = previousKey;
}
