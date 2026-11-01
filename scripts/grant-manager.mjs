/**
 * RESTAUMAX — Script d'attribution sécurisée du rôle Gestionnaire (Admin SDK)
 *
 * Utilisation :
 * 1. Recommandé : utiliser les Application Default Credentials (gcloud auth application-default login).
 * 2. Facultatif : définir GOOGLE_APPLICATION_CREDENTIALS vers une clé conservée HORS du dépôt.
 * 3. Exécuter ce script avec node :
 *    node scripts/grant-manager.mjs <USER_EMAIL_OU_UID> <SLUG_RESTAURANT>
 */

import { getAuth } from 'firebase-admin/auth';
import { 
  getAppletFirebaseConfig, 
  validateServiceAccountCredentials,
  initAdminApp,
  initAdminFirestore 
} from './firebase-admin-config.mjs';

async function main() {
  const targetUserIdentifier = process.argv[2];
  const restaurantSlug = process.argv[3];

  if (!targetUserIdentifier || !restaurantSlug) {
    console.error('Usage: node scripts/grant-manager.mjs <EMAIL_OU_UID_GESTIONNAIRE> <SLUG_RESTAURANT>');
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) {
    console.error('Slug restaurant invalide. Utilisez 1 à 100 caractères alphanumériques, tirets ou underscores.');
    process.exit(1);
  }

  // 1. Chargement et validation de la configuration centralisée de l'application
  const firebaseConfig = getAppletFirebaseConfig();
  console.log(`Projet cible validé : ${firebaseConfig.projectId}`);
  console.log(`Base Firestore ciblée : ${firebaseConfig.firestoreDatabaseId}`);

  // 2. Validation facultative d'une clé de service; sinon, utilisation des ADC.
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const serviceAccount = credPath
    ? validateServiceAccountCredentials(credPath, firebaseConfig.projectId)
    : null;

  // 3. Initialisation contrôlée de Firebase Admin SDK et de la base Firestore dédiée.
  const app = initAdminApp(serviceAccount, firebaseConfig.projectId);
  const adminAuth = getAuth(app);
  const db = initAdminFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log(`Connexion confirmée sur la base : ${db.databaseId}`);
  const restaurantSnapshot = await db.collection('restaurants').doc(restaurantSlug).get();
  if (!restaurantSnapshot.exists) {
    throw new Error(`Le restaurant "${restaurantSlug}" n'existe pas dans la base ${db.databaseId}. Attribution refusée.`);
  }
  console.log(`Restaurant vérifié : ${restaurantSlug}`);
  console.log(`Recherche de l'utilisateur : ${targetUserIdentifier}...`);

  let userRecord;
  try {
    if (targetUserIdentifier.includes('@')) {
      userRecord = await adminAuth.getUserByEmail(targetUserIdentifier);
    } else {
      userRecord = await adminAuth.getUser(targetUserIdentifier);
    }
  } catch (err) {
    console.error(`Utilisateur introuvable dans Firebase Authentication.`);
    process.exit(1);
  }

  console.log(`Utilisateur identifié : ${userRecord.email} (UID: ${userRecord.uid})`);

  // 4. Fusion des habilitations sans retirer les rôles ou restaurants déjà accordés.
  const existingClaims = userRecord.customClaims || {};
  const managerRef = db.collection('managers').doc(userRecord.uid);
  const existingManagerSnapshot = await managerRef.get();
  const existingManager = existingManagerSnapshot.exists ? existingManagerSnapshot.data() : {};
  const assignedRestaurants = [...new Set([
    ...(Array.isArray(existingClaims.restaurants) ? existingClaims.restaurants : []),
    ...(typeof existingClaims.restaurantSlug === 'string' ? [existingClaims.restaurantSlug] : []),
    ...(Array.isArray(existingManager?.restaurants) ? existingManager.restaurants : []),
    ...(typeof existingManager?.restaurantSlug === 'string' ? [existingManager.restaurantSlug] : []),
    restaurantSlug
  ].filter((value) => typeof value === 'string' && value.trim()))];
  const assignedRole =
    existingClaims.role === 'admin' || existingManager?.role === 'admin'
      ? 'admin'
      : 'manager';

  await adminAuth.setCustomUserClaims(userRecord.uid, {
    ...existingClaims,
    role: assignedRole,
    restaurants: assignedRestaurants,
    restaurantSlug
  });
  console.log(`✓ Habilitation ${assignedRole} mise à jour pour ${assignedRestaurants.length} restaurant(s).`);

  // 5. Enregistrement sécurisé dans la collection Firestore /managers/{uid} de la base spécifique.
  await managerRef.set({
    uid: userRecord.uid,
    email: userRecord.email,
    role: assignedRole,
    restaurantSlug,
    restaurants: assignedRestaurants,
    grantedAt: new Date().toISOString()
  }, { merge: true });

  console.log(`✓ Document Firestore validé dans ${db.databaseId}/managers/${userRecord.uid}.`);
  console.log(`✓ L'utilisateur ${userRecord.email} est désormais habilité sur ${restaurantSlug} (rôle : ${assignedRole}).`);
}

main().catch((err) => {
  console.error("Échec de l'opération :", err.message || 'Erreur interne.');
  process.exit(1);
});
