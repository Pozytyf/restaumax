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

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

async function main() {
  const targetUserIdentifier = process.argv[2];

  if (!targetUserIdentifier) {
    console.error('Usage: node scripts/grant-manager.mjs <EMAIL_OU_UID_GESTIONNAIRE>');
    process.exit(1);
  }

  // Initialisation de Firebase Admin
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('Erreur de configuration : la variable d\'environnement GOOGLE_APPLICATION_CREDENTIALS n\'est pas définie.');
    console.error('Veuillez spécifier le chemin vers la clé de compte de service Firebase.');
    console.error('Exemple : GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/serviceAccountKey.json node scripts/grant-manager.mjs <EMAIL>');
    process.exit(1);
  }

  if (!fs.existsSync(credPath)) {
    console.error('Erreur : le fichier de clé de service spécifié est introuvable.');
    process.exit(1);
  }

  if (!getApps().length) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      initializeApp({ credential: cert(serviceAccount) });
    } catch (parseErr) {
      console.error('Erreur : impossible de lire ou d\'analyser le fichier de compte de service JSON.');
      process.exit(1);
    }
  }

  const adminAuth = getAuth();
  const db = getFirestore();

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

  // 1. Fusion des Custom Claims pour préserver d'éventuelles claims existantes
  const existingClaims = userRecord.customClaims || {};
  await adminAuth.setCustomUserClaims(userRecord.uid, {
    ...existingClaims,
    role: 'manager'
  });
  console.log('✓ Custom Claim { role: "manager" } fusionné avec succès (claims existantes préservées).');

  // 2. Enregistrement sécurisé dans la collection Firestore /managers/{uid}
  await db.collection('managers').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    role: 'manager',
    grantedAt: new Date().toISOString()
  }, { merge: true });

  console.log(`✓ Document Firestore validé dans /managers/${userRecord.uid} (champ role: "manager").`);
  console.log(`✓ L'utilisateur ${userRecord.email} est désormais habilité comme Gestionnaire RestauMax.`);
}

main().catch((err) => {
  console.error('Échec de l\'opération :', err.message || 'Erreur interne.');
  process.exit(1);
});
