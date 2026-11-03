/**
 * One-time migration: move ownership fields out of public restaurant documents.
 *
 * Safe by default: dry-run only. Apply requires an explicit --apply flag and
 * an exact Preview project/database match. Never point this script at Production.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EXPECTED_PROJECT = 'restaumax-preview';
const EXPECTED_DATABASE = '(default)';
const apply = process.argv.includes('--apply');
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (projectId !== EXPECTED_PROJECT || databaseId !== EXPECTED_DATABASE) {
  throw new Error('Cible refusée : ce script est strictement réservé à restaumax-preview/(default).');
}
if (!rawCredentials) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON est requis. Aucune donnée n’a été modifiée.');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(rawCredentials);
} catch {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON invalide. Le contenu du secret ne sera pas affiché.');
}
if (serviceAccount.project_id !== EXPECTED_PROJECT) {
  throw new Error('Le compte de service ne cible pas le projet Preview attendu.');
}
if (getApps().length) {
  throw new Error('Une application Firebase Admin existe déjà dans ce processus ; arrêt préventif.');
}

const app = initializeApp({ credential: cert(serviceAccount), projectId });
const db = getFirestore(app, databaseId);
const snapshot = await db.collection('restaurants').get();
const changes = [];

for (const restaurantDoc of snapshot.docs) {
  const data = restaurantDoc.data();
  const ownership = {
    ownerUid: data.ownerUid,
    ownerName: data.ownerName,
    ownerEmail: data.ownerEmail,
  };
  const hasOwnership = Object.values(ownership).some((value) => value !== undefined);
  if (!hasOwnership) continue;

  const privateRef = restaurantDoc.ref.collection('private').doc('ownership');
  const privateSnap = await privateRef.get();
  if (privateSnap.exists) {
    const current = privateSnap.data();
    if (current.ownerUid && ownership.ownerUid && current.ownerUid !== ownership.ownerUid) {
      throw new Error(`Conflit d’identité propriétaire pour le restaurant ${restaurantDoc.id}. Aucun lot n’a été appliqué.`);
    }
  }
  changes.push({ ref: restaurantDoc.ref, privateRef, ownership, id: restaurantDoc.id });
}

console.log(JSON.stringify({
  target: `${projectId}/${databaseId}`,
  mode: apply ? 'APPLY' : 'DRY_RUN',
  restaurantsToMigrate: changes.map(({ id, ownership }) => ({
    slug: id,
    hasOwnerUid: Boolean(ownership.ownerUid),
    hasOwnerName: Boolean(ownership.ownerName),
    hasOwnerEmail: Boolean(ownership.ownerEmail),
  })),
  count: changes.length,
}, null, 2));

if (apply) {
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    for (const item of changes.slice(offset, offset + 400)) {
      const existing = await item.privateRef.get();
      const merged = { ...(existing.exists ? existing.data() : {}), ...Object.fromEntries(
        Object.entries(item.ownership).filter(([, value]) => value !== undefined)
      ), migratedAt: Date.now() };
      batch.set(item.privateRef, merged, { merge: true });
      batch.update(item.ref, {
        ownerUid: require('firebase-admin/firestore').FieldValue.delete(),
        ownerName: require('firebase-admin/firestore').FieldValue.delete(),
        ownerEmail: require('firebase-admin/firestore').FieldValue.delete(),
      });
    }
    await batch.commit();
  }
  console.log('Migration terminée. Vérifier les documents publics et privés dans Preview.');
} else {
  console.log('Aucune écriture effectuée. Relancer avec --apply uniquement après sauvegarde validée.');
}

await app.delete();
