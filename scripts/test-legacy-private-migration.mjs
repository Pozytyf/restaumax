import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { migrateOneRestaurant, scanLegacyPrivateData } from './migrate-legacy-restaurant-private-data.mjs';

const env = await initializeTestEnvironment({ projectId: 'demo-restaumax' });
const db = env.unauthenticatedContext().firestore();
const slug = 'migration-legacy-test';

try {
  await env.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, `restaurants/${slug}`), {
      slug, name: 'Legacy Restaurant', isOpen: true, status: 'active',
      ownerUid: 'owner-legacy', ownerName: 'Legacy Owner',
      ownerEmail: 'legacy@example.test', createdBy: 'admin-legacy',
      subscription: { planName: 'starter', status: 'active', priceFcfa: 10000 }
    });
    await setDoc(doc(firestore, `restaurants/${slug}/private/ownership`), {
      ownerName: 'Canonical Owner'
    });
  });

  const scan = await scanLegacyPrivateData(db);
  assert(scan.restaurantsNeedingMigration >= 1, 'dry-run detects legacy private restaurant metadata');
  assert(scan.privateFieldCounts.ownerUid >= 1, 'dry-run counts legacy ownerUid without printing values');
  assert.equal(scan.ownerUidConflicts, 0, 'matching/missing canonical owner does not create a conflict');

  const result = await env.withSecurityRulesDisabled(async context =>
    migrateOneRestaurant(context.firestore(), doc(context.firestore(), `restaurants/${slug}`), 'test-admin', deleteField)
  );
  assert.equal(result.migrated, true, 'legacy document is migrated');
  assert.equal(result.fieldsMoved, 4, 'four legacy ownership fields moved');
  assert.equal(result.subscriptionMoved, true, 'subscription moved to canonical collection');

  const migratedRoot = await getDoc(doc(db, `restaurants/${slug}`));
  const ownership = await getDoc(doc(db, `restaurants/${slug}/private/ownership`));
  const backup = await getDoc(doc(db, `restaurants/${slug}/private/ownership/migration_backups/legacy-private-v1`));
  const subscription = await getDoc(doc(db, `restaurantSubscriptions/${slug}`));
  const audit = await getDoc(doc(db, `admin_audit_logs/migrate_restaurant_private_${slug}_legacy-private-v1`));
  assert.equal(migratedRoot.data().ownerUid, undefined, 'public restaurant root no longer contains ownerUid');
  assert.equal(migratedRoot.data().ownerEmail, undefined, 'public restaurant root no longer contains ownerEmail');
  assert.equal(ownership.data().ownerUid, 'owner-legacy', 'ownerUid moved to private ownership document');
  assert.equal(ownership.data().ownerName, 'Canonical Owner', 'existing canonical ownership value is preserved');
  assert.equal(backup.exists(), true, 'sensitive legacy values are preserved in server-only backup');
  assert.equal(subscription.data().planName, 'starter', 'subscription moved to canonical subscription document');
  assert.equal(audit.data().action, 'migrate_restaurant_private_metadata', 'migration audit record created');

  const rerun = await env.withSecurityRulesDisabled(async context =>
    migrateOneRestaurant(context.firestore(), doc(context.firestore(), `restaurants/${slug}`), 'test-admin', deleteField)
  );
  assert.equal(rerun.migrated, false, 'migration is idempotent');

  await env.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'restaurants/migration-owner-conflict'), {
      slug: 'migration-owner-conflict', name: 'Conflict', isOpen: true, ownerUid: 'owner-b'
    });
    await setDoc(doc(firestore, 'restaurants/migration-owner-conflict/private/ownership'), {
      ownerUid: 'owner-a'
    });
    await setDoc(doc(firestore, 'restaurants/migration-unknown-field'), {
      slug: 'migration-unknown-field', name: 'Unknown', isOpen: true, unexpectedPrivateField: 'keep'
    });
  });
  await assert.rejects(
    env.withSecurityRulesDisabled(async context => migrateOneRestaurant(
      context.firestore(), doc(context.firestore(), 'restaurants/migration-owner-conflict'), 'test-admin', deleteField
    )),
    /Conflit ownerUid/
  );
  await assert.rejects(
    env.withSecurityRulesDisabled(async context => migrateOneRestaurant(
      context.firestore(), doc(context.firestore(), 'restaurants/migration-unknown-field'), 'test-admin', deleteField
    )),
    /Champs restaurant non reconnus/
  );

  console.log('Legacy private metadata migration emulator tests passed.');
} finally {
  await env.cleanup();
}
