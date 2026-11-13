import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual
} from 'node:crypto';

const MFA_COLLECTION = 'platform_admin_mfa';
const SESSION_COLLECTION = 'platform_admin_mfa_sessions';
const ATTEMPT_COLLECTION = 'platform_admin_mfa_attempts';
const STEP_SECONDS = 30;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey(): Buffer {
  const value = String(process.env.RESTAUMAX_MFA_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('La clé de chiffrement MFA doit contenir exactement 32 octets hexadécimaux.');
  }
  return Buffer.from(value, 'hex');
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) result += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return result;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('Secret TOTP invalide.');
  let bits = '';
  for (const char of normalized) bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret: string, timeMs = Date.now()): { code: string; step: number } {
  const step = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return { code: String(binary % 1_000_000).padStart(6, '0'), step };
}

export function verifyTotp(secret: string, code: string, now = Date.now(), lastAcceptedStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  const supplied = Buffer.from(code);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= lastAcceptedStep || step < 0) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    const expected = Buffer.from(String(binary % 1_000_000).padStart(6, '0'));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

export function encryptTotpSecret(secret: string): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

export function decryptTotpSecret(payload: { iv: string; tag: string; ciphertext: string }): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function buildTotpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`RestauMax:${email}`);
  const issuer = encodeURIComponent('RestauMax');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function hashMfaToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function consumeAttempt(db: any, uid: string): Promise<boolean> {
  const ref = db.collection(ATTEMPT_COLLECTION).doc(uid);
  const now = Date.now();
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const record = snap.exists ? snap.data() || {} : {};
    const startedAt = Number(record.startedAt || 0);
    const count = startedAt > now - ATTEMPT_WINDOW_MS ? Number(record.count || 0) : 0;
    if (count >= MAX_ATTEMPTS) return false;
    tx.set(ref, { startedAt: count ? startedAt : now, count: count + 1, updatedAt: now });
    return true;
  });
}

export async function getPlatformAdminMfaStatus(db: any, uid: string) {
  const snap = await db.collection(MFA_COLLECTION).doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    enrolled: data.active === true,
    pending: Number(data.pendingExpiresAt || 0) > Date.now(),
    recoveryCodesRemaining: Array.isArray(data.recoveryCodeHashes) ? data.recoveryCodeHashes.length : 0
  };
}

export async function beginPlatformAdminMfaEnrollment(db: any, uid: string, email: string, allowReplace = false) {
  const secret = generateTotpSecret();
  const now = Date.now();
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : {};
    if (current.active === true && !allowReplace) throw new Error('Un facteur MFA est déjà enrôlé pour ce compte.');
    tx.set(ref, {
      active: false,
      pendingSecret: encryptTotpSecret(secret),
      pendingExpiresAt: now + ENROLLMENT_TTL_MS,
      updatedAt: now
    }, { merge: true });
  });
  return { secret, otpauthUri: buildTotpUri(secret, email), expiresAt: now + ENROLLMENT_TTL_MS };
}

export async function confirmPlatformAdminMfaEnrollment(db: any, uid: string, code: string, now = Date.now()): Promise<string[] | null> {
  if (!await consumeAttempt(db, uid)) return null;
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  const recoveryCodes = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const record = snap.exists ? snap.data() || {} : {};
    if (!record.pendingSecret || Number(record.pendingExpiresAt || 0) <= now) return null;
    const secret = decryptTotpSecret(record.pendingSecret);
    const step = verifyTotp(secret, code, now, -1);
    if (step === null) return null;
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    tx.set(ref, {
      active: true,
      secret: record.pendingSecret,
      pendingSecret: null,
      pendingExpiresAt: null,
      lastAcceptedStep: step,
      recoveryCodeHashes: recoveryCodes.map(hashMfaToken),
      enrolledAt: now,
      updatedAt: now
    }, { merge: true });
    return recoveryCodes;
  });
  if (recoveryCodes) await db.collection(ATTEMPT_COLLECTION).doc(uid).delete().catch(() => undefined);
  return recoveryCodes;
}

export async function createPlatformAdminMfaSession(db: any, uid: string, sessionVersion: number) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.collection(SESSION_COLLECTION).doc(hashMfaToken(token)).create({
    uid, sessionVersion, createdAt: now, expiresAt, revokedAt: null, factorSource: 'firebase'
  });
  return { token, expiresAt };
}

