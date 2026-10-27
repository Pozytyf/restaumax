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
  if (!getApps().length) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && fs.existsSync(credPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp();
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
    console.error(`Utilisateur introuvable dans Firebase Auth (${err.message}).`);
    process.exit(1);
  }

  console.log(`Utilisateur trouvé : ${userRecord.email} (UID: ${userRecord.uid})`);

  // 1. Attribution du Custom Claim
  await adminAuth.setCustomUserClaims(userRecord.uid, {
    role: 'manager'
  });
  console.log('✓ Custom Claim { role: "manager" } attribué avec succès.');

  // 2. Enregistrement dans la collection Firestore /managers/{uid}
  await db.collection('managers').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: userRecord.email,
    role: 'manager',
    grantedAt: new Date().toISOString()
  }, { merge: true });

  console.log(`✓ Document Firestore créé dans /managers/${userRecord.uid}.`);
  console.log(`✓ L'utilisateur ${userRecord.email} est désormais habilité comme Gestionnaire RestauMax.`);
}

main().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
