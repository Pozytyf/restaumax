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

/**
 * Lit et valide la configuration Firebase depuis firebase-applet-config.json.
 * Lève une erreur explicite si le fichier est introuvable, mal formé,
 * ou si le projectId ou le firestoreDatabaseId est manquant.
 */
export function getAppletFirebaseConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Fichier de configuration Firebase introuvable : ${configPath}`);
  }

  let config;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Impossible de lire ou parser ${configPath} : ${err.message}`);
  }

  if (!config.projectId || typeof config.projectId !== 'string' || !config.projectId.trim()) {
    throw new Error(`Configuration invalide : 'projectId' est manquant ou vide dans ${configPath}`);
  }

  if (!config.firestoreDatabaseId || typeof config.firestoreDatabaseId !== 'string' || !config.firestoreDatabaseId.trim()) {
    throw new Error(
      `Configuration invalide : 'firestoreDatabaseId' explicite est manquant ou vide dans ${configPath}. ` +
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
 * Valide les identifiants de compte de service fournis via GOOGLE_APPLICATION_CREDENTIALS.
 * Vérifie l'existence du fichier, le format JSON et la cohérence avec le projectId cible.
 */
export function validateServiceAccountCredentials(serviceAccountPath, expectedProjectId) {
  if (!serviceAccountPath) {
    throw new Error(
      "Variable d'environnement GOOGLE_APPLICATION_CREDENTIALS non définie.\n" +
      "Veuillez spécifier le chemin vers votre clé de compte de service Firebase téléchargée depuis la console."
    );
  }

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Le fichier de clé de service spécifié est introuvable : ${serviceAccountPath}`);
  }

  let serviceAccount;
  try {
    const raw = fs.readFileSync(serviceAccountPath, 'utf8');
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Le fichier de clé de service n'est pas un JSON valide : ${err.message}`);
  }

  if (serviceAccount.project_id && expectedProjectId && serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `Incohérence de projet détectée !\n` +
      `Le compte de service cible le projet '${serviceAccount.project_id}', ` +
      `alors que firebase-applet-config.json cible le projet '${expectedProjectId}'.\n` +
      `Opération annulée pour éviter d'écrire dans un projet erroné.`
    );
  }

  return serviceAccount;
}

/**
 * Initialise l'application Firebase Admin avec les identifiants et le projectId.
 * Lève une erreur explicite si l'initialisation échoue.
 */
export function initAdminApp(serviceAccount, projectId) {
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error(
      "Erreur d'initialisation : 'projectId' est manquant ou vide. Impossible d'initialiser Firebase Admin."
    );
  }

  try {
    if (!getApps().length) {
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId.trim(),
      });
    }
    return getApp();
  } catch (err) {
    throw new Error(`Échec de l'initialisation de l'application Firebase Admin : ${err.message}`);
  }
}

/**
 * Initialise et valide l'instance Firestore Admin pour la base spécifiée.
 * Lève une erreur explicite si le databaseId est absent, si l'initialisation échoue
 * ou si l'instance retournée ne correspond pas au databaseId demandé.
 */
export function initAdminFirestore(app, databaseId) {
  if (!databaseId || typeof databaseId !== 'string' || !databaseId.trim()) {
    throw new Error(
      "Erreur critique d'initialisation : L'identifiant de base de données Firestore ('databaseId') est manquant ou vide. " +
      "Impossible d'initialiser Firestore sans identifiant de base explicite."
    );
  }

  const normalizedDbId = databaseId.trim();

  let db;
  try {
    db = getFirestore(app, normalizedDbId);
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
