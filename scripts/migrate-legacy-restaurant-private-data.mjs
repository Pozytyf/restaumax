import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const LEGACY_PRIVATE_FIELDS = [
  'ownerUid', 'ownerName', 'ownerEmail', 'createdBy', 'updatedBy',
  'deletedBy', 'suspendedBy', 'ownerRemovedBy', 'ownerRemovedAt',
  'serviceStatusUpdatedBy'
];
export const PUBLIC_RESTAURANT_FIELDS = [
  'slug', 'name', 'isOpen', 'tagline', 'address', 'city', 'phone',
  'currency', 'bannerUrl', 'logoUrl', 'openingHours', 'taxRatePercent',
  'taxMode', 'loyaltyFcfaPerPoint', 'receiptFooter', 'receiptPaperWidth',
  'status', 'createdAt', 'updatedAt', 'country', 'serviceStatusUpdatedAt',
  'tableSessionVersion', 'isOpenBeforeSuspension', 'suspendedAt', 'deletedAt'
];
export const LEGACY_MIGRATION_ID = 'legacy-private-v1';

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

export async function scanLegacyPrivateData(db, restaurantSnapshots = null) {
  const restaurants = restaurantSnapshots ? { docs: restaurantSnapshots } : await db.collection('restaurants').get();
  const summary = {
    restaurantsScanned: restaurants.size,
    restaurantsNeedingMigration: 0,
    ownerMetadataDocuments: 0,
    subscriptionDocuments: 0,
    canonicalSubscriptionsAlreadyPresent: 0,
    ownerUidConflicts: 0,
    invalidSubscriptions: 0,
    backupConflicts: 0,
    privateFieldCounts: {},
    unknownFieldCounts: {}
  };

  for (const restaurantDoc of restaurants.docs) {
    const data = restaurantDoc.data() || {};
    const ownershipRef = restaurantDoc.ref.collection('private').doc('ownership');
    const [ownershipSnap, subscriptionSnap, backupSnap] = await Promise.all([
      ownershipRef.get(),
      db.collection('restaurantSubscriptions').doc(restaurantDoc.id).get(),
      ownershipRef.collection('migration_backups').doc(LEGACY_MIGRATION_ID).get()
    ]);
    const legacy = LEGACY_PRIVATE_FIELDS.filter((key) => data[key] !== undefined);
    const hasSubscription = data.subscription !== undefined;
    const unknown = Object.keys(data).filter((key) =>
      !PUBLIC_RESTAURANT_FIELDS.includes(key) &&
      !LEGACY_PRIVATE_FIELDS.includes(key) &&
      key !== 'subscription'
    );

    if (legacy.length || hasSubscription) summary.restaurantsNeedingMigration += 1;
    if (legacy.length) summary.ownerMetadataDocuments += 1;
    if (hasSubscription) summary.subscriptionDocuments += 1;
    if (hasSubscription && subscriptionSnap.exists) summary.canonicalSubscriptionsAlreadyPresent += 1;
    for (const key of legacy) increment(summary.privateFieldCounts, key);
    for (const key of unknown) increment(summary.unknownFieldCounts, key);

    const existingOwnerUid = ownershipSnap.exists ? ownershipSnap.data()?.ownerUid : null;
    if (existingOwnerUid && data.ownerUid && existingOwnerUid !== data.ownerUid) {
      summary.ownerUidConflicts += 1;
    }
    if (backupSnap.exists && (legacy.length || hasSubscription)) summary.backupConflicts += 1;
    if (hasSubscription && (!data.subscription || typeof data.subscription !== 'object' || Array.isArray(data.subscription))) {
      summary.invalidSubscriptions += 1;
    }
  }
  return summary;
}

