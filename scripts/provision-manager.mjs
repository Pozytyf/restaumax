import { getAuth } from 'firebase-admin/auth';
import {
  getAppletFirebaseConfig,
  initAdminApp,
  initAdminFirestore,
  validateServiceAccountCredentials
} from './firebase-admin-config.mjs';

const email = process.argv[2]?.trim();
const role = process.argv[3] || 'admin';
const restaurantSlug = process.argv[4] || 'chez-awa';

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/provision-manager.mjs <email> [admin|manager] [restaurantSlug]');
  process.exit(1);
}
if (!['admin', 'manager'].includes(role)) {
  console.error('Role invalide. Valeurs autorisées : admin, manager.');
  process.exit(1);
}

try {
  const config = getAppletFirebaseConfig();
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialsInput = credentialsJson ? JSON.parse(credentialsJson) : credentialsPath;

  if (!credentialsInput) {
    throw new Error('Configurez FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS.');
  }

  const serviceAccount = validateServiceAccountCredentials(credentialsInput, config.projectId);
  const adminApp = initAdminApp(serviceAccount, config.projectId);
  const auth = getAuth(adminApp);
  const user = await auth.getUserByEmail(email);
  const db = initAdminFirestore(adminApp, config.firestoreDatabaseId);

  await db.collection('managers').doc(user.uid).set({
    uid: user.uid,
    email: user.email || email,
    role,
    restaurantSlug,
    active: true,
    updatedAt: Date.now()
  }, { merge: true });

  console.log(`Compte ${role} provisionné pour ${user.email || email} sur le restaurant ${restaurantSlug}.`);
} catch (error) {
  console.error('Échec du provisionnement du gestionnaire :', error?.message || String(error));
  process.exit(1);
}
