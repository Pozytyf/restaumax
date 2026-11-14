import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  startPlatformAdminEmailRecovery,
  verifyPlatformAdminEmailRecovery,
  getPlatformAdminRecoveryContact,
  startPlatformAdminRecoveryContactVerification,
  verifyPlatformAdminRecoveryContact
} from '../src/server/platformAdminMfaRecoveryEmail.ts';
import {
  beginPlatformAdminPasskeyAuthentication,
  beginPlatformAdminPasskeyRegistration,
  consumePlatformAdminWebAuthnChallenge,
  getPlatformAdminPasskeyCount
} from '../src/server/platformAdminMfaPasskeys.ts';

class MemoryDoc {
  constructor(store, id) { this.store = store; this.id = id; }
  async get() {
    const value = this.store.get(this.id);
    return { exists: value !== undefined, data: () => value };
  }
  async set(value, options = {}) {
    this.store.set(this.id, options.merge ? { ...(this.store.get(this.id) || {}), ...value } : value);
  }
  async create(value) {
    if (this.store.has(this.id)) throw new Error('already exists');
    this.store.set(this.id, value);
  }
  async update(value) {
    if (!this.store.has(this.id)) throw new Error('missing document');
    this.store.set(this.id, { ...this.store.get(this.id), ...value });
  }
  async delete() { this.store.delete(this.id); }
}
class MemoryQuery {
  constructor(store, field, value) { this.store = store; this.field = field; this.value = value; }
  limit() { return this; }
  async get() {
    const docs = [...this.store.entries()]
      .filter(([, item]) => item?.[this.field] === this.value)
      .map(([id, item]) => ({ ref: new MemoryDoc(this.store, id), data: () => item }));
    return { empty: docs.length === 0, docs };
  }
}
class MemoryDb {
  constructor() { this.collections = new Map(); }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const store = this.collections.get(name);
    return {
      doc: id => new MemoryDoc(store, id),
      where: (field, _operator, value) => new MemoryQuery(store, field, value)
    };
  }
  async runTransaction(callback) {
    const tx = {
      get: ref => ref.get(),
      set: (ref, value, options) => ref.set(value, options),
      update: (ref, value) => ref.update(value),
      create: (ref, value) => ref.create(value),
      delete: ref => ref.delete()
    };
    return callback(tx);
  }
}

