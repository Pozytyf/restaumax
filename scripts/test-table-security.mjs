import crypto from 'node:crypto';
import {
  issueTableQr, getActiveTableQr, resolveTableQr, getActiveTableSession, revokeTableQr,
  buildSessionCookie, buildCsrfCookie, readCookie, validateCsrf, requestHasValidOrigin, isTrustedQrNavigation,
  authorizeTableManager, updateRestaurantServiceStatus
} from '../src/server/tableSecurityService.ts';
import { resolveTableQrOrigin } from '../src/server/tableQrOrigin.ts';

process.env.TABLE_QR_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}
class DocRef {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new CollectionRef(this.db, this.path + '/' + name); }
  async get() { const value = this.db.store.get(this.path); return { exists: value !== undefined, ref: this, data: () => value }; }
  async create(data) { if (this.db.store.has(this.path)) throw new Error('already exists'); this.db.store.set(this.path, structuredClone(data)); }
  async update(data) { const current = this.db.store.get(this.path); if (!current) throw new Error('document missing'); this.db.store.set(this.path, { ...current, ...structuredClone(data) }); }
}
class CollectionRef {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new DocRef(this.db, this.path + '/' + id); }
  where(field, operator, value) { return new QueryRef(this.db, this.path, field, operator, value, false); }
  async get() { return this.where('__all__', '==', '__all__').get(); }
}
class QueryRef {
  constructor(db, path, field, operator, value, collectionGroup) { Object.assign(this, { db, path, field, operator, value, collectionGroup, max: Infinity }); }
  where(field, operator, value) { return new QueryRef(this.db, this.path, field, operator, value, this.collectionGroup); }
  limit(max) { this.max = max; return this; }
  async get() {
    const docs = [];
    for (const [path, data] of this.db.store.entries()) {
      const segments = path.split('/');
      const matchesPath = this.collectionGroup
        ? segments.length >= 4 && segments[segments.length - 2] === this.path
        : path.startsWith(this.path + '/') && segments.length === this.path.split('/').length + 1;
      const matchesField = this.field === '__all__' || (this.operator === '==' && data?.[this.field] === this.value);
      if (matchesPath && matchesField) docs.push({ ref: new DocRef(this.db, path), exists: true, data: () => data });
      if (docs.length >= this.max) break;
    }
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}
function createDb() {
  const db = {
    store: new Map(),
    collection(name) { return new CollectionRef(db, name); },
    collectionGroup(name) { return new QueryRef(db, name, '__all__', '==', '__all__', true); },
    async runTransaction(callback) {
      const tx = {
        get: (ref) => ref.get(),
        create: (ref, data) => { if (db.store.has(ref.path)) throw new Error('already exists'); db.store.set(ref.path, structuredClone(data)); },
        update: (ref, data) => { const current = db.store.get(ref.path); if (!current) throw new Error('document missing'); db.store.set(ref.path, { ...current, ...structuredClone(data) }); }
      };
      return callback(tx);
    },
    batch() {
      const operations = [];
      return {
        update(ref, data) { operations.push(() => { const current = db.store.get(ref.path); if (!current) throw new Error('document missing'); db.store.set(ref.path, { ...current, ...structuredClone(data) }); }); },
        async commit() { operations.forEach((operation) => operation()); }
      };
    }
  };
  return db;
}
async function run() {
  console.log('RESTAUMAX — TESTS SÉCURITÉ QR / SESSION');
  const db = createDb();
  db.store.set('restaurants/chez-awa', { slug: 'chez-awa', status: 'active', isActive: true, isOpen: true });
  db.store.set('restaurants/chez-awa/private/ownership', { ownerUid: 'owner-1' });
  db.store.set('restaurants/chez-awa/tables/table-4', { id: 'table-4', tableNumber: '4', isActive: true, qrVersion: 0 });

  for (const status of ['provisioning', 'suspended', 'deleted']) {
    db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status });
    let qrRejected = false;
    try { await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example'); }
    catch { qrRejected = true; }
    assert(qrRejected, 'Un restaurant ' + status + ' ne peut pas émettre de QR');
  }
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'active' });

  let globalClaimRejected = false;
  try {
    await authorizeTableManager(
      db,
      { verifyIdToken: async () => ({ uid: 'platform-admin', role: 'super_admin', sessionVersion: 0 }) },
      { headers: { authorization: 'Bearer platform-token' } },
      'chez-awa'
    );
  } catch { globalClaimRejected = true; }
  assert(globalClaimRejected, 'Un claim super_admin sans appartenance ne donne aucun droit QR');

  db.store.set('managers/owner-1', {
    uid: 'owner-1', role: 'owner', restaurantSlug: 'chez-awa',
    active: true, sessionVersion: 0
  });
  let scopedOwnerAllowed = false;
  try {
    await authorizeTableManager(
      db,
      { verifyIdToken: async () => ({ uid: 'owner-1', role: 'owner', sessionVersion: 0 }) },
      { headers: { authorization: 'Bearer owner-token' } },
      'chez-awa'
    );
    scopedOwnerAllowed = true;
  } catch {}
  assert(scopedOwnerAllowed, 'Le propriétaire actif du restaurant conserve la gestion QR');

  db.store.set('managers/owner-spoofed', {
    uid: 'owner-spoofed', role: 'owner', restaurantSlug: 'chez-awa',
    active: true, sessionVersion: 0
  });
  let mismatchedOwnerRejected = false;
  try {
    await authorizeTableManager(
      db,
      { verifyIdToken: async () => ({ uid: 'owner-spoofed', role: 'owner', sessionVersion: 0 }) },
      { headers: { authorization: 'Bearer owner-spoofed-token' } },
      'chez-awa'
    );
  } catch { mismatchedOwnerRejected = true; }
  assert(mismatchedOwnerRejected, 'Un compte marqué owner mais différent de restaurants.ownerUid ne peut pas gérer les QR');

  db.store.set('managers/manager-1', {
    uid: 'manager-1', role: 'manager', restaurantSlug: 'chez-awa',
    active: true, sessionVersion: 0, permissions: ['tables.manage']
  });
  let scopedManagerAllowed = false;
  try {
    await authorizeTableManager(
      db,
      { verifyIdToken: async () => ({ uid: 'manager-1', role: 'manager', sessionVersion: 0 }) },
      { headers: { authorization: 'Bearer manager-token' } },
      'chez-awa'
    );
    scopedManagerAllowed = true;
  } catch {}
  assert(scopedManagerAllowed, 'Le manager actif du restaurant avec tables.manage peut gérer les QR');

  const ownerServiceChange = await updateRestaurantServiceStatus(
    db,
    { verifyIdToken: async () => ({ uid: 'owner-1', role: 'owner', sessionVersion: 0 }) },
    { method: 'POST', headers: { authorization: 'Bearer owner-token' } },
    'chez-awa',
    false
  );
  assert(ownerServiceChange.success && db.store.get('restaurants/chez-awa').isOpen === false,
    'Le propriétaire peut fermer le service via le service serveur autorisé');
  await updateRestaurantServiceStatus(
    db,
    { verifyIdToken: async () => ({ uid: 'manager-1', role: 'manager', sessionVersion: 0 }) },
    { method: 'POST', headers: { authorization: 'Bearer manager-token' } },
    'chez-awa',
    true
  );
  assert(db.store.get('restaurants/chez-awa').isOpen === true,
    'Le manager peut rouvrir le service');
  db.store.set('managers/cashier-1', {
    uid: 'cashier-1', role: 'cashier', restaurantSlug: 'chez-awa',
    active: true, sessionVersion: 0, permissions: ['pos.access']
  });
  let cashierServiceChangeRejected = false;
  try {
    await updateRestaurantServiceStatus(
      db,
      { verifyIdToken: async () => ({ uid: 'cashier-1', role: 'cashier', sessionVersion: 0 }) },
      { method: 'POST', headers: { authorization: 'Bearer cashier-token' } },
      'chez-awa',
      false
    );
  } catch { cashierServiceChangeRejected = true; }
  assert(cashierServiceChangeRejected && db.store.get('restaurants/chez-awa').isOpen === true,
    'Un caissier ne peut pas modifier l’état du service');


  db.store.set('managers/manager-no-qr', {
    uid: 'manager-no-qr', role: 'manager', restaurantSlug: 'chez-awa',
    active: true, sessionVersion: 0, permissions: []
  });
  let managerWithoutPermissionRejected = false;
  try {
    await authorizeTableManager(
      db,
      { verifyIdToken: async () => ({ uid: 'manager-no-qr', role: 'manager', sessionVersion: 0 }) },
      { headers: { authorization: 'Bearer manager-no-qr-token' } },
      'chez-awa'
    );
  } catch { managerWithoutPermissionRejected = true; }
  assert(managerWithoutPermissionRejected, 'Un manager sans tables.manage ne peut pas administrer les QR');

  const managerServiceWithoutTablePermission = await updateRestaurantServiceStatus(
    db,
    { verifyIdToken: async () => ({ uid: 'manager-no-qr', role: 'manager', sessionVersion: 0 }) },
    { method: 'POST', headers: { authorization: 'Bearer manager-no-qr-token' } },
    'chez-awa',
    false
  );
  assert(managerServiceWithoutTablePermission.success && db.store.get('restaurants/chez-awa').isOpen === false,
    'Un manager actif peut fermer le service sans permission tables.manage');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), isOpen: true });

  let missingRotatedKeyRejected = false;
  try {
    await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example', {
      TABLE_QR_TOKEN_ENCRYPTION_KEY: process.env.TABLE_QR_TOKEN_ENCRYPTION_KEY,
      TABLE_QR_TOKEN_ENCRYPTION_KEY_VERSION: '2'
    });
  } catch { missingRotatedKeyRejected = true; }
  assert(missingRotatedKeyRejected,
    'La rotation QR refuse une clé V2 absente au lieu de réutiliser silencieusement la clé historique');
  const explicitV2Key = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  let explicitRotatedKeyAccepted = false;
  try {
    const rotated = await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example', {
      TABLE_QR_TOKEN_ENCRYPTION_KEY: process.env.TABLE_QR_TOKEN_ENCRYPTION_KEY,
      TABLE_QR_TOKEN_ENCRYPTION_KEY_V2: explicitV2Key,
      TABLE_QR_TOKEN_ENCRYPTION_KEY_VERSION: '2'
    });
    explicitRotatedKeyAccepted = Boolean(rotated.token);
  } catch {}
  assert(explicitRotatedKeyAccepted, 'Une clé QR V2 explicitement configurée est acceptée');
  // Restore a clean QR for the remaining lifecycle assertions.
  for (const storedPath of [...db.store.keys()]) {
    if (storedPath.startsWith('restaurants/chez-awa/table_qr_tokens/')) db.store.delete(storedPath);
  }
  db.store.set('restaurants/chez-awa/tables/table-4', {
    ...db.store.get('restaurants/chez-awa/tables/table-4'), qrVersion: 0
  });
  const issued = await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example');
  const token = issued.url.split('/q/')[1];
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), isOpen: false });
  let closedRestaurantQrRejected = false;
  try { await resolveTableQr(db, token); } catch { closedRestaurantQrRejected = true; }
  assert(closedRestaurantQrRejected, 'Un QR ne crée aucune session lorsque le service est fermé');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), isOpen: true });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'provisioning' });
  let provisioningSessionRejected = false;
  try { await resolveTableQr(db, token); } catch { provisioningSessionRejected = true; }
  assert(provisioningSessionRejected, 'Un QR ne peut pas créer de session pour un restaurant provisioning');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'active' });
  const storedToken = db.store.get('restaurants/chez-awa/table_qr_tokens/' + tokenHash);
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), 'Jeton QR aléatoire de 256 bits au format Base64URL');
  assert(issued.url.startsWith('https://restaumax.example/q/'), 'URL QR opaque /q/<token>');
  assert(storedToken?.tokenHash === tokenHash && !JSON.stringify(storedToken).includes(token), 'Le jeton brut n’est jamais stocké en clair (empreinte SHA-256 + enveloppe chiffrée)');
  assert(storedToken?.encryptedToken?.algorithm === 'aes-256-gcm' && !JSON.stringify(storedToken).includes(token),
    'Jeton récupérable uniquement depuis son enveloppe AES-256-GCM chiffrée côté serveur');
  assert(storedToken?.encryptedToken?.version === 2 && storedToken?.encryptedToken?.keyVersion === 1,
    'Les nouvelles enveloppes QR sont versionnées pour permettre la rotation des clés');
  db.store.set('restaurants/restaurant-b', { slug: 'restaurant-b', status: 'active', isActive: true, isOpen: true });
  db.store.set('restaurants/restaurant-b/tables/table-4', { id: 'table-4', tableNumber: '4', isActive: true, qrVersion: 1 });
  db.store.set('restaurants/restaurant-b/table_qr_tokens/' + tokenHash, {
    ...storedToken, restaurantSlug: 'restaurant-b', tableId: 'table-4'
  });
  let crossTenantCiphertextRejected = false;
  try { await getActiveTableQr(db, 'restaurant-b', 'table-4', 'https://restaumax.example'); }
  catch { crossTenantCiphertextRejected = true; }
  assert(crossTenantCiphertextRejected, 'L’AES-GCM AAD lie le jeton QR au restaurant et à la table d’origine');
  db.store.delete('restaurants/restaurant-b/table_qr_tokens/' + tokenHash);
  db.store.delete('restaurants/restaurant-b/tables/table-4');
  db.store.delete('restaurants/restaurant-b');
  const restoredQr = await getActiveTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example');
  assert(restoredQr?.url === issued.url && restoredQr.token === token,
    'URL QR identique restaurée après rechargement sans rotation ni changement du jeton');
  const previewQrOrigin = resolveTableQrOrigin({
    headers: {
      host: 'restaumax-preview.vercel.app',
      'x-forwarded-host': 'restaumax-preview.vercel.app',
      'x-forwarded-proto': 'https'
    }
  }, { VERCEL_ENV: 'preview', APP_ORIGIN: 'https://restaumax.vercel.app' });
  const previewRestoredQr = await getActiveTableQr(db, 'chez-awa', 'table-4', previewQrOrigin);
  assert(previewRestoredQr?.token === token && previewRestoredQr.url.startsWith('https://restaumax-preview.vercel.app/q/'),
    'La restauration d’un QR existant en Preview conserve le domaine Preview au lieu du domaine Production');
  assert(db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion === 1, 'Version QR incrémentée sur la table');

  // Two tenants may use the same local table ID, but QR resolution must remain
  // bound to the restaurant stored with each token.
  db.store.set('restaurants/restaumax-demo', {
    slug: 'restaumax-demo', status: 'active', isActive: true, isOpen: true
  });
  db.store.set('restaurants/restaumax-demo/private/ownership', { ownerUid: 'demo-owner' });
  db.store.set('restaurants/restaumax-demo/tables/table-4', {
    id: 'table-4', tableNumber: 'D-4', isActive: true, qrVersion: 0
  });
  const demoIssued = await issueTableQr(db, 'restaumax-demo', 'table-4', 'https://restaumax.example');
  const demoResolved = await resolveTableQr(db, demoIssued.token);
  const chezResolved = await resolveTableQr(db, token);
  assert(demoResolved.restaurantSlug === 'restaumax-demo' && demoResolved.tableNumber === 'D-4',
    'Le QR Démo ouvre uniquement la table D-4 du restaurant Démo');
  assert(chezResolved.restaurantSlug === 'chez-awa' && chezResolved.tableNumber === '4',
    'Le QR Chez Awa reste lié à sa propre table 4 malgré le même identifiant dans Démo');

  // Legacy QR records predate encrypted persistence. A restore must refuse
  // to reconstruct plaintext from the hash alone; the manager then rotates once.
  db.store.set('restaurants/chez-awa/tables/table-legacy', {
    id: 'table-legacy', tableNumber: 'L', isActive: true, qrVersion: 0
  });
  const legacyIssued = await issueTableQr(db, 'chez-awa', 'table-legacy', 'https://restaumax.example');
  const legacyHash = crypto.createHash('sha256').update(legacyIssued.token).digest('hex');
  const legacyRef = 'restaurants/chez-awa/table_qr_tokens/' + legacyHash;
  const legacyRecord = { ...db.store.get(legacyRef) };
  delete legacyRecord.encryptedToken;
  db.store.set(legacyRef, legacyRecord);
  assert(await getActiveTableQr(db, 'chez-awa', 'table-legacy', 'https://restaumax.example') === null,
    'Un ancien jeton sans enveloppe chiffrée ne peut pas être restauré depuis son hash seul');
  const migratedIssued = await issueTableQr(db, 'chez-awa', 'table-legacy', 'https://restaumax.example');
  assert(migratedIssued.token !== legacyIssued.token,
    'La migration d’un ancien QR émet un nouveau jeton et invalide l’ancien');

  const resolved = await resolveTableQr(db, token);
  const session = await getActiveTableSession(db, resolved.sessionSecret);
  assert(session?.tableNumber === '4', 'Résolution QR et création de session liée à la table');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'provisioning' });
  assert(await getActiveTableSession(db, resolved.sessionSecret) === null, 'Une session existante est refusée si le restaurant repasse en provisioning');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'active' });
  assert(validateCsrf(session, resolved.csrfToken), 'Jeton CSRF valide accepté');
  assert(!validateCsrf(session, 'csrf-invalide'), 'Jeton CSRF invalide rejeté');
  assert(session.restaurantSessionVersion === 0, 'La session mémorise la version de sécurité du restaurant');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), tableSessionVersion: 1, status: 'suspended' });
  assert(await getActiveTableSession(db, resolved.sessionSecret) === null, 'Une suspension invalide immédiatement les sessions antérieures');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), tableSessionVersion: 1, status: 'active' });
  assert(await getActiveTableSession(db, resolved.sessionSecret) === null, 'Une ancienne session reste invalide après réactivation du restaurant');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), tableSessionVersion: 0 });
  assert(buildSessionCookie(resolved.sessionSecret).includes('HttpOnly; Secure; SameSite=Lax; Path=/'), 'Cookie de session HttpOnly, Secure, SameSite=Lax et Path=/');
  assert(buildCsrfCookie(resolved.csrfToken).includes('Secure; SameSite=Strict; Path=/'), 'Cookie CSRF Secure, SameSite=Strict et Path=/');
  assert(readCookie('__Host-rm_table_session=' + encodeURIComponent(resolved.sessionSecret), '__Host-rm_table_session') === resolved.sessionSecret, 'Lecture sûre du cookie de session');
  assert(requestHasValidOrigin({ headers: { origin: 'https://restaumax.example', host: 'restaumax.example', 'x-forwarded-proto': 'https' } }), 'Origine strictement identique acceptée');
  assert(!requestHasValidOrigin({ headers: { origin: 'https://attacker.example', host: 'restaumax.example', 'x-forwarded-proto': 'https' } }), 'Origine tierce rejetée');
  assert(isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' } }), 'Ouverture directe par scan QR acceptée');
  assert(isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document', host: 'restaumax.example', 'x-forwarded-proto': 'https', referer: 'https://restaumax.example/menu' } }), 'Navigation QR depuis l’application acceptée');
  assert(isTrustedQrNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }), 'Ouverture QR caméra externe autorisée en navigation document GET');
  assert(!isTrustedQrNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'empty' } }), 'Navigation QR cross-site non-document rejetée');
  assert(!isTrustedQrNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), 'Navigation QR cross-site sans preuve de document rejetée');
  assert(!isTrustedQrNavigation({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }), 'POST cross-site rejeté');
  assert(!isTrustedQrNavigation({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document', referer: 'https://attacker.example/' } }), 'Referer tiers rejeté');
  assert(!isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'document' } }), 'Navigation depuis un sous-domaine tiers rejetée');
  assert(!isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe', host: 'restaumax.example', 'x-forwarded-proto': 'https' } }), 'Résolution QR intégrée dans une iframe rejetée');
  assert(!isTrustedQrNavigation({ headers: { host: 'restaumax.example', 'x-forwarded-proto': 'https', referer: 'https://attacker.example/redirect' } }), 'Referer externe rejeté pour le bootstrap QR');

  const revoked = await revokeTableQr(db, 'chez-awa', 'table-4');
  assert(revoked.revoked === 1, 'Révocation immédiate du QR actif');
  assert(await getActiveTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example') === null,
    'Un QR révoqué ne peut pas être restauré par le point d’entrée GET');
  assert(revoked.versionAdvanced === true && db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion === 2,
    'La révocation incrémente atomiquement la version de table pour invalider les sessions et sérialiser une rotation concurrente');
  assert(await getActiveTableSession(db, resolved.sessionSecret) === null, 'Session existante invalidée immédiatement après révocation');
  let oldTokenRejected = false;
  try { await resolveTableQr(db, token); } catch { oldTokenRejected = true; }
  assert(oldTokenRejected, 'Ancien QR révoqué ne peut plus ouvrir de session');

  const versionBeforeRotation = db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion;
  const rotated = await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example');
  assert(rotated.token !== token, 'Rotation émet un nouveau jeton distinct');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'deleted', deletedAt: Date.now() });
  let deletedRestaurantRejected = false;
  try { await resolveTableQr(db, rotated.token); } catch { deletedRestaurantRejected = true; }
  assert(deletedRestaurantRejected, 'Un QR ne peut pas ouvrir de session pour un restaurant supprimé logiquement');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'active', deletedAt: undefined });
  assert(db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion === versionBeforeRotation + 1, 'Rotation incrémente la version de table après révocation');
  let inactiveRejected = false;
  db.store.set('restaurants/chez-awa/tables/table-4', { ...db.store.get('restaurants/chez-awa/tables/table-4'), isActive: false });
  try { await resolveTableQr(db, rotated.token); } catch { inactiveRejected = true; }
  assert(inactiveRejected, 'QR d’une table inactive refusé');

  console.log('Résultats QR : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
  if (failed) process.exitCode = 1;
}
run().catch((error) => { console.error('Échec inattendu des tests QR :', error); process.exitCode = 1; });
