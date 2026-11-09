import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { LEGACY_MIGRATION_ID, migrateOneRestaurant, scanLegacyPrivateData } from './migrate-legacy-restaurant-private-data.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('This test must run inside firebase emulators:exec.');
}
const app = initializeApp({
  projectId: 'demo-restaumax',
  credential: { getAccessToken: async () => ({ access_token: 'emulator-test-token', expires_in: 3600 }) }
}, 'legacy-private-migration-test');
const db = getFirestore(app);
const slug = `migration-legacy-test-${Date.now()}`;
const restaurantRef = db.collection('restaurants').doc(slug);
const conflictRef = db.collection('restaurants').doc(`${slug}-owner-conflict`);
const unknownRef = db.collection('restaurants').doc(`${slug}-unknown-field`);
const backupConflictRef = db.collection('restaurants').doc(`${slug}-backup-conflict`);

try {
  await restaurantRef.set({
    slug, name: 'Legacy Restaurant', isOpen: true, status: 'active',
    ownerUid: 'owner-legacy', ownerName: 'Legacy Owner',
    ownerEmail: 'legacy@example.test', createdBy: 'admin-legacy',
    subscription: { planName: 'starter', status: 'active', priceFcfa: 10000 }
  });
  await restaurantRef.collection('private').doc('ownership').set({
    ownerName: 'Canonical Owner'
  });

  const scan = await scanLegacyPrivateData(db, [await restaurantRef.get()]);
  assert.equal(scan.restaurantsScanned, 1, 'focused dry-run scans only the selected restaurant');
  assert(scan.restaurantsNeedingMigration >= 1, 'dry-run detects legacy private restaurant metadata');
  assert(scan.privateFieldCounts.ownerUid >= 1, 'dry-run counts legacy ownerUid without printing values');
  assert.equal(scan.ownerUidConflicts, 0, 'matching/missing canonical owner does not create a conflict');

  const result = await migrateOneRestaurant(db, restaurantRef, 'test-admin');
  assert.equal(result.migrated, true, 'legacy document is migrated');
  assert.equal(result.fieldsMoved, 4, 'four legacy ownership fields moved');
  assert.equal(result.subscriptionMoved, true, 'subscription moved to canonical collection');

  const [migratedRoot, ownership, backup, subscription, audit] = await Promise.all([
    restaurantRef.get(),
    restaurantRef.collection('private').doc('ownership').get(),
    restaurantRef.collection('private').doc('ownership').collection('migration_backups').doc('legacy-private-v1').get(),
    db.collection('restaurantSubscriptions').doc(slug).get(),
    db.collection('admin_audit_logs').doc(`migrate_restaurant_private_${slug}_legacy-private-v1`).get()
  ]);
  assert.equal(migratedRoot.data().ownerUid, undefined, 'public restaurant root no longer contains ownerUid');
  assert.equal(migratedRoot.data().ownerEmail, undefined, 'public restaurant root no longer contains ownerEmail');
  assert.equal(ownership.data().ownerUid, 'owner-legacy', 'ownerUid moved to private ownership document');
  assert.equal(ownership.data().ownerName, 'Canonical Owner', 'existing canonical ownership value is preserved');
  assert.equal(backup.exists, true, 'sensitive legacy values are preserved in server-only backup');
  assert.equal(subscription.data().planName, 'starter', 'subscription moved to canonical subscription document');
  assert.equal(audit.data().action, 'migrate_restaurant_private_metadata', 'migration audit record created');

  const rerun = await migrateOneRestaurant(db, restaurantRef, 'test-admin');
  assert.equal(rerun.migrated, false, 'migration is idempotent');

  await conflictRef.set({
    slug: conflictRef.id, name: 'Conflict', isOpen: true, ownerUid: 'owner-b'
  });
  await conflictRef.collection('private').doc('ownership').set({ ownerUid: 'owner-a' });
  await unknownRef.set({
    slug: unknownRef.id, name: 'Unknown', isOpen: true, unexpectedPrivateField: 'keep'
  });
  await assert.rejects(
    migrateOneRestaurant(db, conflictRef, 'test-admin'),
    /Conflit ownerUid/
  );
  await assert.rejects(
    migrateOneRestaurant(db, unknownRef, 'test-admin'),
    /Champs restaurant non reconnus/
  );
  const [conflictRoot, unknownRoot] = await Promise.all([conflictRef.get(), unknownRef.get()]);
  assert.equal(conflictRoot.data().ownerUid, 'owner-b', 'ownerUid conflict is not overwritten');
  assert.equal(unknownRoot.data().unexpectedPrivateField, 'keep', 'unknown fields are never deleted');

  await backupConflictRef.set({
    slug: backupConflictRef.id, name: 'Backup conflict', isOpen: true, ownerUid: 'owner-c'
  });
  await backupConflictRef.collection('private').doc('ownership')
    .collection('migration_backups').doc(LEGACY_MIGRATION_ID).set({
      sourceRootPrivateFields: { ownerUid: 'older-owner-value' }
    });
  const backupScan = await scanLegacyPrivateData(db, [await backupConflictRef.get()]);
  assert.equal(backupScan.backupConflicts, 1, 'preflight detects an existing backup while legacy fields remain');
  await assert.rejects(
    migrateOneRestaurant(db, backupConflictRef, 'test-admin'),
    /Sauvegarde existante/
  );
  const backupConflictRoot = await backupConflictRef.get();
  assert.equal(backupConflictRoot.data().ownerUid, 'owner-c', 'existing backup conflict never deletes current root data');

  console.log('Legacy private metadata migration emulator tests passed.');
} finally {
  await Promise.all([
    db.recursiveDelete(restaurantRef),
    db.recursiveDelete(conflictRef),
    db.recursiveDelete(unknownRef),
    db.recursiveDelete(backupConflictRef),
    db.collection('restaurantSubscriptions').doc(slug).delete().catch(() => {}),
    db.collection('admin_audit_logs').doc(`migrate_restaurant_private_${slug}_legacy-private-v1`).delete().catch(() => {})
  ]);
  await app.delete();
}
