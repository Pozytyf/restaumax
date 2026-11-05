import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  encryptPaymentSecret,
  decryptPaymentSecret,
  saveJekoPaymentConfigWithDb,
  getJekoPaymentConfigStatusWithDb,
  getJekoPaymentConfigWithDb,
  deleteJekoPaymentConfigWithDb
} from '../src/server/paymentProviderConfigService.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

async function run() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('JEKO CONFIG : ignoré (Firestore Emulator non actif).');
    return;
  }

  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-jeko-config-tests');
  const db = getFirestore(app, config.firestoreDatabaseId);
  const encryptionKey = Buffer.alloc(32, 23).toString('base64');
  const slug = 'jeko-config-' + Date.now();
  const ownerUid = 'owner-' + Date.now();
  const managerUid = 'manager-' + Date.now();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const ownerRef = db.collection('managers').doc(ownerUid);
  const managerRef = db.collection('managers').doc(managerUid);
  const store1 = '11111111-1111-4111-8111-111111111111';
  const store2 = '22222222-2222-4222-8222-222222222222';
  const input = (storeId = store1) => ({
    apiKey: 'JEKO_PRIVATE_TEST_API_KEY_12345',
    apiKeyId: 'JEKO_KEY_ID_TEST_12345',
    storeId,
    webhookSecret: 'JEKO_WEBHOOK_SECRET_TEST_12345'
  });

  try {
    console.log('\n--- Chiffrement des secrets ---');
    const encrypted = encryptPaymentSecret('private-provider-secret', encryptionKey);
    assert(encrypted !== 'private-provider-secret' && encrypted.startsWith('v1:'),
      'Le secret est chiffré avec un format versionné');
    assert(decryptPaymentSecret(encrypted, encryptionKey) === 'private-provider-secret',
      'Le déchiffrement restitue exactement le secret');
    let tamperRejected = false;
    try { decryptPaymentSecret(encrypted.slice(0, -2) + 'AA', encryptionKey); } catch { tamperRejected = true; }
    assert(tamperRejected, 'Une altération du texte chiffré est détectée par AES-GCM');

    await restaurantRef.set({ slug, status: 'active', ownerUid });
    await ownerRef.set({ uid: ownerUid, role: 'owner', restaurantSlug: slug, active: true, sessionVersion: 4 });
    await managerRef.set({ uid: managerUid, role: 'manager', restaurantSlug: slug, active: true, sessionVersion: 2 });

    console.log('\n--- Configuration propriétaire ---');
    const saved = await saveJekoPaymentConfigWithDb(db, slug, ownerUid, 4, input(), encryptionKey);
    assert(saved.success === true && saved.status?.configured === true,
      'Le propriétaire actif peut enregistrer le compte Jèko');

    const rawConfig = (await restaurantRef.collection('private_integrations').doc('payment_provider').get()).data();
    assert(rawConfig?.apiKeyEncrypted && rawConfig?.apiKeyIdEncrypted && rawConfig?.webhookSecretEncrypted &&
      !JSON.stringify(rawConfig).includes(input().apiKey) &&
      !JSON.stringify(rawConfig).includes(input().webhookSecret),
      'Aucun secret API ou webhook n’est stocké en clair dans Firestore');

    const decrypted = await getJekoPaymentConfigWithDb(db, slug, encryptionKey);
    assert(decrypted?.apiKey === input().apiKey && decrypted?.apiKeyId === input().apiKeyId &&
      decrypted?.webhookSecret === input().webhookSecret && decrypted?.storeId === store1,
      'Le serveur peut déchiffrer les identifiants du restaurant');

    const status = await getJekoPaymentConfigStatusWithDb(db, slug);
    assert(status.configured && status.storeIdMasked?.endsWith(store1.slice(-6)) &&
      !JSON.stringify(status).includes(input().apiKey),
      'Le statut public masque le Store ID et ne divulgue aucun secret');

    console.log('\n--- Autorisations et isolation multi-restaurant ---');
    const managerSave = await saveJekoPaymentConfigWithDb(db, slug, managerUid, 2, input(), encryptionKey);
    assert(managerSave.success === false, 'Un manager ne peut pas modifier les clés du propriétaire');

    const otherSlug = slug + '-other';
    const otherRestaurant = db.collection('restaurants').doc(otherSlug);
    const otherOwnerUid = ownerUid + '-other';
    const otherOwner = db.collection('managers').doc(otherOwnerUid);
    await otherRestaurant.set({ slug: otherSlug, status: 'active', ownerUid: otherOwnerUid });
    await otherOwner.set({ uid: otherOwnerUid, role: 'owner', restaurantSlug: otherSlug, active: true, sessionVersion: 1 });
    const collision = await saveJekoPaymentConfigWithDb(db, otherSlug, otherOwnerUid, 1, input(store1), encryptionKey);
    assert(collision.success === false, 'Un Store ID déjà lié ne peut pas être réutilisé par un autre restaurant');

    console.log('\n--- Rotation et retrait des identifiants ---');
    const rotated = await saveJekoPaymentConfigWithDb(db, slug, ownerUid, 4, input(store2), encryptionKey);
    const oldMap = await db.collection('payment_provider_stores').doc(store1).get();
    const newMap = await db.collection('payment_provider_stores').doc(store2).get();
    assert(rotated.success && !oldMap.exists && newMap.exists && newMap.data()?.restaurantSlug === slug,
      'La rotation du Store ID remplace proprement le mapping webhook');

    const deleted = await deleteJekoPaymentConfigWithDb(db, slug, ownerUid, 4);
    const finalConfig = await getJekoPaymentConfigStatusWithDb(db, slug);
    const finalMap = await db.collection('payment_provider_stores').doc(store2).get();
    assert(deleted.success && !finalConfig.configured && !finalMap.exists,
      'Le retrait supprime la configuration et le mapping webhook');

    console.log('\nRésultats configuration Jèko : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
    if (failed) process.exitCode = 1;
  } finally {
    for (const ref of [restaurantRef, ownerRef, managerRef]) { try { await ref.delete(); } catch {} }
    const otherSlug = slug + '-other';
    const otherOwnerUid = ownerUid + '-other';
    try { await db.collection('restaurants').doc(otherSlug).delete(); } catch {}
    try { await db.collection('managers').doc(otherOwnerUid).delete(); } catch {}
    try { await db.collection('payment_provider_stores').doc(store1).delete(); } catch {}
    try { await db.collection('payment_provider_stores').doc(store2).delete(); } catch {}
    try { await app.delete(); } catch {}
  }
}

run().catch((error) => {
  console.error('Échec inattendu des tests de configuration Jèko :', error);
  process.exitCode = 1;
});