export async function verifyPlatformAdminMfaAndCreateSession(db: any, uid: string, code: string, sessionVersion: number) {
  if (!await consumeAttempt(db, uid)) return null;
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashMfaToken(token);
  const sessionRef = db.collection(SESSION_COLLECTION).doc(tokenHash);
  const now = Date.now();
  let recoveryUsed = false;
  const accepted = await db.runTransaction(async (tx: any) => {
    recoveryUsed = false;
    const snap = await tx.get(ref);
    const record = snap.exists ? snap.data() || {} : {};
    if (record.active !== true || !record.secret) return false;
    const secret = decryptTotpSecret(record.secret);
    const step = verifyTotp(secret, code, now, Number(record.lastAcceptedStep ?? -1));
    let update: Record<string, unknown>;
    if (step !== null) {
      update = { lastAcceptedStep: step, lastVerifiedAt: now, updatedAt: now };
    } else {
      const normalizedRecoveryCode = String(code || '').replace(/-/g, '').toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(normalizedRecoveryCode)) return false;
      const recoveryHash = hashMfaToken(normalizedRecoveryCode);
      const hashes = Array.isArray(record.recoveryCodeHashes) ? record.recoveryCodeHashes : [];
      const index = hashes.indexOf(recoveryHash);
      if (index < 0) return false;
      recoveryUsed = true;
      update = {
        recoveryCodeHashes: hashes.filter((_: string, i: number) => i !== index),
        lastRecoveryAt: now,
        updatedAt: now
      };
    }
    tx.update(ref, update);
    tx.create(sessionRef, { uid, sessionVersion, createdAt: now, expiresAt: now + SESSION_TTL_MS, revokedAt: null, factorSource: recoveryUsed ? 'recovery' : 'totp' });
    return true;
  });
  if (!accepted) return null;
  await db.collection(ATTEMPT_COLLECTION).doc(uid).delete().catch(() => undefined);
  return { token, expiresAt: now + SESSION_TTL_MS, recoveryUsed };
}

export async function regeneratePlatformAdminRecoveryCodes(db: any, uid: string, code: string, now = Date.now()): Promise<string[] | null> {
  if (!await consumeAttempt(db, uid)) return null;
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  const recoveryCodes = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const record = snap.exists ? snap.data() || {} : {};
    if (record.active !== true || !record.secret) return null;
    const secret = decryptTotpSecret(record.secret);
    const step = verifyTotp(secret, code, now, Number(record.lastAcceptedStep ?? -1));
    if (step === null) return null;
    const nextCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    tx.update(ref, {
      lastAcceptedStep: step,
      recoveryCodeHashes: nextCodes.map(hashMfaToken),
      recoveryCodesRegeneratedAt: now,
      updatedAt: now
    });
    return nextCodes;
  });
  if (recoveryCodes) await db.collection(ATTEMPT_COLLECTION).doc(uid).delete().catch(() => undefined);
  return recoveryCodes;
}

export async function getPlatformAdminMfaSessionDetails(db: any, uid: string, sessionVersion: number, token: string) {
  if (!token || token.length > 128) return null;
  const snap = await db.collection(SESSION_COLLECTION).doc(hashMfaToken(token)).get();
  if (!snap.exists) return null;
  const session = snap.data() || {};
  if (session.uid !== uid || session.revokedAt != null || Number(session.sessionVersion) !== Number(sessionVersion) || Number(session.expiresAt || 0) <= Date.now()) return null;
  return { factorSource: String(session.factorSource || 'totp'), expiresAt: Number(session.expiresAt || 0) };
}

export async function hasValidPlatformAdminMfaSession(db: any, uid: string, sessionVersion: number, token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const ref = db.collection(SESSION_COLLECTION).doc(hashMfaToken(token));
  const snap = await ref.get();
  if (!snap.exists) return false;
  const session = snap.data() || {};
  return session.uid === uid && session.revokedAt == null &&
    Number(session.sessionVersion) === Number(sessionVersion) &&
    Number(session.expiresAt || 0) > Date.now();
}

export async function revokePlatformAdminMfaSessions(db: any, uid: string): Promise<void> {
  const snap = await db.collection(SESSION_COLLECTION).where('uid', '==', uid).limit(500).get();
  if (snap.empty) return;
  const batch = db.batch();
  const now = Date.now();
  for (const doc of snap.docs) batch.update(doc.ref, { revokedAt: now });
  await batch.commit();
}

export const PLATFORM_ADMIN_MFA_SESSION_TTL_MS = SESSION_TTL_MS;
