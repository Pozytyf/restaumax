import crypto from 'node:crypto';
import { getRestaurantOwnerUid } from './restaurantOwnership.ts';

const SESSION_COOKIE = '__Host-rm_table_session';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

const randomSecret = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');
const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function qrEncryptionKey(env: Record<string, string | undefined>, version: number): Buffer {
  const versionedKey = env[`TABLE_QR_TOKEN_ENCRYPTION_KEY_V${version}`];
  const raw = String(versionedKey || env.TABLE_QR_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('TABLE_QR_TOKEN_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux.');
  }
  return Buffer.from(raw, 'hex');
}

function qrTokenAad(restaurantSlug: string, tableId: string) {
  return Buffer.from(`restaumax:table-qr:v2:${restaurantSlug}:${tableId}`, 'utf8');
}

function encryptQrToken(token: string, env: Record<string, string | undefined>, restaurantSlug: string, tableId: string) {
  const keyVersion = Number(env.TABLE_QR_TOKEN_ENCRYPTION_KEY_VERSION || 1);
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 99) throw new Error('Version de clé QR invalide.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', qrEncryptionKey(env, keyVersion), iv);
  cipher.setAAD(qrTokenAad(restaurantSlug, tableId));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    version: 2,
    keyVersion,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
}

function decryptQrToken(encrypted: any, env: Record<string, string | undefined>, restaurantSlug: string, tableId: string): string {
  const legacy = encrypted?.version === 1;
  const keyVersion = legacy ? 1 : Number(encrypted?.keyVersion);
  if (!encrypted || (!legacy && encrypted.version !== 2) || encrypted.algorithm !== 'aes-256-gcm' ||
      !Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 99 ||
      !/^[a-f0-9]{24}$/i.test(String(encrypted.iv || '')) ||
      !/^[a-f0-9]{32}$/i.test(String(encrypted.authTag || '')) ||
      !/^[a-f0-9]+$/i.test(String(encrypted.ciphertext || '')) || encrypted.ciphertext.length > 512) {
    throw new Error('Enveloppe du QR persistant invalide.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', qrEncryptionKey(env, keyVersion), Buffer.from(encrypted.iv, 'hex'));
  if (!legacy) decipher.setAAD(qrTokenAad(restaurantSlug, tableId));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
    decipher.final()
  ]).toString('utf8');
}
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export const tableSessionCookieName = SESSION_COOKIE;
export const tableCsrfCookieName = '__Host-rm_table_csrf';

