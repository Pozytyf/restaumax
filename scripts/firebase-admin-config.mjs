/**
 * RESTAUMAX — Configuration centralisée pour les scripts d'administration
 *
 * Charge et valide la configuration Firebase depuis firebase-applet-config.json
 * pour garantir que tous les scripts ciblent strictement la même base Firestore
 * et le même projet que l'application cliente.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, '../firebase-applet-config.json');

export const DEFAULT_ADMIN_APP_NAME = '[DEFAULT]';

/**
 * Lit et valide la configuration Firebase depuis firebase-applet-config.json (ou un chemin spécifié).
 * Lève une erreur explicite si le fichier est introuvable, mal formé,
 * ou si le projectId ou le firestoreDatabaseId est manquant ou vide.
 *
 * @param {string} [targetConfigPath=configPath] - Chemin vers le fichier de configuration JSON
 * @returns {{ projectId: string, firestoreDatabaseId: string, appId?: string, authDomain?: string }}
 */
export function getAppletFirebaseConfig(targetConfigPath = configPath) {
  if (!fs.existsSync(targetConfigPath)) {
    throw new Error(`Fichier de configuration Firebase introuvable : ${targetConfigPath}`);
  }

  let config;
  try {
    const raw = fs.readFileSync(targetConfigPath, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Impossible de lire ou parser ${targetConfigPath} : ${err.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Configuration invalide : Le fichier ${targetConfigPath} ne contient pas un objet JSON valide.`);
  }

  if (!config.projectId || typeof config.projectId !== 'string' || !config.projectId.trim()) {
    throw new Error(`Configuration invalide : 'projectId' est manquant ou vide dans ${targetConfigPath}`);
  }

  if (!config.firestoreDatabaseId || typeof config.firestoreDatabaseId !== 'string' || !config.firestoreDatabaseId.trim()) {
    throw new Error(
      `Configuration invalide : 'firestoreDatabaseId' explicite est manquant ou vide dans ${targetConfigPath}. ` +
      `L'application RestauMax utilise une base nommée spécifique qui doit être explicitement définie.`
    );
  }

  return {
    projectId: config.projectId.trim(),
    firestoreDatabaseId: config.firestoreDatabaseId.trim(),
    appId: config.appId,
    authDomain: config.authDomain,
  };
}

/**
 * Valide strictement les identifiants de compte de service fournis.
 *
 * Exigences de sécurité strictes :
 * 1. expectedProjectId doit être une chaîne non vide valide.
 * 2. serviceAccountPathOrObject doit être soit un chemin de fichier existant et lisible,
 *    soit un objet de credentials valide.
 * 3. serviceAccount.project_id doit être présent, de type chaîne et non vide.
 * 4. Les identifiants de projet doivent correspondre exactement après normalisation (.trim()).
 * 5. L'absence ou la non-concordance de project_id provoque un rejet immédiat.
 * 6. Aucune clé privée ni contenu brut des credentials ne doit apparaître dans les erreurs ou logs.
 *
 * @param {string|object} serviceAccountInput - Chemin du fichier JSON ou objet de credentials
 * @param {string} expectedProjectId - ID du projet Firebase attendu
 * @returns {object} L'objet service account validé
 */
export function validateServiceAccountCredentials(serviceAccountInput, expectedProjectId) {
  // 1. Validation stricte du projet attendu
  if (!expectedProjectId || typeof expectedProjectId !== 'string' || !expectedProjectId.trim()) {
    throw new Error(
      "Validation de sécurité échouée : L'identifiant de projet attendu ('expectedProjectId') " +
      "est manquant, invalide ou vide. Impossible de valider le compte de service."
    );
  }
  const normalizedExpectedProjectId = expectedProjectId.trim();

  // 2. Validation de la source des credentials
  if (!serviceAccountInput) {
    throw new Error(
      "Identifiants de compte de service manquants.\n" +
      "Veuillez définir la variable d'environnement GOOGLE_APPLICATION_CREDENTIALS avec le chemin de votre clé de compte de service."
    );
  }

  let serviceAccount;
  if (typeof serviceAccountInput === 'string') {
    const credPath = serviceAccountInput.trim();
    if (!credPath) {
      throw new Error(
        "Validation de sécurité échouée : Le chemin des identifiants spécifié est vide."
      );
    }
    if (!fs.existsSync(credPath)) {
      throw new Error(`Le fichier de clé de compte de service est introuvable : ${credPath}`);
    }

    try {
      const raw = fs.readFileSync(credPath, 'utf8');
      serviceAccount = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Le fichier de clé de service n'est pas un JSON valide : ${err.message}`);
    }
  } else if (typeof serviceAccountInput === 'object' && serviceAccountInput !== null) {
    serviceAccount = serviceAccountInput;
  } else {
    throw new Error("Validation de sécurité échouée : Les identifiants fournis ne sont ni un chemin valide ni un objet JSON.");
  }

  if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
    throw new Error("Validation de sécurité échouée : Le compte de service ne contient pas un objet JSON valide.");
  }

  // 3. Exigence obligatoire d'un project_id présent, de type chaîne et non vide
  if (
    !('project_id' in serviceAccount) ||
    typeof serviceAccount.project_id !== 'string' ||
    !serviceAccount.project_id.trim()
  ) {
    throw new Error(
      "Validation de sécurité échouée : Le compte de service ne contient pas de champ 'project_id' valide et non vide. " +
      "L'opération est rejetée car le projet cible ne peut pas être vérifié."
    );
  }

  // 4. Comparaison stricte après normalisation
  const normalizedServiceProjectId = serviceAccount.project_id.trim();

  if (normalizedServiceProjectId !== normalizedExpectedProjectId) {
    throw new Error(
      `Incohérence de projet critique détectée !\n` +
      `Le compte de service cible le projet '${normalizedServiceProjectId}', ` +
      `alors que le projet attendu est '${normalizedExpectedProjectId}'.\n` +
      `Opération rejetée pour empêcher toute altération ou fuite de données vers un mauvais environnement.`
    );
  }

  return serviceAccount;
}