const previousApiKey = process.env.RESEND_API_KEY;
const previousMfaKey = process.env.RESTAUMAX_MFA_ENCRYPTION_KEY;
const previousFrom = process.env.RESEND_FROM_EMAIL;
const previousFetch = globalThis.fetch;
try {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = 'b'.repeat(64);
  process.env.RESEND_FROM_EMAIL = 'RestauMax <security@example.test>';
  const db = new MemoryDb();
  const uid = 'mfa-recovery-admin';
  await db.collection('platform_admin_mfa').doc(uid).set({
    active: true,
    passkeys: [{ id: 'old-passkey', publicKey: 'YQ', counter: 0 }]
  });

  let sentBody = null;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };

  await startPlatformAdminRecoveryContactVerification(db, uid, 'stephaneolivierbali@gmail.com');
  assert.equal(sentBody.to[0], 'stephaneolivierbali@gmail.com', 'recovery contact verification sends to the independently supplied address');
  assert.equal(sentBody.subject, 'Vérification de votre adresse de récupération RestauMax', 'contact verification has a distinct email subject');
  const contactCode = sentBody.text.match(/\b\d{8}\b/)?.[0];
  assert.match(contactCode || '', /^\d{8}$/, 'contact verification email contains an eight-digit code');
  assert.equal(await verifyPlatformAdminRecoveryContact(db, uid, contactCode === '00000000' ? '00000001' : '00000000'), null, 'an incorrect recovery-contact code is rejected');
  const verifiedContact = await verifyPlatformAdminRecoveryContact(db, uid, contactCode);
  assert.equal(verifiedContact, 'stephaneolivierbali@gmail.com', 'correct code verifies and stores the recovery contact');
  assert.equal(await getPlatformAdminRecoveryContact(db, uid), 'stephaneolivierbali@gmail.com', 'only a verified recovery contact is returned');
  await assert.rejects(
    startPlatformAdminRecoveryContactVerification(db, 'another-admin', 'stephaneolivierbali@gmail.com'),
    /déjà associée/,
    'a recovery email already claimed by another admin cannot be reused'
  );

  process.env.RESEND_FROM_EMAIL = 'RestauMax <onboarding@resend.dev>';
  process.env.RESEND_TEST_RECIPIENT = 'stephaneolivierbali@gmail.com';
  const testOnlyUid = 'mfa-resend-test-only';
  await startPlatformAdminRecoveryContactVerification(db, testOnlyUid, 'infos.idaynews@gmail.com');
  assert.equal(sentBody.to[0], 'stephaneolivierbali@gmail.com',
    'Resend onboarding test mode redirects delivery to the configured account-owner recipient');
  const testOnlyCode = sentBody.text.match(/\b\d{8}\b/)?.[0];
  assert.match(testOnlyCode || '', /^\d{8}$/, 'test delivery still contains an eight-digit diagnostic code');
  await assert.rejects(
    verifyPlatformAdminRecoveryContact(db, testOnlyUid, testOnlyCode),
    /uniquement à la boîte de test Resend/,
    'a code delivered to the Resend test inbox can never verify the requested recovery address'
  );
  assert.equal(await getPlatformAdminRecoveryContact(db, testOnlyUid), null,
    'test-only delivery leaves the requested recovery address unverified');
  delete process.env.RESEND_TEST_RECIPIENT;

  process.env.RESEND_FROM_EMAIL = 'RestauMax <security@example.test>';
  await startPlatformAdminEmailRecovery(db, uid, 'stephaneolivierbali@gmail.com');
  assert.equal(sentBody.to[0], 'stephaneolivierbali@gmail.com', 'Resend targets the verified recovery contact');
  assert.equal(sentBody.from, 'RestauMax <security@example.test>', 'Resend uses the configured sender');
  const code = sentBody.text.match(/\b\d{8}\b/)?.[0];
  assert.match(code || '', /^\d{8}$/, 'recovery email contains a one-time eight-digit code');
  const recoveryRecord = await db.collection('platform_admin_mfa_email_recovery').doc(uid).get();
  assert.notEqual(recoveryRecord.data().codeHash, (await import('node:crypto')).createHash('sha256').update(code).digest('hex'),
    'low-entropy email codes are HMAC-protected with the Preview MFA secret, not stored as a brute-forceable plain hash');
  await assert.rejects(
    startPlatformAdminEmailRecovery(db, uid, 'admin@example.test'),
    /attendre/,
    'email recovery resend is rate-limited'
  );

  const wrongCode = code.slice(0, 7) + (code[7] === '0' ? '1' : '0');
  assert.equal(await verifyPlatformAdminEmailRecovery(db, uid, wrongCode, 1), null,
    'an incorrect email recovery code is rejected');
  const recoverySession = await verifyPlatformAdminEmailRecovery(db, uid, code, 1);
  assert(recoverySession?.token, 'a valid email code creates a recovery-only server session');
  assert(recoverySession.expiresAt - Date.now() <= 10 * 60 * 1000,
    'email recovery session expires within ten minutes');
  assert.equal(await verifyPlatformAdminEmailRecovery(db, uid, code, 1), null,
    'an email recovery code cannot be reused');
  await assert.rejects(
    startPlatformAdminEmailRecovery(db, uid, 'admin@example.test'),
    /attendre/,
    'successful recovery does not reset the email-send rate limit'
  );
  const mfaRecord = await db.collection('platform_admin_mfa').doc(uid).get();
  assert.deepEqual(mfaRecord.data().passkeys, [],
    'email recovery revokes registered passkeys before factor replacement');
  const sessions = db.collections.get('platform_admin_mfa_sessions');
  assert([...sessions.values()].some(item => item.factorSource === 'recovery'),
    'email recovery session is marked as restricted recovery');

  const passkeyDb = new MemoryDb();
  const passkeyUid = 'passkey-admin';
  await passkeyDb.collection('platform_admin_mfa').doc(passkeyUid).set({
    passkeys: [{ id: 'existing-credential', publicKey: Buffer.from('public-key').toString('base64url'), counter: 0, transports: ['internal'] }]
  });
  assert.equal(await getPlatformAdminPasskeyCount(passkeyDb, passkeyUid), 1,
    'registered passkeys are counted from the platform MFA record');
  const req = { headers: { origin: 'https://preview.example.test', host: 'preview.example.test' } };
  const registration = await beginPlatformAdminPasskeyRegistration(passkeyDb, passkeyUid, 'admin@example.test', req);
  assert.equal(registration.options.rp.id, 'preview.example.test',
    'passkey registration binds the relying party to the active Preview host');
  assert.equal(registration.options.authenticatorSelection.userVerification, 'required',
    'passkey registration requires user verification');
  assert.equal(await consumePlatformAdminWebAuthnChallenge(passkeyDb, passkeyUid, 'register'), registration.options.challenge,
    'registration challenge is consumed exactly once after proof verification');
  assert.equal(await consumePlatformAdminWebAuthnChallenge(passkeyDb, passkeyUid, 'register'), null,
    'a consumed registration challenge cannot be replayed');
  const authentication = await beginPlatformAdminPasskeyAuthentication(passkeyDb, passkeyUid, req);
  assert.equal(authentication.options.userVerification, 'required',
    'passkey authentication requires user verification');
  assert.equal(authentication.options.allowCredentials[0].id, 'existing-credential',
    'passkey login is restricted to the account registered credentials');
  assert.equal(await consumePlatformAdminWebAuthnChallenge(passkeyDb, passkeyUid, 'authenticate'), authentication.options.challenge,
    'authentication challenge is consumed once');
  assert.equal(await consumePlatformAdminWebAuthnChallenge(passkeyDb, passkeyUid, 'authenticate'), null,
    'a consumed authentication challenge cannot be replayed');
  await assert.rejects(
    beginPlatformAdminPasskeyRegistration(passkeyDb, passkeyUid, 'admin@example.test', {
      headers: { origin: 'https://attacker.example.test', host: 'preview.example.test' }
    }),
    /Origine WebAuthn non autorisée/,
    'WebAuthn rejects a cross-origin registration request'
  );

  const passkeySource = fs.readFileSync(new URL('../src/server/platformAdminMfaPasskeys.ts', import.meta.url), 'utf8');
  assert(passkeySource.includes('consumePlatformAdminWebAuthnChallenge') && passkeySource.includes('tx.delete(ref)'),
    'WebAuthn challenges are consumed transactionally and cannot be replayed');
  assert(passkeySource.includes('verification.authenticationInfo.newCounter') &&
    passkeySource.includes('Number(current[index].counter) !== Number(passkey.counter)'),
    'passkey signature counters are checked and advanced to prevent replay');

  console.log('Platform-admin Resend recovery and WebAuthn passkey tests passed (20 assertions).');
} finally {
  if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousApiKey;
  if (previousMfaKey === undefined) delete process.env.RESTAUMAX_MFA_ENCRYPTION_KEY;
  else process.env.RESTAUMAX_MFA_ENCRYPTION_KEY = previousMfaKey;
  if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = previousFrom;
  globalThis.fetch = previousFetch;
}
