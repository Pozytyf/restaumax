import crypto from 'node:crypto';

const SESSION_COOKIE = '__Host-rm_table_session';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

const randomSecret = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');
const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
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

export async function issueTableQr(db: any, restaurantSlug: string, tableId: string, origin: string) {
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
    if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'suspended' || restaurantSnap.data()?.isActive === false) {
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

export async function revokeTableQr(db: any, restaurantSlug: string, tableId: string) {
  if (!db) throw new Error('Firebase Admin indisponible.');
  const slug = String(restaurantSlug || '').trim();
  const id = String(tableId || '').trim();
  const tokens = await db.collection('restaurants').doc(slug).collection('table_qr_tokens').where('tableId', '==', id).get();
  if (tokens.empty) return { revoked: 0 };
  const batch = db.batch();
  const now = Date.now();
  let revoked = 0;
  tokens.docs.forEach((doc: any) => {
    if (doc.data()?.status === 'active') {
      batch.update(doc.ref, { status: 'revoked', revokedAt: now, updatedAt: now });
      revoked += 1;
    }
  });
  if (revoked) await batch.commit();
  return { revoked };
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
    if (!restaurantData || restaurantData.status === 'suspended' || restaurantData.isActive === false || restaurantData.isOpen === false) {
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
  if (!restaurantSnap.exists || restaurantSnap.data()?.status === 'suspended' || restaurantSnap.data()?.isActive === false || restaurantSnap.data()?.isOpen === false) return null;
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
  const role = String(decoded.role || '');
  if (role === 'super_admin' || role === 'admin') return decoded;
  const managerSnap = await db.collection('managers').doc(decoded.uid).get();
  if (!managerSnap.exists) throw new Error('Accès gestionnaire refusé.');
  const manager = managerSnap.data();
  if (manager.active === false || manager.restaurantSlug !== restaurantSlug) throw new Error('Accès à ce restaurant refusé.');
  const managerRole = String(manager.role || role);
  if (!['owner', 'admin', 'super_admin'].includes(managerRole)) {
    const permissions = manager.permissions;
    const canManageTables = Array.isArray(permissions)
      ? permissions.includes('tables.manage')
      : Boolean(permissions && permissions['tables.manage'] === true);
    if (!canManageTables) throw new Error('Permission de gestion des tables requise.');
  }
  return decoded;
}
