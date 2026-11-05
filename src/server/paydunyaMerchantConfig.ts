import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PayDunyaConfig, PayDunyaMode } from './paydunyaService.js';

export interface RestaurantPayDunyaCredentials {
  mode: PayDunyaMode;
  masterKey: string;
  privateKey: string;
  token: string;
}

function encryptionKey(env: Record<string, string | undefined>): Buffer {
  const raw = String(env.PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('PAYDUNYA_CREDENTIALS_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux.');
  }
  return Buffer.from(raw, 'hex');
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
  env: Record<string, string | undefined>
): { version: 1; algorithm: 'aes-256-gcm'; iv: string; authTag: string; ciphertext: string } {
  validateCredentials(credentials);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const plaintext = Buffer.from(JSON.stringify({
    mode: credentials.mode,
    masterKey: credentials.masterKey.trim(),
    privateKey: credentials.privateKey.trim(),
    token: credentials.token.trim()
  }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
}

export function decryptRestaurantPayDunyaCredentials(
  encrypted: { version: number; algorithm: string; iv: string; authTag: string; ciphertext: string },
  env: Record<string, string | undefined>
): RestaurantPayDunyaCredentials {
  if (!encrypted || encrypted.version !== 1 || encrypted.algorithm !== 'aes-256-gcm' ||
      !/^[a-f0-9]{24}$/i.test(encrypted.iv || '') ||
      !/^[a-f0-9]{32}$/i.test(encrypted.authTag || '') ||
      !/^[a-f0-9]+$/i.test(encrypted.ciphertext || '') || encrypted.ciphertext.length > 8192) {
    throw new Error('Enveloppe des identifiants PayDunya invalide.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(encrypted.iv, 'hex'));
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
  env: Record<string, string | undefined>
): Promise<{ success: true; data: PayDunyaConfig } | { success: false; error: string }> {
  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) {
    return { success: false, error: 'Restaurant PayDunya invalide.' };
  }
  try {
    const snapshot = await db.collection('restaurants').doc(restaurantSlug)
      .collection('_private').doc('paydunya').get();
    if (!snapshot.exists) return { success: false, error: 'Ce restaurant n’a pas encore connecté son compte PayDunya.' };
    const stored = snapshot.data() || {};
    if (stored.enabled !== true) return { success: false, error: 'Le compte PayDunya de ce restaurant est désactivé.' };
    const credentials = decryptRestaurantPayDunyaCredentials(stored.credentials, env);
    if (credentials.mode === 'live' && env.PAYDUNYA_LIVE_ENABLED !== 'true') {
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
  const encrypted = encryptRestaurantPayDunyaCredentials(credentials, env);
  await db.collection('restaurants').doc(restaurantSlug).collection('_private').doc('paydunya').set({
    enabled: true,
    mode: credentials.mode,
    credentials: encrypted,
    updatedAt: Date.now(),
    schemaVersion: 1
  }, { merge: true });
}
