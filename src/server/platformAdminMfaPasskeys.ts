import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { createPlatformAdminMfaSession } from './platformAdminMfa.js';

const MFA_COLLECTION = 'platform_admin_mfa';
const CHALLENGE_COLLECTION = 'platform_admin_mfa_webauthn_challenges';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type StoredPasskey = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  name?: string;
  createdAt: number;
  lastUsedAt?: number;
};

function requestWebAuthnContext(req: any): { origin: string; rpID: string } {
  const origin = String(req.headers?.origin || '').trim();
  const forwardedHost = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = (forwardedHost || String(req.headers?.host || '')).split(',')[0].trim();
  if (!origin || !host) throw new Error('Origine WebAuthn indisponible.');
  const parsed = new URL(origin);
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.host.toLowerCase() !== host.toLowerCase() || (parsed.protocol !== 'https:' && !isLocal)) {
    throw new Error('Origine WebAuthn non autorisée.');
  }
  const configuredOrigin = String(process.env.APP_ORIGIN || '').trim();
  if (configuredOrigin && configuredOrigin !== origin) {
    throw new Error('Cette origine ne correspond pas à APP_ORIGIN.');
  }
  return { origin, rpID: parsed.hostname };
}

async function storeChallenge(db: any, uid: string, purpose: 'register' | 'authenticate', challenge: string) {
  const now = Date.now();
  await db.collection(CHALLENGE_COLLECTION).doc(uid).set({
    purpose, challenge, createdAt: now, expiresAt: now + CHALLENGE_TTL_MS
  });
}

export async function consumePlatformAdminWebAuthnChallenge(db: any, uid: string, purpose: 'register' | 'authenticate'): Promise<string | null> {
  const ref = db.collection(CHALLENGE_COLLECTION).doc(uid);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const record = snap.data() || {};
    if (record.purpose !== purpose || Number(record.expiresAt || 0) <= Date.now() ||
        typeof record.challenge !== 'string' || !record.challenge) {
      tx.delete(ref);
      return null;
    }
    tx.delete(ref);
    return record.challenge as string;
  });
}

async function getStoredPasskeys(db: any, uid: string): Promise<StoredPasskey[]> {
  const snap = await db.collection(MFA_COLLECTION).doc(uid).get();
  const value = snap.exists ? snap.data()?.passkeys : [];
  return Array.isArray(value) ? value.filter((item: any) =>
    item && typeof item.id === 'string' && typeof item.publicKey === 'string' &&
    Number.isFinite(Number(item.counter))
  ) as StoredPasskey[] : [];
}

export async function getPlatformAdminPasskeyCount(db: any, uid: string): Promise<number> {
  return (await getStoredPasskeys(db, uid)).length;
}

export async function beginPlatformAdminPasskeyRegistration(db: any, uid: string, email: string, req: any) {
  const { origin, rpID } = requestWebAuthnContext(req);
  const existing = await getStoredPasskeys(db, uid);
  const options = await generateRegistrationOptions({
    rpName: 'RestauMax',
    rpID,
    userID: Buffer.from(uid, 'utf8'),
    userName: email || uid,
    userDisplayName: email || 'Administrateur RestauMax',
    attestationType: 'none',
    excludeCredentials: existing.map((credential) => ({
      id: credential.id,
      transports: credential.transports as any
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required'
    },
    timeout: 60_000
  });
  await storeChallenge(db, uid, 'register', options.challenge);
  return { options, origin };
}

export async function finishPlatformAdminPasskeyRegistration(
  db: any, uid: string, response: RegistrationResponseJSON, req: any, name?: string
) {
  const { origin, rpID } = requestWebAuthnContext(req);
  const expectedChallenge = await consumePlatformAdminWebAuthnChallenge(db, uid, 'register');
  if (!expectedChallenge) return false;
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) return false;
  const info = verification.registrationInfo;
  const credential = info.credential;
  const passkey: StoredPasskey = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: String(name || 'Passkey').trim().slice(0, 48) || 'Passkey',
    createdAt: Date.now()
  };
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const current: StoredPasskey[] = Array.isArray(data.passkeys) ? data.passkeys : [];
    if (current.some((item) => item.id === passkey.id)) return;
    tx.set(ref, { passkeys: [...current, passkey], updatedAt: Date.now() }, { merge: true });
  });
  return true;
}

export async function beginPlatformAdminPasskeyAuthentication(db: any, uid: string, req: any) {
  const { origin, rpID } = requestWebAuthnContext(req);
  const passkeys = await getStoredPasskeys(db, uid);
  if (!passkeys.length) throw new Error('Aucune passkey n’est enregistrée pour ce compte.');
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((credential) => ({
      id: credential.id,
      transports: credential.transports as any
    })),
    userVerification: 'required',
    timeout: 60_000
  });
  await storeChallenge(db, uid, 'authenticate', options.challenge);
  return { options, origin };
}

export async function finishPlatformAdminPasskeyAuthentication(
  db: any, uid: string, sessionVersion: number, response: AuthenticationResponseJSON, req: any
) {
  const { origin, rpID } = requestWebAuthnContext(req);
  const expectedChallenge = await consumePlatformAdminWebAuthnChallenge(db, uid, 'authenticate');
  if (!expectedChallenge) return null;
  const passkeys = await getStoredPasskeys(db, uid);
  const passkey = passkeys.find((item) => item.id === response.id);
  if (!passkey) return null;
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.id,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: Number(passkey.counter),
      transports: passkey.transports as any
    },
    requireUserVerification: true
  });
  if (!verification.verified) return null;
  const now = Date.now();
  const ref = db.collection(MFA_COLLECTION).doc(uid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Passkey inconnue.');
    const data = snap.data() || {};
    const current: StoredPasskey[] = Array.isArray(data.passkeys) ? data.passkeys : [];
    const index = current.findIndex((item) => item.id === passkey.id);
    if (index < 0 || Number(current[index].counter) !== Number(passkey.counter)) {
      throw new Error('Passkey modifiée pendant la vérification.');
    }
    const updated = [...current];
    updated[index] = {
      ...updated[index],
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: now
    };
    tx.update(ref, { passkeys: updated, updatedAt: now });
  });
  return createPlatformAdminMfaSession(db, uid, sessionVersion, 'passkey');
}
