import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PayDunyaConfig, PayDunyaMode } from './paydunyaService.js';

export interface RestaurantPayDunyaCredentials {
  mode: PayDunyaMode;
  masterKey: string;
  privateKey: string;
  token: string;
}

function encryptionKey(env: Record<string, string | undefined>, version: number): Buffer {
  const versioned = env[`PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY_V${version}`];
  const raw = String(version === 1
    ? (versioned || env.PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY || '')
    : (versioned || '')).trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error(`PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY_V${version} doit contenir 64 caractères hexadécimaux.`);
  }
  return Buffer.from(raw, 'hex');
}

function payDunyaCredentialsAad(restaurantSlug: string): Buffer {
  return Buffer.from(`restaumax:paydunya-credentials:v2:${restaurantSlug}`, 'utf8');
}

function validateCredentials(value: RestaurantPayDunyaCredentials): void {
  if (!value || !['test', 'live'].includes(value.mode) ||
      typeof value.masterKey !== 'string' || value.masterKey.trim().length < 8 ||
      typeof value.privateKey !== 'string' || value.privateKey.trim().length < 8 ||
      typeof value.token !== 'string' || value.token.trim().length < 5 ||
      value.masterKey.length > 512 || value.privateKey.length > 512 || value.token.length > 512) {
    throw new Error('Identifiants PayDunya du restaurant invalides.');
  }
}

export function encryptRestaurantPayDunyaCredentials(
  credentials: RestaurantPayDunyaCredentials,
  env: Record<string, string | undefined>,
  restaurantSlug: string
): { version: 2; keyVersion: number; algorithm: 'aes-256-gcm'; iv: string; authTag: string; ciphertext: string } {
  validateCredentials(credentials);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) throw new Error('Restaurant PayDunya invalide.');
  const keyVersion = Number(env.PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY_VERSION || 1);
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 99) throw new Error('Version de clé PayDunya invalide.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env, keyVersion), iv);
  cipher.setAAD(payDunyaCredentialsAad(restaurantSlug));
  const plaintext = Buffer.from(JSON.stringify({
    mode: credentials.mode,
    masterKey: credentials.masterKey.trim(),
    privateKey: credentials.privateKey.trim(),
    token: credentials.token.trim()
  }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 2,
    keyVersion,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
}

export function decryptRestaurantPayDunyaCredentials(
  encrypted: { version: number; keyVersion?: number; algorithm: string; iv: string; authTag: string; ciphertext: string },
  env: Record<string, string | undefined>,
  restaurantSlug: string
): RestaurantPayDunyaCredentials {
  const legacy = encrypted?.version === 1;
  const keyVersion = legacy ? 1 : Number(encrypted?.keyVersion);
  if (!encrypted || (!legacy && encrypted.version !== 2) || encrypted.algorithm !== 'aes-256-gcm' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug) ||
      !Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 99 ||
      !/^[a-f0-9]{24}$/i.test(encrypted.iv || '') ||
      !/^[a-f0-9]{32}$/i.test(encrypted.authTag || '') ||
      !/^[a-f0-9]+$/i.test(encrypted.ciphertext || '') || encrypted.ciphertext.length > 8192) {
    throw new Error('Enveloppe des identifiants PayDunya invalide.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env, keyVersion), Buffer.from(encrypted.iv, 'hex'));
  if (!legacy) decipher.setAAD(payDunyaCredentialsAad(restaurantSlug));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
    decipher.final()
  ]).toString('utf8');
  const credentials = JSON.parse(plaintext) as RestaurantPayDunyaCredentials;
  validateCredentials(credentials);
  return credentials;
}

export async function loadRestaurantPayDunyaConfig(
  db: any,
  restaurantSlug: string,
  env: Record<string, string | undefined>,
  allowDisabledForSettlement = false
): Promise<{ success: true; data: PayDunyaConfig } | { success: false; error: string }> {
  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) {
    return { success: false, error: 'Restaurant PayDunya invalide.' };
  }
  try {
    const snapshot = await db.collection('restaurants').doc(restaurantSlug)
      .collection('_private').doc('paydunya').get();
    if (!snapshot.exists) return { success: false, error: 'Ce restaurant n’a pas encore connecté son compte PayDunya.' };
    const stored = snapshot.data() || {};
    if (stored.enabled !== true && !allowDisabledForSettlement) return { success: false, error: 'Le compte PayDunya de ce restaurant est désactivé.' };
    const credentials = decryptRestaurantPayDunyaCredentials(stored.credentials, env, restaurantSlug);
    if (credentials.mode === 'live' && env.PAYDUNYA_LIVE_ENABLED !== 'true' && !allowDisabledForSettlement) {
      return { success: false, error: 'Les paiements PayDunya Production sont désactivés sur RestauMax.' };
    }
    const base = credentials.mode === 'test'
      ? 'https://app.paydunya.com/sandbox-api/v1'
      : 'https://app.paydunya.com/api/v1';
    return {
      success: true,
      data: {
        mode: credentials.mode,
        masterKey: credentials.masterKey,
        privateKey: credentials.privateKey,
        token: credentials.token,
        perEnabled: false,
        createInvoiceUrl: base + '/checkout-invoice/create',
        confirmInvoiceBaseUrl: base + '/checkout-invoice/confirm'
      }
    };
  } catch (error: any) {
    return { success: false, error: String(error?.message || 'Configuration PayDunya indisponible.').slice(0, 220) };
  }
}

export async function saveRestaurantPayDunyaCredentials(
  db: any,
  restaurantSlug: string,
  credentials: RestaurantPayDunyaCredentials,
  env: Record<string, string | undefined>
): Promise<void> {
  const encrypted = encryptRestaurantPayDunyaCredentials(credentials, env, restaurantSlug);
  await db.collection('restaurants').doc(restaurantSlug).collection('_private').doc('paydunya').set({
    enabled: true,
    mode: credentials.mode,
    credentials: encrypted,
    updatedAt: Date.now(),
    schemaVersion: 2
  }, { merge: true });
}
