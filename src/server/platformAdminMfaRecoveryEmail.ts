import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  createPlatformAdminMfaSession,
  revokePlatformAdminMfaSessions
} from './platformAdminMfa.js';

const RECOVERY_COLLECTION = 'platform_admin_mfa_email_recovery';
const RECOVERY_CONTACT_COLLECTION = 'platform_admin_mfa_recovery_contacts';
const RECOVERY_CONTACT_VERIFICATION_COLLECTION = 'platform_admin_mfa_recovery_contact_verifications';
const RECOVERY_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;

function hashRecoveryCode(code: string): string {
  const pepper = String(process.env.RESTAUMAX_MFA_ENCRYPTION_KEY || '').trim();
  if (!pepper) throw new Error('La clé de sécurité MFA n’est pas configurée sur cet environnement.');
  return createHmac('sha256', pepper).update(code).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendWithResend(email: string, code: string, purpose: 'recovery' | 'contact' = 'recovery'): Promise<void> {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!apiKey || !from) throw new Error('La récupération par e-mail n’est pas configurée sur cet environnement.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: purpose === 'contact' ? 'Vérification de votre adresse de récupération RestauMax' : 'Code de récupération MFA RestauMax',
      text: purpose === 'contact'
        ? 'Votre code de vérification RestauMax est ' + code + '. Il expire dans 10 minutes. Si vous n’avez pas demandé cette vérification, ignorez ce message.'
        : 'Votre code de récupération RestauMax est ' + code + '. Il expire dans 10 minutes. Si vous n’avez pas demandé cette opération, ignorez ce message.',
      html: '<p>' + (purpose === 'contact' ? 'Vous avez demandé la vérification de cette adresse comme adresse de récupération de votre compte administrateur RestauMax.' : 'Vous avez demandé la récupération de votre accès administrateur RestauMax.') + '</p><p>Votre code à usage unique :</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">' + code + '</p><p>Ce code expire dans 10 minutes et ne peut être utilisé qu’une seule fois.</p><p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p>'
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    const providerError = await response.json().catch(() => null) as any;
    const providerMessage = typeof providerError?.message === 'string'
      ? providerError.message.slice(0, 240)
      : 'motif non communiqué par le fournisseur';
    const providerName = typeof providerError?.name === 'string'
      ? providerError.name.slice(0, 80)
      : 'resend_error';
    throw new Error('Resend a refusé l’envoi (' + response.status + ', ' + providerName + ') : ' + providerMessage);
  }
}


