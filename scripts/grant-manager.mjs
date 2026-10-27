/**
 * RESTAUMAX — Script d'attribution sécurisée du rôle Gestionnaire (Admin SDK)
 *
 * Utilisation :
 * 1. Télécharger une clé de compte de service depuis la console Firebase :
 *    Paramètres du projet > Comptes de service > Générer une nouvelle clé privée.
 * 2. Enregistrer cette clé HORS du dépôt (ex: ~/serviceAccountKey.json).
 * 3. Exécuter ce script avec node :
 *    GOOGLE_APPLICATION_CREDENTIALS=~/serviceAccountKey.json node scripts/grant-manager.mjs <USER_EMAIL_OU_UID>
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

  if (!targetUserIdentifier) {
    console.error('Usage: node scripts/grant-manager.mjs <EMAIL_OU_UID_GESTIONNAIRE>');
    process.exit(1);
  }

  // 1. Chargement et validation de la configuration centralisée de l'application
  const firebaseConfig = getAppletFirebaseConfig();
  console.log(`Projet cible validé : ${firebaseConfig.projectId}`);
  console.log(`Base Firestore ciblée : ${firebaseConfig.firestoreDatabaseId}`);

  // 2. Validation de la clé de compte de service et cohérence du projet
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const serviceAccount = validateServiceAccountCredentials(credPath, firebaseConfig.projectId);

  // 3. Initialisation contrôlée de Firebase Admin SDK et de la base Firestore dédiée
  const app = initAdminApp(serviceAccount, firebaseConfig.projectId);
  const adminAuth = getAuth(app);
  const db = initAdminFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log(`Connexion confirmée sur la base : ${db.databaseId}`);
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

  // 4. Fusion des Custom Claims pour préserver d'éventuelles claims existantes
  const existingClaims = userRecord.customClaims || {};
  await adminAuth.setCustomUserClaims(userRecord.uid, {
    ...existingClaims,
    role: 'manager'
  });
  console.log('✓ Custom Claim { role: "manager" } fusionné avec succès.');

  // 5. Enregistrement sécurisé dans la collection Firestore /managers/{uid} de la base spécifique
  await db.collection('managers').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    role: 'manager',
    grantedAt: new Date().toISOString()
  }, { merge: true });

  console.log(`✓ Document Firestore validé dans ${db.databaseId}/managers/${userRecord.uid}.`);
  console.log(`✓ L'utilisateur ${userRecord.email} est désormais habilité comme Gestionnaire RestauMax.`);
}

main().catch((err) => {
  console.error("Échec de l'opération :", err.message || 'Erreur interne.');
  process.exit(1);
});