export function readCookie(header: string | undefined, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function buildSessionCookie(secret: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(secret)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function buildCsrfCookie(token: string): string {
  return `${tableCsrfCookieName}=${encodeURIComponent(token)}; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearCsrfCookie(): string {
  return `${tableCsrfCookieName}=; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function isTrustedQrNavigation(req: any): boolean {
  const method = String(req?.method || 'GET').toUpperCase();
  if (method !== 'GET') return false;
  const fetchDest = String(req?.headers?.['sec-fetch-dest'] || '').toLowerCase();
  if (fetchDest && fetchDest !== 'document') return false;
  const fetchSite = String(req?.headers?.['sec-fetch-site'] || '').toLowerCase();
  const referer = req?.headers?.referer;
  // Camera apps open QR URLs as top-level cross-site GET navigations.
  // State-changing endpoints continue to enforce strict Origin and CSRF checks.
  if (fetchSite === 'cross-site') {
    return fetchDest === 'document' && !referer;
  }
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  if (typeof referer === 'string' && referer) {
    try {
      const refererUrl = new URL(referer);
      const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https').split(',')[0].trim();
      const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
      if (!host) return false;
      const expectedProtocol = forwardedProto === 'http' && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http:' : 'https:';
      if (refererUrl.origin !== `${expectedProtocol}//${host}`) return false;
    } catch { return false; }
  }
  return true;
}

export function requestHasValidOrigin(req: any): boolean {
  const origin = req?.headers?.origin;
  if (typeof origin !== 'string' || !origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return false;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https').split(',')[0].trim();
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!host) return false;
  const expectedProtocol = forwardedProto === 'http' && (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'http:' : 'https:';
  return parsed.origin === `${expectedProtocol}//${host}`;
}

export async function issueTableQr(db: any, restaurantSlug: string, tableId: string, origin: string, env: Record<string, string | undefined> = process.env) {
  if (!db) throw new Error('Firebase Admin indisponible.');
  const slug = String(restaurantSlug || '').trim();
  const id = String(tableId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error('Restaurant ou identifiant de table invalide.');
  }
  const restaurantRef = db.collection('restaurants').doc(slug);
  const tableRef = restaurantRef.collection('tables').doc(id);
  const token = randomSecret();
  const tokenHash = sha256(token);
  const tokenRef = restaurantRef.collection('table_qr_tokens').doc(tokenHash);
  const now = Date.now();

  await db.runTransaction(async (tx: any) => {
    const [restaurantSnap, tableSnap, existingTokens] = await Promise.all([
      tx.get(restaurantRef),
      tx.get(tableRef),
      tx.get(restaurantRef.collection('table_qr_tokens').where('tableId', '==', id))
    ]);
    if (!restaurantSnap.exists || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt || restaurantSnap.data()?.isActive === false) {
      throw new Error('Restaurant introuvable, inactif ou suspendu.');
    }
    if (!tableSnap.exists || tableSnap.data()?.isActive !== true) {
      throw new Error('Table introuvable ou inactive.');
    }
    existingTokens.docs.forEach((doc: any) => {
      if (doc.data()?.status === 'active') tx.update(doc.ref, { status: 'revoked', revokedAt: now, updatedAt: now });
    });
    tx.create(tokenRef, {
      tokenHash,
      encryptedToken: encryptQrToken(token, env, slug, id),
      restaurantSlug: slug,
      tableId: id,
      tableNumber: String(tableSnap.data()?.tableNumber || ''),
      status: 'active',
      version: Number(tableSnap.data()?.qrVersion || 0) + 1,
      createdAt: now,
      updatedAt: now
    });
    tx.update(tableRef, { qrVersion: Number(tableSnap.data()?.qrVersion || 0) + 1, qrUpdatedAt: now });
  });

  return { token, url: `${origin.replace(/\/+$/, '')}/q/${token}` };
}


/**
 * Rehydrates the existing QR URL without rotating the printed token. The raw
 * bearer token is never stored in plaintext: only an AES-256-GCM envelope is
 * persisted beside its SHA-256 lookup hash in the server-only collection.
 * Returns null for legacy tokens that predate encrypted persistence.
 */
export async function getActiveTableQr(
  db: any,
  restaurantSlug: string,
  tableId: string,
  origin: string,
  env: Record<string, string | undefined> = process.env
): Promise<{ token: string; url: string } | null> {
  if (!db) throw new Error('Firebase Admin indisponible.');
  const slug = String(restaurantSlug || '').trim();
  const id = String(tableId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error('Restaurant ou identifiant de table invalide.');
  }
  const restaurantRef = db.collection('restaurants').doc(slug);
  const tableRef = restaurantRef.collection('tables').doc(id);
  const [restaurantSnap, tableSnap, tokens] = await Promise.all([
    restaurantRef.get(),
    tableRef.get(),
    restaurantRef.collection('table_qr_tokens').where('tableId', '==', id).get()
  ]);
  const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
  const table = tableSnap.exists ? tableSnap.data() : null;
  if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false) {
    throw new Error('Restaurant introuvable, inactif ou suspendu.');
  }
  if (!table || table.isActive !== true) throw new Error('Table introuvable ou inactive.');
  const active = tokens.docs.find((entry: any) => {
    const data = entry.data();
    return data?.status === 'active' &&
      data?.restaurantSlug === slug && data?.tableId === id &&
      Number(data?.version || 0) === Number(table.qrVersion || 0);
  });
  if (!active) return null;
  const data = active.data();
  if (!data.encryptedToken) return null;
  const token = decryptQrToken(data.encryptedToken, env, slug, id);
  if (token.length < 30 || token.length > 100 || sha256(token) !== data.tokenHash) {
    throw new Error('Le QR enregistré ne correspond plus à son empreinte de sécurité.');
  }
  return { token, url: `${origin.replace(/\/+$/, '')}/q/${token}` };
}

export async function revokeTableQr(db: any, restaurantSlug: string, tableId: string) {
  if (!db) throw new Error('Firebase Admin indisponible.');
  const slug = String(restaurantSlug || '').trim();
  const id = String(tableId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error('Restaurant ou identifiant de table invalide.');
  }
  const restaurantRef = db.collection('restaurants').doc(slug);
  const tableRef = restaurantRef.collection('tables').doc(id);
  const tokenQuery = restaurantRef.collection('table_qr_tokens').where('tableId', '==', id);
  const now = Date.now();

  // Serialize revocation with QR issuance through the table version document.
  // This closes the race where a concurrent issuance could otherwise survive a
  // query-then-batch revocation. Incrementing the version also invalidates sessions.
  return await db.runTransaction(async (tx: any) => {
    const [tableSnap, tokens] = await Promise.all([tx.get(tableRef), tx.get(tokenQuery)]);
    let revoked = 0;
    tokens.docs.forEach((doc: any) => {
      if (doc.data()?.status === 'active') {
        tx.update(doc.ref, { status: 'revoked', revokedAt: now, updatedAt: now });
        revoked += 1;
      }
    });
    if (tableSnap.exists) {
      tx.update(tableRef, {
        qrVersion: Number(tableSnap.data()?.qrVersion || 0) + 1,
        qrRevokedAt: now,
        qrUpdatedAt: now
      });
    }
    return { revoked, versionAdvanced: tableSnap.exists };
  });
}

export async function resolveTableQr(db: any, token: string) {
  if (!db || typeof token !== 'string' || token.length < 30 || token.length > 100) {
    throw new Error('QR code invalide ou expiré.');
  }
  const tokenHash = sha256(token);
  const matches = await db.collectionGroup('table_qr_tokens').where('tokenHash', '==', tokenHash).limit(2).get();
  if (matches.size !== 1) throw new Error('QR code inconnu, révoqué ou invalide.');
  const tokenDocRef = matches.docs[0].ref;
  const tokenData = matches.docs[0].data();
  const slug = String(tokenData.restaurantSlug || '');
  const tableId = String(tokenData.tableId || '');
  if (!slug || !tableId) throw new Error('QR code mal configuré.');

  const restaurantRef = db.collection('restaurants').doc(slug);
  const tableRef = restaurantRef.collection('tables').doc(tableId);
  const sessionSecret = randomSecret();
  const csrfToken = randomSecret();
  const sessionHash = sha256(sessionSecret);
  const sessionRef = restaurantRef.collection('table_sessions').doc(sessionHash);
  const now = Date.now();
  let tableNumber = '';

  // Re-read token, restaurant and table in one transaction. A concurrent rotation/revocation
  // conflicts with this transaction and cannot create a usable session from a stale QR.
  await db.runTransaction(async (tx: any) => {
    const [currentToken, restaurantSnap, tableSnap] = await Promise.all([
      tx.get(tokenDocRef),
      tx.get(restaurantRef),
      tx.get(tableRef)
    ]);
    const currentTokenData = currentToken.exists ? currentToken.data() : null;
    const restaurantData = restaurantSnap.exists ? restaurantSnap.data() : null;
    const tableData = tableSnap.exists ? tableSnap.data() : null;
    if (!currentTokenData || currentTokenData.status !== 'active' || currentTokenData.tokenHash !== tokenHash ||
        currentTokenData.restaurantSlug !== slug || currentTokenData.tableId !== tableId) {
      throw new Error('Ce QR code a été révoqué ou remplacé.');
    }
    if (!restaurantData || restaurantData.status !== 'active' || restaurantData.deletedAt || restaurantData.isActive === false || restaurantData.isOpen === false) {
      throw new Error('Ce restaurant est temporairement indisponible.');
    }
    if (!tableData || tableData.isActive !== true ||
        Number(tableData.qrVersion || 0) !== Number(currentTokenData.version || 0)) {
      throw new Error('Cette table est inactive ou son QR a été remplacé.');
    }
    tableNumber = String(tableData.tableNumber || currentTokenData.tableNumber || '');
    tx.create(sessionRef, {
      sessionHash,
      restaurantSlug: slug,
      tableId,
      tableNumber,
      qrTokenHash: tokenHash,
      qrVersion: Number(currentTokenData.version || 1),
      csrfHash: sha256(csrfToken),
      restaurantSessionVersion: Number(restaurantData.tableSessionVersion || 0),
      status: 'active',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS
    });
  });

  return { sessionSecret, restaurantSlug: slug, tableId, tableNumber, csrfToken };
}

export async function getActiveTableSession(db: any, sessionSecret: string | null) {
  if (!db || !sessionSecret) return null;
  const sessionHash = sha256(sessionSecret);
  const matches = await db.collectionGroup('table_sessions').where('sessionHash', '==', sessionHash).limit(2).get();
  if (matches.size !== 1) return null;
  const sessionDoc = matches.docs[0];
  const session = sessionDoc.data();
  const now = Date.now();
  if (session.status !== 'active' || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) return null;

  const restaurantSlug = String(session.restaurantSlug || '');
  const tableId = String(session.tableId || '');
  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const tableRef = restaurantRef.collection('tables').doc(tableId);
  const qrRef = restaurantRef.collection('table_qr_tokens').doc(String(session.qrTokenHash || ''));
  const [restaurantSnap, tableSnap, qrSnap] = await Promise.all([restaurantRef.get(), tableRef.get(), qrRef.get()]);
  if (!restaurantSnap.exists || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt || restaurantSnap.data()?.isActive === false || restaurantSnap.data()?.isOpen === false) return null;
  if (Number(session.restaurantSessionVersion || 0) !== Number(restaurantSnap.data()?.tableSessionVersion || 0)) return null;
  if (!tableSnap.exists || tableSnap.data()?.isActive !== true || Number(tableSnap.data()?.qrVersion || 0) !== Number(session.qrVersion || 0)) return null;
  if (!qrSnap.exists || qrSnap.data()?.status !== 'active') return null;
  if (qrSnap.data()?.tokenHash !== session.qrTokenHash || qrSnap.data()?.restaurantSlug !== restaurantSlug || qrSnap.data()?.tableId !== tableId) return null;
  if (Number(qrSnap.data()?.version || 0) !== Number(session.qrVersion || 0)) return null;
  if (Number(tableSnap.data()?.qrVersion || 0) !== Number(session.qrVersion || 0)) return null;

  await sessionDoc.ref.update({ lastSeenAt: now });
  return {
    restaurantSlug,
    tableId,
    tableNumber: String(tableSnap.data()?.tableNumber || ''),
    sessionHash,
    qrTokenHash: String(session.qrTokenHash || ''),
    qrVersion: Number(session.qrVersion || 0),
    restaurantSessionVersion: Number(session.restaurantSessionVersion || 0),
    csrfHash: String(session.csrfHash || ''),
    expiresAt: session.expiresAt
  };
}

export function validateCsrf(session: any, suppliedToken: unknown): boolean {
  if (!session || typeof session.csrfHash !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrfHash) || typeof suppliedToken !== 'string' || suppliedToken.length < 30 || suppliedToken.length > 100) return false;
  return safeEqual(session.csrfHash, sha256(suppliedToken));
}

export async function authorizeTableManager(db: any, auth: any, req: any, restaurantSlug: string) {
  const header = String(req?.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !auth) throw new Error('Authentification gestionnaire requise.');
  const decoded = await auth.verifyIdToken(match[1], true);
  if (!decoded?.uid) throw new Error('Identité gestionnaire invalide.');

  // A platform claim is never a substitute for membership in the target restaurant.
  const [managerSnap, restaurantSnap] = await Promise.all([
    db.collection('managers').doc(decoded.uid).get(),
    db.collection('restaurants').doc(restaurantSlug).get()
  ]);
  if (!managerSnap.exists) throw new Error('Accès gestionnaire refusé.');
  if (!restaurantSnap.exists || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt) {
    throw new Error('Restaurant inactif ou indisponible.');
  }

  const manager = managerSnap.data();
  const restaurantData = restaurantSnap.data();
  const ownerUid = await getRestaurantOwnerUid(db, restaurantSlug, undefined, restaurantData);
  if (manager.active !== true || manager.restaurantSlug !== restaurantSlug) {
    throw new Error('Accès à ce restaurant refusé.');
  }
  if (Number(decoded.sessionVersion || 0) !== Number(manager.sessionVersion || 0)) {
    throw new Error('Session utilisateur révoquée. Reconnectez-vous.');
  }

  const managerRole = String(manager.role || '');
  if (!['owner', 'manager'].includes(managerRole)) {
    throw new Error('Seul le propriétaire ou un manager du restaurant peut administrer les QR de table.');
  }
  if (managerRole === 'owner' && ownerUid !== decoded.uid) {
    throw new Error('Le compte propriétaire ne correspond pas au propriétaire enregistré du restaurant.');
  }
  if (managerRole === 'manager' &&
      (!Array.isArray(manager.permissions) || !manager.permissions.includes('tables.manage'))) {
    throw new Error('Permission de gestion des tables requise.');
  }
  return decoded;
}

/**
 * Updates service availability only after re-validating the Firebase identity,
 * active restaurant membership, owner binding, and manager role.
 */
export async function updateRestaurantServiceStatus(
  db: any,
  auth: any,
  req: any,
  restaurantSlug: string,
  isOpen: boolean
) {
  if (typeof isOpen !== 'boolean') throw new Error('État du service invalide.');
  const header = String(req?.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !auth) throw new Error('Authentification gestionnaire requise.');
  const decoded = await auth.verifyIdToken(match[1], true);
  if (!decoded?.uid) throw new Error('Identité gestionnaire invalide.');
  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const managerRef = db.collection('managers').doc(decoded.uid);
  const [restaurantSnap, managerSnap] = await Promise.all([restaurantRef.get(), managerRef.get()]);
  const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
  const manager = managerSnap.exists ? managerSnap.data() : null;
  const ownerUid = await getRestaurantOwnerUid(db, restaurantSlug, undefined, restaurant);
  if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
      !manager || manager.active !== true || manager.restaurantSlug !== restaurantSlug ||
      Number(decoded.sessionVersion || 0) !== Number(manager.sessionVersion || 0)) {
    throw new Error('Accès au restaurant révoqué ou indisponible.');
  }
  if (!['owner', 'manager'].includes(String(manager.role || ''))) {
    throw new Error('Seul le propriétaire ou un manager peut modifier le service.');
  }
  if (manager.role === 'owner' && ownerUid !== decoded.uid) {
    throw new Error('Le compte propriétaire ne correspond pas au propriétaire enregistré.');
  }
  await db.runTransaction(async (tx: any) => {
    const [currentRestaurantSnap, currentManagerSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(managerRef)
    ]);
    const currentRestaurant = currentRestaurantSnap.exists ? currentRestaurantSnap.data() : null;
    const currentManager = currentManagerSnap.exists ? currentManagerSnap.data() : null;
    const currentOwnerUid = await getRestaurantOwnerUid(db, restaurantSlug, tx, currentRestaurant);
    if (!currentRestaurant || currentRestaurant.status !== 'active' || currentRestaurant.deletedAt ||
        currentRestaurant.isActive === false || !currentManager || currentManager.active !== true ||
        currentManager.restaurantSlug !== restaurantSlug ||
        Number(decoded.sessionVersion || 0) !== Number(currentManager.sessionVersion || 0)) {
      throw new Error('Accès au restaurant révoqué ou indisponible.');
    }
    if (!['owner', 'manager'].includes(String(currentManager.role || ''))) {
      throw new Error('Seul le propriétaire ou un manager peut modifier le service.');
    }
    if (currentManager.role === 'owner' && currentOwnerUid !== decoded.uid) {
      throw new Error('Seul le propriétaire enregistré peut modifier le service.');
    }
    tx.update(restaurantRef, {
      isOpen,
      serviceStatusUpdatedAt: Date.now()
    });
  });
  return { success: true, isOpen };
}