function recoveryEmailClaimId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export async function getPlatformAdminRecoveryContact(db: any, uid: string): Promise<string | null> {
  const snap = await db.collection(RECOVERY_CONTACT_COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  const record = snap.data() || {};
  const email = String(record.email || '').trim().toLowerCase();
  return Number(record.verifiedAt || 0) > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function startPlatformAdminRecoveryContactVerification(db: any, uid: string, email: string): Promise<void> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Adresse e-mail de récupération invalide.');
  }
  const claimRef = db.collection(RECOVERY_CONTACT_COLLECTION + '_claims').doc(recoveryEmailClaimId(normalizedEmail));
  const claim = await claimRef.get();
  if (claim.exists && String(claim.data()?.uid || '') !== uid) {
    throw new Error('Cette adresse est déjà associée à un autre compte administrateur.');
  }

  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const now = Date.now();
  const ref = db.collection(RECOVERY_CONTACT_VERIFICATION_COLLECTION).doc(uid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data() || {} : {};
    const windowStartedAt = Number(previous.windowStartedAt || 0);
    const sendCount = windowStartedAt > now - SEND_WINDOW_MS ? Number(previous.sendCount || 0) : 0;
    if (Number(previous.lastSentAt || 0) > now - 60_000 || sendCount >= MAX_SENDS_PER_WINDOW) {
      throw new Error('Veuillez attendre avant de demander un nouveau code de vérification.');
    }
    tx.set(ref, {
      pendingEmail: normalizedEmail,
      codeHash: hashRecoveryCode(code),
      createdAt: now,
      expiresAt: now + RECOVERY_TTL_MS,
      attempts: 0,
      consumedAt: null,
      windowStartedAt: sendCount ? windowStartedAt : now,
      sendCount: sendCount + 1,
      lastSentAt: now
    });
  });
  try {
    await sendWithResend(normalizedEmail, code, 'contact');
  } catch (error) {
    await ref.set({ codeHash: null, expiresAt: Date.now(), deliveryFailedAt: Date.now() }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyPlatformAdminRecoveryContact(db: any, uid: string, code: string): Promise<string | null> {
  const normalizedCode = String(code || '').replace(/\s/g, '');
  if (!/^\d{8}$/.test(normalizedCode)) return null;
  const verificationRef = db.collection(RECOVERY_CONTACT_VERIFICATION_COLLECTION).doc(uid);
  const contactRef = db.collection(RECOVERY_CONTACT_COLLECTION).doc(uid);
  const result = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(verificationRef);
    if (!snap.exists) return { email: null, duplicate: false };
    const record = snap.data() || {};
    if (record.consumedAt || Number(record.expiresAt || 0) <= Date.now() ||
        Number(record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
      tx.update(verificationRef, { codeHash: null, consumedAt: Date.now(), updatedAt: Date.now() });
      return { email: null, duplicate: false };
    }
    const matches = sameHash(String(record.codeHash || ''), hashRecoveryCode(normalizedCode));
    if (!matches) {
      tx.update(verificationRef, { attempts: Number(record.attempts || 0) + 1, updatedAt: Date.now() });
      return { email: null, duplicate: false };
    }
    const email = String(record.pendingEmail || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      tx.update(verificationRef, { codeHash: null, consumedAt: Date.now(), updatedAt: Date.now() });
      return { email: null, duplicate: false };
    }
    const nextClaimRef = db.collection(RECOVERY_CONTACT_COLLECTION + '_claims').doc(recoveryEmailClaimId(email));
    const nextClaim = await tx.get(nextClaimRef);
    if (nextClaim.exists && String(nextClaim.data()?.uid || '') !== uid) {
      tx.update(verificationRef, { codeHash: null, consumedAt: Date.now(), updatedAt: Date.now() });
      return { email: null, duplicate: true };
    }
    const current = await tx.get(contactRef);
    const previousEmail = String(current.exists ? current.data()?.email || '' : '').trim().toLowerCase();
    if (previousEmail && previousEmail !== email) {
      const previousClaimRef = db.collection(RECOVERY_CONTACT_COLLECTION + '_claims').doc(recoveryEmailClaimId(previousEmail));
      const previousClaim = await tx.get(previousClaimRef);
      if (previousClaim.exists && String(previousClaim.data()?.uid || '') === uid) tx.delete(previousClaimRef);
    }
    tx.set(nextClaimRef, { uid, claimedAt: Date.now() });
    tx.set(contactRef, { email, verifiedAt: Date.now(), updatedAt: Date.now() });
    tx.delete(verificationRef);
    return { email, duplicate: false };
  });
  if (result.duplicate) throw new Error('Cette adresse est déjà associée à un autre compte administrateur.');
  return result.email;
}

export async function startPlatformAdminEmailRecovery(db: any, uid: string, email: string): Promise<void> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Adresse e-mail de récupération indisponible.');
  }
  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const now = Date.now();
  const ref = db.collection(RECOVERY_COLLECTION).doc(uid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data() || {} : {};
    const windowStartedAt = Number(previous.windowStartedAt || 0);
    const sendCount = windowStartedAt > now - SEND_WINDOW_MS ? Number(previous.sendCount || 0) : 0;
    if (Number(previous.lastSentAt || 0) > now - 60_000 || sendCount >= MAX_SENDS_PER_WINDOW) {
      throw new Error('Veuillez attendre avant de demander un nouveau code de récupération.');
    }
    tx.set(ref, {
      codeHash: hashRecoveryCode(code),
      createdAt: now,
      expiresAt: now + RECOVERY_TTL_MS,
      attempts: 0,
      consumedAt: null,
      windowStartedAt: sendCount ? windowStartedAt : now,
      sendCount: sendCount + 1,
      lastSentAt: now
    });
  });
  try {
    await sendWithResend(normalizedEmail, code);
  } catch (error) {
    await ref.set({
      codeHash: null,
      expiresAt: Date.now(),
      deliveryFailedAt: Date.now()
    }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyPlatformAdminEmailRecovery(
  db: any, uid: string, code: string, sessionVersion: number
) {
  const normalizedCode = String(code || '').replace(/\s/g, '');
  if (!/^\d{8}$/.test(normalizedCode)) return null;
  const ref = db.collection(RECOVERY_COLLECTION).doc(uid);
  const accepted = await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const record = snap.data() || {};
    if (record.consumedAt || Number(record.expiresAt || 0) <= Date.now() ||
        Number(record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
      tx.update(ref, { codeHash: null, consumedAt: Date.now(), updatedAt: Date.now() });
      return false;
    }
    const matches = sameHash(String(record.codeHash || ''), hashRecoveryCode(normalizedCode));
    if (!matches) {
      tx.update(ref, { attempts: Number(record.attempts || 0) + 1, updatedAt: Date.now() });
      return false;
    }
    tx.update(ref, { codeHash: null, consumedAt: Date.now(), updatedAt: Date.now() });
    return true;
  });
  if (!accepted) return null;
  await revokePlatformAdminMfaSessions(db, uid);
  await db.collection('platform_admin_mfa_webauthn_challenges').doc(uid).delete().catch(() => undefined);
  await db.collection('platform_admin_mfa').doc(uid).set({
    passkeys: [],
    passkeysClearedAtRecovery: Date.now(),
    updatedAt: Date.now()
  }, { merge: true });
  return createPlatformAdminMfaSession(db, uid, sessionVersion, 'recovery', RECOVERY_TTL_MS);
}
