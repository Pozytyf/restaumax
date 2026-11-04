import crypto from 'node:crypto';
import {
  issueTableQr, resolveTableQr, getActiveTableSession, revokeTableQr,
  buildSessionCookie, buildCsrfCookie, readCookie, validateCsrf, requestHasValidOrigin, isTrustedQrNavigation,
  authorizeTableManager
} from '../src/server/tableSecurityService.ts';

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
  db.store.set('restaurants/chez-awa/tables/table-4', { id: 'table-4', tableNumber: '4', isActive: true, qrVersion: 0 });

  let provisioningQrRejected = false;
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'provisioning' });
  try { await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example'); }
  catch { provisioningQrRejected = true; }
  assert(provisioningQrRejected, 'Un restaurant provisioning ne peut pas émettre de QR');
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

  const issued = await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example');
  const token = issued.url.split('/q/')[1];
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const storedToken = db.store.get('restaurants/chez-awa/table_qr_tokens/' + tokenHash);
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), 'Jeton QR aléatoire de 256 bits au format Base64URL');
  assert(issued.url.startsWith('https://restaumax.example/q/'), 'URL QR opaque /q/<token>');
  assert(storedToken?.tokenHash === tokenHash && !JSON.stringify(storedToken).includes(token), 'Seule l’empreinte SHA-256 du jeton est stockée');
  assert(db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion === 1, 'Version QR incrémentée sur la table');

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
  assert(!isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }), 'Navigation de bootstrap QR cross-site rejetée');
  assert(!isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'document' } }), 'Navigation depuis un sous-domaine tiers rejetée');
  assert(!isTrustedQrNavigation({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe', host: 'restaumax.example', 'x-forwarded-proto': 'https' } }), 'Résolution QR intégrée dans une iframe rejetée');
  assert(!isTrustedQrNavigation({ headers: { host: 'restaumax.example', 'x-forwarded-proto': 'https', referer: 'https://attacker.example/redirect' } }), 'Referer externe rejeté pour le bootstrap QR');

  const revoked = await revokeTableQr(db, 'chez-awa', 'table-4');
  assert(revoked.revoked === 1, 'Révocation immédiate du QR actif');
  assert(await getActiveTableSession(db, resolved.sessionSecret) === null, 'Session existante invalidée immédiatement après révocation');
  let oldTokenRejected = false;
  try { await resolveTableQr(db, token); } catch { oldTokenRejected = true; }
  assert(oldTokenRejected, 'Ancien QR révoqué ne peut plus ouvrir de session');

  const rotated = await issueTableQr(db, 'chez-awa', 'table-4', 'https://restaumax.example');
  assert(rotated.token !== token, 'Rotation émet un nouveau jeton distinct');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'deleted', deletedAt: Date.now() });
  let deletedRestaurantRejected = false;
  try { await resolveTableQr(db, rotated.token); } catch { deletedRestaurantRejected = true; }
  assert(deletedRestaurantRejected, 'Un QR ne peut pas ouvrir de session pour un restaurant supprimé logiquement');
  db.store.set('restaurants/chez-awa', { ...db.store.get('restaurants/chez-awa'), status: 'active', deletedAt: undefined });
  assert(db.store.get('restaurants/chez-awa/tables/table-4')?.qrVersion === 2, 'Rotation incrémente la version de table');
  let inactiveRejected = false;
  db.store.set('restaurants/chez-awa/tables/table-4', { ...db.store.get('restaurants/chez-awa/tables/table-4'), isActive: false });
  try { await resolveTableQr(db, rotated.token); } catch { inactiveRejected = true; }
  assert(inactiveRejected, 'QR d’une table inactive refusé');

  console.log('Résultats QR : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
  if (failed) process.exitCode = 1;
}
run().catch((error) => { console.error('Échec inattendu des tests QR :', error); process.exitCode = 1; });
