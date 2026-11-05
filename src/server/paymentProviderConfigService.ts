import crypto from 'node:crypto';

export interface JekoPaymentConfigInput {
  apiKey: string;
  apiKeyId: string;
  storeId: string;
  webhookSecret: string;
}

export interface JekoPaymentConfigStatus {
  configured: boolean;
  provider: 'jeko' | null;
  storeIdMasked: string | null;
  updatedAt: number | null;
}

function resolveEncryptionKey(explicitKey?: string): Buffer {
  const raw = explicitKey || process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || '';
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('Clé de chiffrement des intégrations invalide.');
  }
  if (key.length !== 32) throw new Error('PAYMENT_CONFIG_ENCRYPTION_KEY doit contenir une clé Base64 de 32 octets.');
  return key;
}

export function encryptPaymentSecret(value: string, explicitKey?: string): string {
  if (!value) throw new Error('Secret vide.');
  const key = resolveEncryptionKey(explicitKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptPaymentSecret(encrypted: string, explicitKey?: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = String(encrypted || '').split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Format de secret chiffré inconnu.');
  }
  const key = resolveEncryptionKey(explicitKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function safeStatus(config: any): JekoPaymentConfigStatus {
  const storeId = String(config?.storeId || '');
  return {
    configured: config?.provider === 'jeko' && config?.enabled === true,
    provider: config?.provider === 'jeko' ? 'jeko' : null,
    storeIdMasked: storeId ? `••••${storeId.slice(-6)}` : null,
    updatedAt: Number(config?.updatedAt || 0) || null
  };
}

export async function saveJekoPaymentConfigWithDb(
  db: any,
  restaurantSlug: string,
  actorUid: string,
  sessionVersion: number,
  input: JekoPaymentConfigInput,
  explicitEncryptionKey?: string
): Promise<{ success: boolean; error?: string; status?: JekoPaymentConfigStatus }> {
  const slug = String(restaurantSlug || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  const apiKeyId = String(input.apiKeyId || '').trim();
  const storeId = String(input.storeId || '').trim();
  const webhookSecret = String(input.webhookSecret || '').trim();

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !actorUid ||
      apiKey.length < 12 || apiKey.length > 512 ||
      apiKeyId.length < 1 || apiKeyId.length > 255 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId) ||
      webhookSecret.length < 12 || webhookSecret.length > 512) {
    return { success: false, error: 'Configuration Jèko invalide. Vérifiez les identifiants, le magasin et le secret webhook.' };
  }

  let encryptedApiKey: string;
  let encryptedWebhookSecret: string;
  try {
    encryptedApiKey = encryptPaymentSecret(apiKey, explicitEncryptionKey);
    encryptedWebhookSecret = encryptPaymentSecret(webhookSecret, explicitEncryptionKey);
    // Validate the API key identifier is encrypted too; it is stored as a secret.
  } catch (error: any) {
    return { success: false, error: error?.message || 'Chiffrement des identifiants impossible.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const configRef = restaurantRef.collection('private_integrations').doc('payment_provider');
  const storeMapRef = db.collection('payment_provider_stores').doc(storeId);

  try {
    const status = await db.runTransaction(async (tx: any) => {
      const [restaurantSnap, memberSnap, configSnap, storeMapSnap] = await Promise.all([
        tx.get(restaurantRef), tx.get(memberRef), tx.get(configRef), tx.get(storeMapRef)
      ]);
      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const member = memberSnap.exists ? memberSnap.data() : null;
      const oldConfig = configSnap.exists ? configSnap.data() : null;

      if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt ||
          !member || member.active !== true || member.restaurantSlug !== slug ||
          Number(sessionVersion || 0) !== Number(member.sessionVersion || 0) ||
          member.role !== 'owner' || restaurant.ownerUid !== actorUid) {
        throw new Error('Seul le propriétaire actif du restaurant peut configurer le prestataire de paiement.');
      }
      if (storeMapSnap.exists && storeMapSnap.data()?.restaurantSlug !== slug) {
        throw new Error('Ce magasin Jèko est déjà associé à un autre restaurant RestauMax.');
      }

      const now = Date.now();
      const config = {
        provider: 'jeko',
        enabled: true,
        apiKeyEncrypted: encryptedApiKey,
        apiKeyIdEncrypted: encryptPaymentSecret(apiKeyId, explicitEncryptionKey),
        storeId,
        webhookSecretEncrypted: encryptedWebhookSecret,
        updatedAt: now,
        updatedBy: actorUid
      };
      tx.set(configRef, config);
      tx.set(storeMapRef, { restaurantSlug: slug, provider: 'jeko', updatedAt: now });
      if (oldConfig?.storeId && oldConfig.storeId !== storeId) {
        tx.delete(db.collection('payment_provider_stores').doc(oldConfig.storeId));
      }
      return safeStatus(config);
    });
    return { success: true, status };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Impossible d’enregistrer la configuration Jèko.' };
  }
}

export async function getJekoPaymentConfigStatusWithDb(db: any, restaurantSlug: string): Promise<JekoPaymentConfigStatus> {
  const slug = String(restaurantSlug || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return { configured: false, provider: null, storeIdMasked: null, updatedAt: null };
  const snap = await db.collection('restaurants').doc(slug)
    .collection('private_integrations').doc('payment_provider').get();
  return safeStatus(snap.exists ? snap.data() : null);
}

export async function getJekoPaymentConfigWithDb(db: any, restaurantSlug: string, explicitEncryptionKey?: string): Promise<any | null> {
  const slug = String(restaurantSlug || '').trim();
  const snap = await db.collection('restaurants').doc(slug)
    .collection('private_integrations').doc('payment_provider').get();
  if (!snap.exists) return null;
  const config = snap.data();
  if (config?.provider !== 'jeko' || config.enabled !== true) return null;
  return {
    provider: 'jeko',
    storeId: config.storeId,
    apiKey: decryptPaymentSecret(config.apiKeyEncrypted, explicitEncryptionKey),
    apiKeyId: decryptPaymentSecret(config.apiKeyIdEncrypted, explicitEncryptionKey),
    webhookSecret: decryptPaymentSecret(config.webhookSecretEncrypted, explicitEncryptionKey),
    updatedAt: config.updatedAt
  };
}

export async function deleteJekoPaymentConfigWithDb(
  db: any,
  restaurantSlug: string,
  actorUid: string,
  sessionVersion: number
): Promise<{ success: boolean; error?: string }> {
  const slug = String(restaurantSlug || '').trim();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const configRef = restaurantRef.collection('private_integrations').doc('payment_provider');
  try {
    await db.runTransaction(async (tx: any) => {
      const [restaurantSnap, memberSnap, configSnap] = await Promise.all([
        tx.get(restaurantRef), tx.get(memberRef), tx.get(configRef)
      ]);
      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const member = memberSnap.exists ? memberSnap.data() : null;
      const config = configSnap.exists ? configSnap.data() : null;
      if (!restaurant || !member || member.active !== true || member.restaurantSlug !== slug ||
          Number(sessionVersion || 0) !== Number(member.sessionVersion || 0) ||
          member.role !== 'owner' || restaurant.ownerUid !== actorUid) {
        throw new Error('Seul le propriétaire actif peut retirer le prestataire de paiement.');
      }
      if (config?.storeId) tx.delete(db.collection('payment_provider_stores').doc(config.storeId));
      tx.delete(configRef);
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Impossible de retirer la configuration Jèko.' };
  }
}