export async function migrateOneRestaurant(db, restaurantRef, actorUid, deleteField = FieldValue.delete) {
  const slug = String(restaurantRef.id || '');
  const ownershipRef = restaurantRef.collection('private').doc('ownership');
  const backupRef = ownershipRef.collection('migration_backups').doc(LEGACY_MIGRATION_ID);
  const subscriptionRef = db.collection('restaurantSubscriptions').doc(slug);
  const auditRef = db.collection('admin_audit_logs').doc(`migrate_restaurant_private_${slug}_${LEGACY_MIGRATION_ID}`);

  return db.runTransaction(async (tx) => {
    const [restaurantSnap, ownershipSnap, subscriptionSnap, backupSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(ownershipRef), tx.get(subscriptionRef), tx.get(backupRef)
    ]);
    if (!restaurantSnap.exists) return { migrated: false, slug };
    const restaurant = restaurantSnap.data() || {};
    const existing = ownershipSnap.exists ? ownershipSnap.data() || {} : {};
    const legacy = Object.fromEntries(LEGACY_PRIVATE_FIELDS
      .filter((key) => restaurant[key] !== undefined)
      .map((key) => [key, restaurant[key]]));
    const unknown = Object.keys(restaurant).filter((key) =>
      !PUBLIC_RESTAURANT_FIELDS.includes(key) &&
      !LEGACY_PRIVATE_FIELDS.includes(key) &&
      key !== 'subscription'
    );
    if (unknown.length) throw new Error(`Champs restaurant non reconnus pour ${slug}: ${unknown.join(', ')}. Migration interrompue.`);
    if (existing.ownerUid && legacy.ownerUid && existing.ownerUid !== legacy.ownerUid) {
      throw new Error(`Conflit ownerUid pour ${slug}. Migration interrompue.`);
    }
    const hasLegacySubscription = restaurant.subscription !== undefined;
    if (hasLegacySubscription && (!restaurant.subscription || typeof restaurant.subscription !== 'object' || Array.isArray(restaurant.subscription))) {
      throw new Error(`Abonnement historique invalide pour ${slug}. Migration interrompue.`);
    }
    if (!Object.keys(legacy).length && !hasLegacySubscription) return { migrated: false, slug };
    if (backupSnap.exists) throw new Error(`Sauvegarde existante avec champs historiques encore présents pour ${slug}. Revue manuelle requise.`);

    const now = Date.now();
    const merged = { ...existing };
    for (const [key, value] of Object.entries(legacy)) {
      if (merged[key] === undefined) merged[key] = value;
    }

    // Preserve the exact legacy private values before removing them from the public root document.
    if (!backupSnap.exists) {
      tx.set(backupRef, {
        migrationId: LEGACY_MIGRATION_ID,
        sourceRootPrivateFields: legacy,
        sourceRootSubscription: hasLegacySubscription ? restaurant.subscription : null,
        capturedAt: now,
        capturedBy: actorUid
      });
    }
    if (Object.keys(legacy).length) {
      tx.set(ownershipRef, { ...merged, migratedAt: now, migratedBy: actorUid }, { merge: true });
    }
    const subscriptionMoved = hasLegacySubscription && !subscriptionSnap.exists;
    if (subscriptionMoved) tx.set(subscriptionRef, restaurant.subscription);

    const removals = {};
    for (const key of [...LEGACY_PRIVATE_FIELDS, 'subscription']) {
      if (restaurant[key] !== undefined) removals[key] = deleteField();
    }
    if (Object.keys(removals).length) tx.update(restaurantRef, removals);
    tx.set(auditRef, {
      action: 'migrate_restaurant_private_metadata',
      migrationId: LEGACY_MIGRATION_ID,
      restaurantSlug: slug,
      actorUid,
      ownerMetadataMoved: Object.keys(legacy).length > 0,
      subscriptionMoved,
      fieldsMoved: Object.keys(legacy),
      backupPath: backupRef.path,
      createdAt: now
    }, { merge: true });

    return {
      migrated: true,
      slug,
      fieldsMoved: Object.keys(legacy).length,
      subscriptionMoved,
      backupCreated: !backupSnap.exists
    };
  });
}

export async function migrateAllLegacyPrivateData(db, actorUid) {
  const preflight = await scanLegacyPrivateData(db);
  if (preflight.ownerUidConflicts || preflight.invalidSubscriptions || preflight.backupConflicts || Object.keys(preflight.unknownFieldCounts).length) {
    throw new Error(`Précontrôle refusé : ownerUidConflicts=${preflight.ownerUidConflicts}, invalidSubscriptions=${preflight.invalidSubscriptions}, backupConflicts=${preflight.backupConflicts}, unknownFields=${JSON.stringify(preflight.unknownFieldCounts)}. Aucune migration lancée.`);
  }
  const restaurants = await db.collection('restaurants').get();
  const result = { ...preflight, migratedRestaurants: 0, backupsCreated: 0, fieldsMoved: 0, subscriptionsMoved: 0 };
  for (const restaurantDoc of restaurants.docs) {
    const migrated = await migrateOneRestaurant(db, restaurantDoc.ref, actorUid);
    if (migrated.migrated) {
      result.migratedRestaurants += 1;
      result.backupsCreated += migrated.backupCreated ? 1 : 0;
      result.fieldsMoved += migrated.fieldsMoved || 0;
      result.subscriptionsMoved += migrated.subscriptionMoved ? 1 : 0;
    }
  }
  return result;
}

async function main() {
  const mode = process.argv[2];
  if (!['--dry-run', '--apply'].includes(mode)) {
    throw new Error('Usage: node scripts/migrate-legacy-restaurant-private-data.mjs < --dry-run | --apply >');
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const databaseId = process.env.FIRESTORE_DATABASE_ID;
  if (!projectId || !databaseId) throw new Error('FIREBASE_PROJECT_ID et FIRESTORE_DATABASE_ID sont obligatoires.');
  if (mode === '--apply' && process.env.CONFIRM_LEGACY_PRIVATE_MIGRATION !== 'MIGRATE_LEGACY_PRIVATE_DATA_TO_PRODUCTION') {
    throw new Error('Confirmation explicite de migration Production absente.');
  }
  const app = initializeApp({ credential: applicationDefault(), projectId }, 'legacy-private-migration');
  const db = getFirestore(app, databaseId);
  if (mode === '--dry-run') {
    const summary = await scanLegacyPrivateData(db);
    console.log(JSON.stringify({ mode: 'DRY_RUN', projectId, databaseId, ...summary }, null, 2));
    if (summary.ownerUidConflicts || summary.invalidSubscriptions || Object.keys(summary.unknownFieldCounts).length) {
      throw new Error('Précontrôle détecte des conflits/champs inconnus. Aucune donnée modifiée.');
    }
    return;
  }
  const result = await migrateAllLegacyPrivateData(db, 'github-actions:legacy-private-v1');
  console.log(JSON.stringify({ mode: 'APPLY', projectId, databaseId, ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
