/**
 * Migration ciblée des métadonnées privées historiques — RestauMax Demo uniquement.
 *
 * Cible immuable : projet restaumax-demo / base (default).
 * Dry-run par défaut. --apply exige MIGRATE_RESTAUMAX_DEMO_PRIVATE_METADATA.
 * Aucun document Production n'est accessible via cette configuration.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const DEMO_TARGET = Object.freeze({
  projectId: 'restaumax-demo',
  databaseId: '(default)',
});

export function validateDemoMigrationTarget(env = process.env) {
  if (env.FIREBASE_PROJECT_ID?.trim() !== DEMO_TARGET.projectId) {
    throw new Error("Migration refusée : FIREBASE_PROJECT_ID doit être exactement 'restaumax-demo'.");
  }
  if (env.FIRESTORE_DATABASE_ID?.trim() !== DEMO_TARGET.databaseId) {
    throw new Error("Migration refusée : FIRESTORE_DATABASE_ID doit être exactement '(default)'.");
  }
  return true;
}

export async function migrateOneRestaurant(db, restaurantRef, actorUid = 'github-actions-demo-migration', apply = false) {
  const slug = String(restaurantRef.id || '');
  const ownershipRef = restaurantRef.collection('private').doc('ownership');
  const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
  return db.runTransaction(async (tx) => {
    const [restaurantSnap, ownershipSnap, subscriptionSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(ownershipRef), tx.get(subscriptionRef),
    ]);
    if (!restaurantSnap.exists) return { slug, migrated: false, reason: 'missing' };
    const restaurant = restaurantSnap.data() || {};
    const existing = ownershipSnap.exists ? ownershipSnap.data() || {} : {};
    const privateFields = [
      'ownerUid', 'ownerName', 'ownerEmail', 'createdBy', 'updatedBy',
      'deletedBy', 'suspendedBy', 'ownerRemovedBy', 'serviceStatusUpdatedBy',
    ];
    const legacy = Object.fromEntries(privateFields
      .filter((key) => restaurant[key] !== undefined)
      .map((key) => [key, restaurant[key]]));

    if (existing.ownerUid && legacy.ownerUid && existing.ownerUid !== legacy.ownerUid) {
      throw new Error(`Conflit d’identité propriétaire pour le restaurant ${slug}. Migration interrompue.`);
    }

    const merged = { ...existing };
    for (const [key, value] of Object.entries(legacy)) {
      if (merged[key] === undefined) merged[key] = value;
    }
    const hasLegacySubscription = restaurant.subscription !== undefined;
    const moveSubscription = hasLegacySubscription && !subscriptionSnap.exists &&
      restaurant.subscription && typeof restaurant.subscription === 'object';
    const removals = {};
    for (const key of [...privateFields, 'subscription']) {
      if (restaurant[key] !== undefined) removals[key] = FieldValue.delete();
    }
    const hasChanges = Object.keys(removals).length > 0;

    if (apply && hasChanges) {
      const now = Date.now();
      if (Object.keys(legacy).length) {
        tx.set(ownershipRef, { ...merged, migratedAt: now, migratedBy: actorUid }, { merge: true });
      }
      if (moveSubscription) tx.create(subscriptionRef, restaurant.subscription);
      tx.update(restaurantRef, removals);
      tx.create(db.collection('admin_audit_logs').doc(`migrate_restaurant_private_${slug}_${now}`), {
        action: 'migrate_restaurant_private_metadata',
        restaurantSlug: slug,
        actorUid,
        ownerMetadataMoved: Object.keys(legacy).length > 0,
        subscriptionMoved: moveSubscription,
        fieldsMoved: Object.keys(legacy),
        createdAt: now,
      });
    }
    return {
      slug,
      migrated: hasChanges,
      mode: apply ? 'apply' : 'dry-run',
      ownerFields: Object.keys(legacy),
      subscriptionPresent: hasLegacySubscription,
      subscriptionWillMove: moveSubscription,
    };
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
    throw new Error('Seule l’option --apply est acceptée. Sans cette option, mode dry-run.');
  }
  validateDemoMigrationTarget();
  if (apply && process.env.MIGRATION_CONFIRMATION !== 'MIGRATE_RESTAUMAX_DEMO_PRIVATE_METADATA') {
    throw new Error('Confirmation explicite absente : migration Demo annulée.');
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: DEMO_TARGET.projectId,
  }, 'restaumax-demo-private-metadata-migration');
  const db = getFirestore(app, DEMO_TARGET.databaseId);
  const restaurants = await db.collection('restaurants').get();
  const results = [];
  for (const restaurantDoc of restaurants.docs) {
    results.push(await migrateOneRestaurant(db, restaurantDoc.ref, 'github-actions-demo-migration', apply));
  }
  console.log(JSON.stringify({
    projectId: DEMO_TARGET.projectId,
    databaseId: DEMO_TARGET.databaseId,
    mode: apply ? 'apply' : 'dry-run',
    restaurantsScanned: restaurants.size,
    restaurantsWithLegacyData: results.filter((result) => result.migrated).length,
    results,
  }, null, 2));
  await app.delete();
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error('Migration Demo interrompue :', error.message);
    process.exitCode = 1;
  });
}