/**
 * Initialise ou réutilise de manière sécurisée l'application Firebase Admin.
 *
 * Règles de sécurité :
 * 1. Ne retourne JAMAIS aveuglément getApp() sans vérifier la compatibilité du projet.
 * 2. Si une application du nom spécifié existe déjà, vérifie que app.options.projectId
 *    correspond exactement au projectId attendu.
 * 3. En cas de conflit avec une application existante (pointant vers un autre projet),
 *    lève une erreur explicite au lieu de créer silencieusement une application concurrente.
 *
 * LIMITE TECHNIQUE DU SDK FIREBASE ADMIN :
 * Le SDK Firebase Admin n'expose pas d'API publique pour inspecter ou comparer
 * l'empreinte cryptographique des identifiants (clé privée ou certificat) une fois
 * l'instance créée. La vérification de conformité repose donc sur l'identité stricte
 * de 'options.projectId' et le blocage de toute instance discordante ou concurrente.
 *
 * @param {object|null} [serviceAccount=null] - Identifiants validés (ou null en mode émulateur)
 * @param {string} projectId - ID du projet Firebase attendu
 * @param {string} [appName='[DEFAULT]'] - Nom de l'application Firebase Admin
 * @returns {import('firebase-admin/app').App} L'application Firebase Admin initialisée ou réutilisée
 */
export function initAdminApp(serviceAccount = null, projectId, appName = DEFAULT_ADMIN_APP_NAME) {
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error(
      "Erreur d'initialisation : 'projectId' est manquant ou vide. Impossible d'initialiser Firebase Admin."
    );
  }

  const normalizedProjectId = projectId.trim();
  const existingApps = getApps();

  // Vérifier d'éventuels conflits ou incohérences dans les applications existantes
  for (const app of existingApps) {
    const rawProjectId = app.options?.projectId;
    if (!rawProjectId || typeof rawProjectId !== 'string' || !rawProjectId.trim()) {
      throw new Error(
        `Conflit d'application Firebase Admin détecté : L'application active '${app.name}' ` +
        `ne possède pas d'identifiant 'projectId' valide ou non vide dans ses options. ` +
        `Opération interrompue pour éviter toute réutilisation ambiguë.`
      );
    }

    const existingNormalizedProjectId = rawProjectId.trim();
    if (existingNormalizedProjectId !== normalizedProjectId) {
      throw new Error(
        `Conflit d'application Firebase Admin détecté : L'application active '${app.name}' ` +
        `cible le projet '${existingNormalizedProjectId}', incompatible avec le projet attendu '${normalizedProjectId}'. ` +
        `Opération interrompue pour éviter toute collision multi-environnements.`
      );
    }
  }

  // Vérifier si l'application ciblée par appName existe déjà
  const matchedApp = existingApps.find((app) => app.name === appName);
  if (matchedApp) {
    // L'application existante est compatible et a passé la validation stricte de projectId ci-dessus
    return matchedApp;
  }

  // Aucune application existante pour ce nom : initialisation
  try {
    const appOptions = {
      projectId: normalizedProjectId,
    };
    if (serviceAccount) {
      appOptions.credential = cert(serviceAccount);
    }

    if (appName === DEFAULT_ADMIN_APP_NAME) {
      return initializeApp(appOptions);
    }
    return initializeApp(appOptions, appName);
  } catch (err) {
    throw new Error(`Échec de l'initialisation de l'application Firebase Admin : ${err.message}`);
  }
}

/**
 * Initialise et valide l'instance Firestore Admin pour la base spécifiée.
 * Lève une erreur explicite si le databaseId est absent, si l'initialisation échoue
 * ou si l'instance retournée ne correspond pas au databaseId demandé.
 *
 * @param {import('firebase-admin/app').App} app - Application Firebase Admin
 * @param {string} databaseId - Identifiant de la base Firestore ciblée
 * @param {Function} [getFirestoreFn=getFirestore] - Fabrique Firestore injectable pour les tests
 * @returns {import('firebase-admin/firestore').Firestore} L'instance Firestore validée
 */
export function initAdminFirestore(app, databaseId, getFirestoreFn = getFirestore) {
  if (!databaseId || typeof databaseId !== 'string' || !databaseId.trim()) {
    throw new Error(
      "Erreur critique d'initialisation : L'identifiant de base de données Firestore ('databaseId') est manquant ou vide. " +
      "Impossible d'initialiser Firestore sans identifiant de base explicite."
    );
  }

  const normalizedDbId = databaseId.trim();

  let db;
  try {
    db = getFirestoreFn(app, normalizedDbId);
  } catch (err) {
    throw new Error(
      `Échec de l'initialisation de l'instance Firestore Admin pour la base '${normalizedDbId}' : ${err.message}`
    );
  }

  if (!db || db.databaseId !== normalizedDbId) {
    throw new Error(
      `Erreur critique d'intégrité Firestore : L'instance retournée cible '${db?.databaseId}' ` +
      `au lieu de la base attendue '${normalizedDbId}'. Initialisation annulée pour prévenir toute altération d'une mauvaise base.`
    );
  }

  return db;
}
