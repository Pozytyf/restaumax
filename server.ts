/**
 * RESTAUMAX — SERVEUR BACKEND SÉCURISÉ & PASSERELLE API RESTAUMAX
 *
 * Ce serveur Express gère les points de terminaison d'API de confiance pour RestauMax,
 * notamment la route sécurisée de commande POST /api/orders, et monte le middleware Vite en dev.
 *
 * ==============================================================================
 * DOCUMENTATION DE CONFIGURATION (DÉVELOPPEMENT & PRODUCTION) :
 * ==============================================================================
 * 
 * 1. Configuration Firebase Admin SDK :
 *    - Le serveur requiert obligatoirement un compte de service Firebase Admin valide
 *      pour traiter et écrire les commandes dans Firestore.
 *    - Variable requise : GOOGLE_APPLICATION_CREDENTIALS=<chemin_absolu_vers_cle_service_account.json>
 *    - Fichier de configuration applet : firebase-applet-config.json
 *      - projectId attendu : gen-lang-client-0138815290
 *      - firestoreDatabaseId attendu : ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf
 *
 * 2. Comportement de sécurité (Règles Firestore & Admin SDK) :
 *    - Les règles Firestore (firestore.rules) interdisent formellement aux clients
 *      l'écriture directe de commandes (`allow create: if false;` sur /orders/{orderId}).
 *    - Toute commande doit impérativement transiter par POST /api/orders.
 *    - Si Firebase Admin SDK n'est pas initialisé (credentials absents ou invalides),
 *      le serveur REFUSE catégoriquement de traiter les commandes (HTTP 503 Service Unavailable).
 *    - Il est STRICTEMENT INTERDIT d'utiliser le SDK Firebase client pour écrire des commandes
 *      depuis le serveur (aucun fallback client, aucune écriture non confirmée).
 *
 * 3. Démarrage :
 *    - Développement : "npm run dev" (tsx server.ts avec middleware Vite SPA)
 *    - Production : "npm run build && npm start" (sert les fichiers statiques dist/ et l'API)
 *    - Port par défaut : 3000 (configurable via la variable PORT)
 * ==============================================================================
 */

import 'dotenv/config';
import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { handlePlatformAdmin as runPlatformAdmin } from './src/server/platformAdmin.js';
import { updateKitchenItemCompletionWithDb } from './src/server/kitchenService.js';
import { transitionOrderStatusWithDb } from './src/server/orderLifecycleService.js';
import { manageInventoryWithDb } from './src/server/inventoryService.js';
import { 
  processOrderSubmission, 
  ServerFirestoreProvider,
  ServerIdempotencyRecord,
  OrderProbeResult,
  IdempotencyReservationResult
} from './src/server/orderService.js';
import { getFinancialReportWithDb } from './src/server/financialReportService.js';
import { reconcileSubscriptionBillingWithDb } from './src/server/subscriptionService.js';
import { recordCashPaymentWithDb, listRecentCashPaymentsWithDb, getCashSessionWithDb, listClosedCashSessionsWithDb, openCashSessionWithDb, closeCashSessionWithDb, recordCashMovementWithDb, refundCashPaymentWithDb } from './src/server/paymentService.js';
import { type PayDunyaCiWithdrawMode } from './src/server/paydunyaService.js';
import { loadRestaurantPayDunyaConfig, saveRestaurantPayDunyaCredentials } from './src/server/paydunyaMerchantConfig.js';
import { startPayDunyaOrderPaymentWithDb, processPayDunyaInvoiceCallbackWithDb, startPayDunyaRefundWithDb, processPayDunyaDisbursementCallbackWithDb, reconcilePayDunyaInvoiceIntentWithDb } from './src/server/paydunyaPaymentService.js';
import {
  authorizeTableManager,
  buildCsrfCookie,
  buildSessionCookie,
  getActiveTableSession,
  issueTableQr,
  isTrustedQrNavigation,
  readCookie,
  requestHasValidOrigin,
  resolveTableQr,
  revokeTableQr,
  tableCsrfCookieName,
  tableSessionCookieName,
  validateCsrf
} from './src/server/tableSecurityService.js';
import { 
  getAppletFirebaseConfig, 
  initAdminApp, 
  initAdminFirestore, 
  validateServiceAccountCredentials 
} from './scripts/firebase-admin-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// 1. Initialisation stricte de Firebase Admin SDK
export let adminDb: any = null;
export let adminAuth: any = null;
let adminInitError: string | null = null;
let appletConfig: { projectId: string; firestoreDatabaseId: string } | null = null;

try {
  appletConfig = getAppletFirebaseConfig();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    // Vercel/serverless: store the service account JSON as a protected environment variable.
    const parsedCredentials = JSON.parse(serviceAccountJson);
    const serviceAccount = validateServiceAccountCredentials(parsedCredentials, appletConfig.projectId);
    const adminApp = initAdminApp(serviceAccount, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    adminAuth = getAuth(adminApp);
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé via variable sécurisée pour la base '${appletConfig.firestoreDatabaseId}'.`);
  } else if (credPath && fs.existsSync(credPath)) {
    // Local/server deployments may continue to use a credentials file.
    const serviceAccount = validateServiceAccountCredentials(credPath, appletConfig.projectId);
    const adminApp = initAdminApp(serviceAccount, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    adminAuth = getAuth(adminApp);
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé avec succès pour la base '${appletConfig.firestoreDatabaseId}' (Projet: ${appletConfig.projectId})`);
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    const adminApp = initAdminApp(null as any, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    adminAuth = getAuth(adminApp);
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé sur l'émulateur Firestore (${process.env.FIRESTORE_EMULATOR_HOST})`);
  } else {
    adminInitError = credPath
      ? "Fichier de credentials administrateur introuvable."
      : "Aucun credential Firebase Admin configuré (FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS).";
    console.warn(`[RestauMax Server] AVERTISSEMENT : Firebase Admin SDK non initialisé (${adminInitError}). Le traitement de commandes sera désactivé.`);
  }
} catch (err: any) {
  // Never log service-account contents; only the validation/error message is retained.
  adminInitError = err.message || String(err);
  console.error(`[RestauMax Server] Erreur lors de l'initialisation de Firebase Admin SDK : ${adminInitError}`);
}
export interface TransactionEvaluationParams {
  restaurantSlug: string;
  idempotencyKey: string;
  keyDocId: string;
  orderId: string;
  signature: string;
  keyExists: boolean;
  keyData: any;
  orderExists: boolean;
  orderData: any;
  now?: number;
  timeoutMs?: number;
}

export type TransactionDecisionResult = 
  | { type: 'REJECT'; error: string; conflict?: boolean }
  | { type: 'REPLAY_NOMINAL'; order: any }
  | { type: 'RECONCILE_AND_REPLAY'; order: any }
  | { type: 'AUTO_REPAIR'; order: any }
  | { type: 'CREATE_NOMINAL' };

/**
 * Moteur décisionnel d'intégrité Fail-Closed pour les transactions de commande.
 * Évalue la cohérence des métadonnées, des signatures, des espaces de noms
 * et des états documentaires avant toute autorisation d'écriture ou de rejeu.
 */
export function evaluateOrderTransactionDecision(params: TransactionEvaluationParams): TransactionDecisionResult {
  const {
    restaurantSlug,
    idempotencyKey,
    keyDocId,
    orderId,
    signature,
    keyExists,
    keyData,
    orderExists,
    orderData,
    now = Date.now(),
    timeoutMs = 15000
  } = params;

  // 1. Contrôle strict du registre s'il existe (Fail-Closed)
  if (keyExists) {
    if (!keyData || typeof keyData !== 'object') {
      return { type: 'REJECT', error: "Registre d'idempotence corrompu : données non exploitables." };
    }

    // 1.1 Présence et conformité de la signature
    if (!keyData.signature || typeof keyData.signature !== 'string' || !keyData.signature.trim()) {
      return { type: 'REJECT', error: "Registre d'idempotence corrompu : signature de requête absente ou invalide." };
    }
    if (keyData.signature !== signature) {
      return {
        type: 'REJECT',
        conflict: true,
        error: `Conflit d'idempotence : La clé "${idempotencyKey}" a déjà été utilisée pour une intention différente (signature de requête divergente).`
      };
    }

    // 1.2 Identifiant documentaire du registre
    if (!keyData.id || keyData.id !== keyDocId) {
      return {
        type: 'REJECT',
        error: `Incohérence documentaire : l'identifiant du registre (${keyData.id}) ne correspond pas à l'identifiant attendu (${keyDocId}).`
      };
    }

    // 1.3 Restaurant et espace de noms
    if (!keyData.restaurantSlug || keyData.restaurantSlug !== restaurantSlug) {
      return {
        type: 'REJECT',
        error: `Violation d'isolation multi-tenant : le restaurant du registre (${keyData.restaurantSlug}) ne correspond pas au restaurant de la requête (${restaurantSlug}).`
      };
    }
    const expectedNamespace = `${restaurantSlug}:${idempotencyKey}`;
    if (!keyData.namespacedKey || keyData.namespacedKey !== expectedNamespace) {
      return {
        type: 'REJECT',
        error: `Incohérence d'espace de noms : l'espace de noms du registre (${keyData.namespacedKey}) ne correspond pas à l'espace de noms attendu (${expectedNamespace}).`
      };
    }

    // 1.4 Identifiant de commande rattaché
    if (!keyData.orderId || keyData.orderId !== orderId) {
      return {
        type: 'REJECT',
        error: `Incohérence d'identifiant de commande : l'identifiant de commande du registre (${keyData.orderId}) ne correspond pas à l'identifiant dérivé (${orderId}).`
      };
    }

    // 1.5 Statut du registre
    const validStatuses = ['completed', 'processing', 'ambiguous', 'failed'];
    if (!keyData.status || !validStatuses.includes(keyData.status)) {
      return {
        type: 'REJECT',
        error: `Registre d'idempotence corrompu : statut absent ou non reconnu (${keyData.status}).`
      };
    }
    if (keyData.status === 'failed') {
      return {
        type: 'REJECT',
        error: "La tentative précédente associée à cette clé d'idempotence s'est terminée par un échec définitif. Réutilisation interdite."
      };
    }
  }

  // 2. Contrôle strict de la commande si elle existe (Fail-Closed)
  if (orderExists) {
    if (!orderData || typeof orderData !== 'object') {
      return { type: 'REJECT', error: "Document de commande corrompu : données non exploitables." };
    }

    // 2.1 Présence et conformité de la signature de contenu
    if (!orderData.contentSignature || typeof orderData.contentSignature !== 'string' || !orderData.contentSignature.trim()) {
      return { type: 'REJECT', error: "Document de commande corrompu : signature de contenu absente ou invalide." };
    }
    if (orderData.contentSignature !== signature) {
      return {
        type: 'REJECT',
        conflict: true,
        error: "Conflit critique : Un document de commande existe déjà avec des données divergentes sous cet identifiant."
      };
    }

    // 2.2 Identifiant de la commande
    if (!orderData.id || orderData.id !== orderId) {
      return {
        type: 'REJECT',
        error: `Incohérence d'identifiant de commande : l'identifiant du document (${orderData.id}) ne correspond pas à l'identifiant dérivé (${orderId}).`
      };
    }

    // 2.3 Restaurant associé
    if (!orderData.restaurantSlug || orderData.restaurantSlug !== restaurantSlug) {
      return {
        type: 'REJECT',
        error: `Violation d'isolation multi-tenant : le restaurant de la commande (${orderData.restaurantSlug}) ne correspond pas au restaurant de la requête (${restaurantSlug}).`
      };
    }

    // 2.4 Rattachement de la clé et du registre
    if (!orderData.idempotencyKey || orderData.idempotencyKey !== idempotencyKey) {
      return {
        type: 'REJECT',
        error: `Incohérence de rattachement : la clé d'idempotence de la commande (${orderData.idempotencyKey}) ne correspond pas à la clé de la requête (${idempotencyKey}).`
      };
    }
    if (!orderData.idempotencyDocId || orderData.idempotencyDocId !== keyDocId) {
      return {
        type: 'REJECT',
        error: `Incohérence documentaire : l'identifiant de registre de la commande (${orderData.idempotencyDocId}) ne correspond pas à l'identifiant attendu (${keyDocId}).`
      };
    }
  }

  // 3. Cohérence croisée lorsque les deux documents existent
  if (keyExists && orderExists) {
    if (keyData.orderId !== orderData.id) {
      return {
        type: 'REJECT',
        error: `Discordance critique : l'identifiant de commande du registre (${keyData.orderId}) ne correspond pas à l'identifiant du document de commande (${orderData.id}).`
      };
    }
    if (keyData.signature !== orderData.contentSignature) {
      return {
        type: 'REJECT',
        error: "Divergence interne : la signature du registre ne correspond pas à la signature de contenu de la commande."
      };
    }
    if (keyData.restaurantSlug !== orderData.restaurantSlug) {
      return {
        type: 'REJECT',
        error: "Incohérence multi-tenant : le restaurant du registre ne correspond pas au restaurant de la commande."
      };
    }

    if (keyData.status === 'completed') {
      return { type: 'REPLAY_NOMINAL', order: orderData };
    }

    if (keyData.status === 'processing' || keyData.status === 'ambiguous') {
      return { type: 'RECONCILE_AND_REPLAY', order: orderData };
    }

    return {
      type: 'REJECT',
      error: `Statut de registre incompatible avec un rejeu (${keyData.status}).`
    };
  }

  // 4. Commande existante SANS registre : Auto-réparation strictement contrôlée (Cas B)
  if (orderExists && !keyExists) {
    // La commande a déjà validé avec succès tous les contrôles d'identité, de restaurant,
    // de signature et de rattachement au point 2 ci-dessus.
    return { type: 'AUTO_REPAIR', order: orderData };
  }

  // 5. Registre existant SANS commande : Gestion du registre orphelin (Cas C)
  if (keyExists && !orderExists) {
    if (keyData.status === 'completed') {
      return {
        type: 'REJECT',
        error: "Incohérence persistante : Le registre d'idempotence valide la clé mais la commande associée est introuvable dans Firestore. Création bloquée."
      };
    }

    if (keyData.status === 'processing') {
      const recTime = keyData.createdAt || keyData.updatedAt || keyData.timestamp || 0;
      if (now - recTime < timeoutMs) {
        return {
          type: 'REJECT',
          error: "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement par une autre instance."
        };
      }
      // Timeout expiré et la commande n'a pas été écrite dans Firestore : reprise autorisée
      return { type: 'CREATE_NOMINAL' };
    }

    if (keyData.status === 'ambiguous') {
      // Clé marquée ambiguë et confirmation de l'absence de commande dans Firestore : reprise autorisée
      return { type: 'CREATE_NOMINAL' };
    }

    return {
      type: 'REJECT',
      error: `Registre orphelin dans un état non récupérable (${keyData.status}).`
    };
  }

  // 6. Aucun des deux documents n'existe : Première soumission nominale (Cas E)
  return { type: 'CREATE_NOMINAL' };
}

// Exécute la véritable transaction atomique d'idempotence Firestore en mode Fail-Closed.
// Permet l'injection directe d'une instance Firestore (adminDb de production ou Firestore Emulator).
export async function executeOrderTransactionWithDb(db: any, params: any) {
  if (!db) {
    throw new Error("Opération refusée : Instance Firestore non disponible.");
  }
  const { restaurantSlug, idempotencyKey, keyDocId, orderId, signature, orderToCreate, tableSession, staffOrder, staffTableId, staffActorUid, staffSessionVersion } = params;
  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const docRefKey = db.collection('idempotency_keys').doc(keyDocId);
  const docRefOrder = restaurantRef.collection('orders').doc(orderId);
  const isTrustedStaffOrder = staffOrder === true && typeof staffActorUid === 'string' && staffActorUid.length > 0;
  const hasTrustedStaffTable = isTrustedStaffOrder && typeof staffTableId === 'string' && staffTableId.length > 0;

  if (orderToCreate.orderMode === 'sur_place' && !tableSession && !hasTrustedStaffTable) {
    return { success: false, error: 'Commande sur place refusée : session QR sécurisée ou authentification du personnel obligatoire.' };
  }

  return await db.runTransaction(async (t: any) => {
    // Toutes les lectures de sécurité et d'idempotence sont effectuées dans la transaction
    // qui écrit la commande : une révocation concurrente provoque un conflit/retry Firestore.
    // Always read the restaurant inside the same transaction, including takeaway orders.
    // This closes the race where a restaurant is suspended after the catalogue pre-check.
    const reads: Promise<any>[] = [
      t.get(docRefKey),
      t.get(docRefOrder),
      t.get(restaurantRef)
    ];
    let staffMemberIndex = -1;
    let staffTableIndex = -1;
    if (isTrustedStaffOrder) {
      staffMemberIndex = reads.length;
      reads.push(t.get(db.collection('managers').doc(staffActorUid)));
    }
    if (tableSession) {
      reads.push(
        t.get(restaurantRef.collection('table_sessions').doc(tableSession.sessionHash)),
        t.get(restaurantRef.collection('table_qr_tokens').doc(tableSession.qrTokenHash)),
        t.get(restaurantRef.collection('tables').doc(tableSession.tableId))
      );
    } else if (hasTrustedStaffTable && orderToCreate.orderMode === 'sur_place') {
      staffTableIndex = reads.length;
      reads.push(t.get(restaurantRef.collection('tables').doc(staffTableId)));
    }
    const snapshots = await Promise.all(reads);
    const snapKey = snapshots[0];
    const snapOrder = snapshots[1];
    const snapRestaurant = snapshots[2];
    const restaurantData = snapRestaurant.exists ? snapRestaurant.data() : null;
    if (!restaurantData || restaurantData.status !== 'active' || restaurantData.deletedAt || restaurantData.isActive === false) {
      return { success: false, error: 'Commande refusée : restaurant inactif ou indisponible.' };
    }

    if (isTrustedStaffOrder) {
      const memberSnap = snapshots[staffMemberIndex];
      const member = memberSnap?.exists ? memberSnap.data() : null;
      const memberSessionMatches = Number(staffSessionVersion || 0) === Number(member?.sessionVersion || 0);
      const isOwner = member?.role === 'owner' && restaurantData.ownerUid === staffActorUid;
      const hasPosPermission = ['manager', 'cashier', 'server'].includes(member?.role) &&
        Array.isArray(member?.permissions) && member.permissions.includes('pos.access');
      if (!member || member.active !== true || member.restaurantSlug !== restaurantSlug ||
          !memberSessionMatches || (!isOwner && !hasPosPermission)) {
        return { success: false, error: 'Commande du personnel refusée : compte suspendu, session révoquée ou permission POS absente.' };
      }
    }

    if (hasTrustedStaffTable && orderToCreate.orderMode === 'sur_place' && !tableSession) {
      const staffTableSnap = snapshots[staffTableIndex];
      const staffTable = staffTableSnap?.exists ? staffTableSnap.data() : null;
      if (!staffTable || staffTable.isActive !== true ||
          String(staffTable.tableNumber || '').trim().toLowerCase() !== String(orderToCreate.tableNumber || '').trim().toLowerCase() ||
          restaurantData.isOpen === false) {
        return { success: false, error: 'Commande du personnel refusée : table inactive, numéro incohérent ou restaurant fermé.' };
      }
    }

    if (tableSession) {
      const snapSession = snapshots[3];
      const snapQr = snapshots[4];
      const snapTable = snapshots[5];
      const sessionData = snapSession.exists ? snapSession.data() : null;
      const qrData = snapQr.exists ? snapQr.data() : null;
      const tableData = snapTable.exists ? snapTable.data() : null;
      const now = Date.now();
      const valid = Boolean(
        sessionData &&
        sessionData.status === 'active' &&
        Number(sessionData.expiresAt) > now &&
        sessionData.restaurantSlug === restaurantSlug &&
        sessionData.sessionHash === tableSession.sessionHash &&
        sessionData.tableId === tableSession.tableId &&
        sessionData.qrTokenHash === tableSession.qrTokenHash &&
        Number(sessionData.qrVersion) === Number(tableSession.qrVersion) &&
        qrData &&
        qrData.status === 'active' &&
        qrData.tokenHash === tableSession.qrTokenHash &&
        qrData.restaurantSlug === restaurantSlug &&
        Number(qrData.version) === Number(sessionData.qrVersion) &&
        qrData.tableId === tableSession.tableId &&
        tableData &&
        tableData.isActive === true &&
        Number(tableData.qrVersion || 0) === Number(sessionData.qrVersion || 0) &&
        String(tableData.tableNumber || '') === String(orderToCreate.tableNumber || '') &&
        Number(sessionData.restaurantSessionVersion || 0) === Number(restaurantData.tableSessionVersion || 0) &&
        restaurantData.isOpen !== false
      );
      if (!valid) {
        return { success: false, error: 'Commande refusée : QR révoqué, session expirée, table inactive ou restaurant indisponible.' };
      }
    }

    const keyExists = snapKey.exists;
    const orderExists = snapOrder.exists;
    const keyData = keyExists ? snapKey.data() : null;
    const orderData = orderExists ? snapOrder.data() : null;

    // 2. Décision d'intégrité Fail-Closed
    const decision = evaluateOrderTransactionDecision({
      restaurantSlug,
      idempotencyKey,
      keyDocId,
      orderId,
      signature,
      keyExists,
      keyData,
      orderExists,
      orderData
    });

    if (decision.type === 'REJECT') {
      return {
        success: false,
        conflict: decision.conflict,
        error: decision.error
      };
    }

    if (decision.type === 'REPLAY_NOMINAL') {
      return {
        success: true,
        order: decision.order,
        idempotentReplay: true
      };
    }

    if (decision.type === 'RECONCILE_AND_REPLAY') {
      t.set(docRefKey, {
        id: keyDocId,
        namespacedKey: `${restaurantSlug}:${idempotencyKey}`,
        restaurantSlug,
        signature,
        orderId,
        status: 'completed',
        createdAt: keyData?.createdAt || Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
      return {
        success: true,
        order: decision.order,
        idempotentReplay: true
      };
    }

    if (decision.type === 'AUTO_REPAIR') {
      t.set(docRefKey, {
        id: keyDocId,
        namespacedKey: `${restaurantSlug}:${idempotencyKey}`,
        restaurantSlug,
        signature,
        orderId,
        status: 'completed',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      return {
        success: true,
        order: decision.order,
        idempotentReplay: true
      };
    }

    // CREATE_NOMINAL : Première soumission nominale ou reprise après échec.
    // Persist only the non-secret QR session binding so later customer payments
    // can prove that the order originated from this exact table session.
    const orderToStore = tableSession ? {
      ...orderToCreate,
      tableSession: {
        sessionHash: tableSession.sessionHash,
        qrTokenHash: tableSession.qrTokenHash,
        qrVersion: Number(tableSession.qrVersion),
        tableId: tableSession.tableId
      }
    } : orderToCreate;
    t.set(docRefOrder, orderToStore);
    t.set(docRefKey, {
      id: keyDocId,
      namespacedKey: `${restaurantSlug}:${idempotencyKey}`,
      restaurantSlug,
      signature,
      orderId,
      status: 'completed',
      createdAt: keyData?.createdAt || Date.now(),
      updatedAt: Date.now()
    });

    return {
      success: true,
      order: orderToCreate,
      idempotentReplay: false
    };
  });
}

export async function executeOrderTransaction(params: any, dbOverride?: any) {
  const db = dbOverride || adminDb;
  return await executeOrderTransactionWithDb(db, params);
}

// Fournisseur Firestore serveur reposant EXCLUSIVEMENT sur Firebase Admin SDK
// Suppression totale du recours au SDK client pour les écritures de commande
export const serverFirestoreProvider: ServerFirestoreProvider = {
  async getMenuItems(restaurantSlug: string) {
    if (!adminDb) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const restaurantRef = adminDb.collection('restaurants').doc(restaurantSlug);
    const restaurantSnap = await restaurantRef.get();
    if (!restaurantSnap.exists) throw new Error("Restaurant introuvable.");
    if (restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt || restaurantSnap.data()?.isActive === false) throw new Error("Restaurant inactif ou indisponible : les commandes sont désactivées.");
    const snap = await restaurantRef.collection('menuItems').get();
    return snap.docs.map((d: any) => d.data());
  },

  async getRestaurantTaxSettings(restaurantSlug: string) {
    if (!adminDb) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const restaurantSnap = await adminDb.collection('restaurants').doc(restaurantSlug).get();
    if (!restaurantSnap.exists) throw new Error('Restaurant introuvable.');
    const restaurant = restaurantSnap.data() || {};
    return {
      taxRatePercent: Number(restaurant.taxRatePercent || 0),
      taxMode: restaurant.taxMode === 'inclusive' ? 'inclusive' as const : 'exclusive' as const
    };
  },

  async getCustomer(restaurantSlug: string, customerId: string) {
    if (!adminDb) throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    const snap = await adminDb.collection('restaurants').doc(restaurantSlug)
      .collection('customers').doc(customerId).get();
    return snap.exists ? { id: snap.id, restaurantSlug } : null;
  },

  async getTables(restaurantSlug: string) {
    if (!adminDb) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const snap = await adminDb.collection('restaurants').doc(restaurantSlug).collection('tables').get();
    return snap.docs.map((d: any) => d.data());
  },

  async saveOrder(restaurantSlug: string, order: any) {
    if (!adminDb) {
      throw new Error(
        "Écriture de commande refusée : Firebase Admin SDK n'est pas initialisé. " +
        "Le serveur ne peut pas déléguer l'écriture au SDK client."
      );
    }
    // Écriture de confiance directe via Firebase Admin SDK
    await adminDb.collection('restaurants').doc(restaurantSlug).collection('orders').doc(order.id).set(order);
  },

  // Transaction atomique unifiée Fail-Closed (L'exigence centrale 4.4 : Création et finalisation dans la même transaction Firestore)
  async executeOrderTransaction(params: any, dbOverride?: any) {
    const db = dbOverride || adminDb;
    if (!db) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    return await executeOrderTransactionWithDb(db, params);
  },

  // Sonde de vérification Firestore stricte (distingue 'found', 'not_found' et 'error')
  async getOrderById(restaurantSlug: string, orderId: string): Promise<OrderProbeResult> {
    if (!adminDb) {
      return { status: 'error', error: "Firebase Admin SDK non initialisé sur le serveur." };
    }
    try {
      const snap = await adminDb.collection('restaurants').doc(restaurantSlug).collection('orders').doc(orderId).get();
      if (snap.exists) {
        return { status: 'found', order: snap.data() as any };
      }
      return { status: 'not_found' };
    } catch (err: any) {
      console.warn(`[RestauMax Server] Erreur sonde getOrderById (${orderId}):`, err.message);
      return { status: 'error', error: err.message || String(err) };
    }
  },

  // Réservation atomique transactionnelle de la clé d'idempotence (multi-instance)
  async reserveIdempotencyKey(key: string, signature: string, timeoutMs = 15000): Promise<IdempotencyReservationResult> {
    if (!adminDb) {
      throw new Error("Opération d'idempotence persistante refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    return await adminDb.runTransaction(async (t: any) => {
      const snap = await t.get(docRef);
      const now = Date.now();
      if (snap.exists) {
        const data = snap.data() as ServerIdempotencyRecord;
        if (data.signature && data.signature !== signature) {
          return {
            status: 'conflict' as const,
            record: data,
            error: `Conflit d'idempotence : La clé "${key}" a déjà été utilisée pour une requête différente.`
          };
        }
        if (data.status === 'completed' && data.order) {
          return { status: 'completed' as const, record: data };
        }
        if (data.status === 'ambiguous' && data.pendingOrderId) {
          return { status: 'ambiguous' as const, record: data };
        }
        if (data.status === 'processing') {
          const recTime = data.createdAt || data.timestamp || 0;
          if (now - recTime < timeoutMs) {
            return {
              status: 'in_progress' as const,
              record: data,
              error: "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement par une autre instance."
            };
          }
          // Timeout expiré : reprise atomique de la réservation
        }
      }

      const newRecord: ServerIdempotencyRecord = {
        id: docRef.id,
        namespacedKey: key,
        restaurantSlug: key.includes(':') ? key.split(':')[0] : '',
        signature,
        orderId: `ord_${docRef.id}`,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        timestamp: now
      };
      t.set(docRef, newRecord);
      return { status: 'reserved' as const, record: newRecord };
    });
  },

  // Reprise atomique après confirmation d'absence
  async transitionKeyToProcessing(key: string, signature: string, fromStatus: 'ambiguous' | 'failed'): Promise<boolean> {
    if (!adminDb) return false;
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    return await adminDb.runTransaction(async (t: any) => {
      const snap = await t.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data() as ServerIdempotencyRecord;
      if (data.status !== fromStatus) return false;
      if (data.signature !== signature) return false;
      t.update(docRef, {
        status: 'processing',
        timestamp: Date.now(),
        pendingOrderId: null,
        errorReason: null
      });
      return true;
    });
  },

  async commitIdempotencyKey(key: string, order: any, signature: string): Promise<void> {
    if (!adminDb) {
      throw new Error("Impossible de confirmer l'idempotence : Firebase Admin SDK non initialisé sur le serveur.");
    }
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await adminDb.runTransaction(async (t: any) => {
      const snap = await t.get(docRef);
      if (snap.exists) {
        const data = snap.data() as ServerIdempotencyRecord;
        if (data.signature && data.signature !== signature) {
          throw new Error(`Conflit d'idempotence lors de la validation : la signature ne correspond pas.`);
        }
      }
      t.set(docRef, {
        timestamp: Date.now(),
        status: 'completed',
        order,
        signature
      });
    });
  },

  async markIdempotencyAmbiguous(key: string, orderId: string, signature: string, reason: string): Promise<void> {
    if (!adminDb) {
      throw new Error("Impossible de marquer l'état ambigu : Firebase Admin SDK non initialisé sur le serveur.");
    }
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await adminDb.runTransaction(async (t: any) => {
      const snap = await t.get(docRef);
      if (snap.exists) {
        const data = snap.data() as ServerIdempotencyRecord;
        if (data.signature && data.signature !== signature) {
          throw new Error(`Conflit de signature lors du marquage ambigu pour la clé "${key}".`);
        }
        // Strict guard: if already completed, do not downgrade to ambiguous
        if (data.status === 'completed') {
          return;
        }
      }
      t.set(docRef, {
        timestamp: Date.now(),
        status: 'ambiguous',
        pendingOrderId: orderId,
        signature,
        errorReason: reason
      });
    });
  },

  async releaseIdempotencyKey(key: string): Promise<void> {
    if (!adminDb) return;
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await docRef.delete();
  },

  async getIdempotencyRecord(key: string): Promise<ServerIdempotencyRecord | null> {
    if (!adminDb) return null;
    try {
      const snap = await adminDb.collection('idempotency_keys').doc(key).get();
      return snap.exists ? (snap.data() as ServerIdempotencyRecord) : null;
    } catch {
      return null;
    }
  },

  async saveIdempotencyRecord(key: string, record: ServerIdempotencyRecord): Promise<void> {
    if (!adminDb) {
      throw new Error("Impossible d'enregistrer l'idempotence : Firebase Admin SDK non initialisé.");
    }
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await docRef.set(record);
  },

  async deleteIdempotencyRecord(key: string): Promise<void> {
    if (!adminDb) return;
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await docRef.delete();
  }
};

// Shared handlers used by both the local Express server and Vercel serverless routes.
export function getServerHealth() {
  return {
    status: 'ok',
    hasAdminDb: Boolean(adminDb),
    projectId: appletConfig?.projectId || null,
    databaseId: appletConfig?.firestoreDatabaseId || null,
    serverTime: Date.now()
  };
}

export async function handleResolveTableQr(token: string, req?: any): Promise<{ statusCode: number; body: any; cookies?: string[]; location?: string }> {
  if (req && !isTrustedQrNavigation(req)) return { statusCode: 403, body: { success: false, error: 'Navigation QR non autorisée.' }, cookies: undefined, location: undefined };
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Service QR indisponible.' } };
  try {
    const result = await resolveTableQr(adminDb, token);
    return {
      statusCode: 302,
      location: `/r/${encodeURIComponent(result.restaurantSlug)}?table_session=1`,
      cookies: [buildSessionCookie(result.sessionSecret), buildCsrfCookie(result.csrfToken)],
      body: { success: true }
    };
  } catch (err: any) {
    return { statusCode: 400, body: { success: false, error: err?.message || 'QR code invalide.' }, cookies: undefined, location: undefined };
  }
}

export async function handleGetTableSession(req: any) {
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Service de session indisponible.' } };
  try {
    const secret = readCookie(req?.headers?.cookie, tableSessionCookieName);
    const csrfCookie = readCookie(req?.headers?.cookie, tableCsrfCookieName);
    const session = await getActiveTableSession(adminDb, secret);
    if (!session || !csrfCookie || !validateCsrf(session, csrfCookie)) {
      return { statusCode: 401, body: { success: false, error: 'Session de table absente, expirée ou révoquée.' } };
    }
    return {
      statusCode: 200,
      body: {
        success: true,
        restaurantSlug: session.restaurantSlug,
        tableId: session.tableId,
        tableNumber: session.tableNumber,
        csrfToken: csrfCookie,
        expiresAt: session.expiresAt
      }
    };
  } catch {
    return { statusCode: 401, body: { success: false, error: 'Session de table invalide.' } };
  }
}

export async function handleTableQrManagement(req: any) {
  if (!adminDb || !adminAuth) return { statusCode: 503, body: { success: false, error: 'Service de gestion QR indisponible.' } };
  const restaurantSlug = String(req?.body?.restaurantSlug || req?.query?.restaurantSlug || '').trim();
  const tableId = String(req?.body?.tableId || req?.query?.tableId || '').trim();
  if (!restaurantSlug || !tableId) return { statusCode: 400, body: { success: false, error: 'Restaurant et table obligatoires.' } };
  try {
    await authorizeTableManager(adminDb, adminAuth, req, restaurantSlug);
    if (req.method === 'POST') {
      const rawOrigin = String(process.env.APP_ORIGIN || req.headers.origin || '');
      let parsedOrigin: URL;
      try { parsedOrigin = new URL(rawOrigin); } catch {
        return { statusCode: 400, body: { success: false, error: 'Origine applicative non configurée.' } };
      }
      const localHttp = parsedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
      if ((parsedOrigin.protocol !== 'https:' && !localHttp) || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
        return { statusCode: 400, body: { success: false, error: 'APP_ORIGIN doit être une origine HTTPS canonique, sans chemin.' } };
      }
      const issued = await issueTableQr(adminDb, restaurantSlug, tableId, parsedOrigin.origin);
      return { statusCode: 201, body: { success: true, url: issued.url } };
    }
    if (req.method === 'DELETE') {
      const result = await revokeTableQr(adminDb, restaurantSlug, tableId);
      return { statusCode: 200, body: { success: true, ...result } };
    }
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  } catch (err: any) {
    const message = String(err?.message || 'Accès refusé.');
    const code = String(err?.code || '');
    const statusCode = code.startsWith('auth/') || /Authentification|Identité|Session utilisateur/.test(message)
      ? 401
      : /Accès|Permission|propriétaire|Restaurant inactif|indisponible/.test(message)
        ? 403
        : 400;
    return { statusCode, body: { success: false, error: message } };
  }
}

export async function handleCustomerPayDunyaInvoiceRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Firestore indisponible.' } };
  if (!req || !requestHasValidOrigin(req)) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }
  const input = payload && typeof payload === 'object' ? payload as any : {};
  const slug = String(input.restaurantSlug || '').trim();
  const sessionSecret = readCookie(req.headers?.cookie, tableSessionCookieName);
  const csrfCookie = readCookie(req.headers?.cookie, tableCsrfCookieName);
  const csrfHeader = req.headers?.['x-rm-csrf-token'];
  try {
    const session = await getActiveTableSession(adminDb, sessionSecret);
    if (!session || !csrfCookie || csrfHeader !== csrfCookie ||
        String(input.csrfToken || '') !== csrfCookie || !validateCsrf(session, csrfHeader)) {
      return { statusCode: 401, body: { success: false, error: 'Session QR invalide, expirée ou révoquée. Scannez à nouveau le QR de votre table.' } };
    }
    if (slug !== session.restaurantSlug) {
      return { statusCode: 403, body: { success: false, error: 'La session QR ne correspond pas à ce restaurant.' } };
    }
    const config = await loadRestaurantPayDunyaConfig(adminDb, slug, process.env);
    if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
    const requestOrigin = String(req?.headers?.origin || '').replace(/\/$/, '');
      const appOrigin = String(process.env.APP_ORIGIN || requestOrigin).replace(/\/$/, '');
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(appOrigin); } catch {
      return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN PayDunya invalide.' } };
    }
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.pathname !== '/' || !requestOrigin || parsedOrigin.origin !== requestOrigin) {
      return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN doit correspondre à l’origine HTTPS de cette version RestauMax.' } };
    }
    const result = await startPayDunyaOrderPaymentWithDb(adminDb, config.data, {
      restaurantSlug: slug,
      orderId: String(input.orderId || ''),
      actorUid: `table_${String(session.sessionHash).slice(0, 32)}`,
      actorName: 'Client QR',
      sessionVersion: Number(session.qrVersion || 0),
      idempotencyKey: String(input.idempotencyKey || ''),
      channel: String(input.channel || '') as PayDunyaCiWithdrawMode,
      amount: input.amount,
      callbackUrl: `${parsedOrigin.origin}/api/payments/paydunya-callback?restaurantSlug=${encodeURIComponent(slug)}`,
      returnUrl: `${parsedOrigin.origin}/payments/return?restaurantSlug=${encodeURIComponent(slug)}&orderId=${encodeURIComponent(String(input.orderId || ''))}`,
      cancelUrl: `${parsedOrigin.origin}/payments/return?cancelled=1&restaurantSlug=${encodeURIComponent(slug)}&orderId=${encodeURIComponent(String(input.orderId || ''))}`,
      customerTableSession: {
        sessionHash: session.sessionHash,
        qrTokenHash: session.qrTokenHash,
        qrVersion: Number(session.qrVersion || 0),
        tableId: session.tableId,
        tableNumber: String(session.tableNumber)
      }
    });
    if (result.success) return { statusCode: 200, body: result };
    return { statusCode: result.conflict ? 409 : 400, body: result };
  } catch (error: any) {
    return { statusCode: 401, body: { success: false, error: error?.message || 'Session QR invalide.' } };
  }
}

export async function handleCustomerPayDunyaReconcileRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Firestore indisponible.' } };
  if (!req || !requestHasValidOrigin(req)) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }
  const input = payload && typeof payload === 'object' ? payload as any : {};
  const slug = String(input.restaurantSlug || '').trim();
  const sessionSecret = readCookie(req.headers?.cookie, tableSessionCookieName);
  const csrfCookie = readCookie(req.headers?.cookie, tableCsrfCookieName);
  const csrfHeader = req.headers?.['x-rm-csrf-token'];
  try {
    const session = await getActiveTableSession(adminDb, sessionSecret);
    if (!session || !csrfCookie || csrfHeader !== csrfCookie ||
        String(input.csrfToken || '') !== csrfCookie || !validateCsrf(session, csrfHeader) ||
        slug !== session.restaurantSlug) {
      return { statusCode: 401, body: { success: false, error: 'Session QR invalide ou révoquée.' } };
    }
    const paymentIntentId = String(input.paymentIntentId || '');
    if (!/^pdi_[a-f0-9]{32}$/.test(paymentIntentId)) {
      return { statusCode: 400, body: { success: false, error: 'Référence de paiement QR invalide.' } };
    }
    const intentRef = adminDb.collection('restaurants').doc(slug).collection('paymentIntents').doc(paymentIntentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) return { statusCode: 404, body: { success: false, error: 'Intention de paiement introuvable.' } };
    const intent = intentSnap.data();
    const orderId = String(intent.orderId || '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
      return { statusCode: 400, body: { success: false, error: 'Référence de commande de paiement invalide.' } };
    }
    const orderRef = adminDb.collection('restaurants').doc(slug).collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.exists ? orderSnap.data() : null;
    const binding = order?.tableSession || {};
    if (!order || order.orderMode !== 'sur_place' ||
        String(order.tableNumber || '') !== String(session.tableNumber) ||
        binding.sessionHash !== session.sessionHash || binding.qrTokenHash !== session.qrTokenHash ||
        Number(binding.qrVersion) !== Number(session.qrVersion) || binding.tableId !== session.tableId) {
      return { statusCode: 403, body: { success: false, error: 'Cette commande ne correspond pas à la session QR de votre table.' } };
    }
    const config = await loadRestaurantPayDunyaConfig(adminDb, slug, process.env, true);
    if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
    const result = await reconcilePayDunyaInvoiceIntentWithDb(
      adminDb, config.data, slug, paymentIntentId
    );
    if (result.success) return { statusCode: 200, body: result };
    return { statusCode: result.conflict ? 409 : 400, body: result };
  } catch {
    return { statusCode: 401, body: { success: false, error: 'Session QR invalide.' } };
  }
}

export async function handlePayDunyaCallbackRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Firestore indisponible.' } };
  const config = await loadRestaurantPayDunyaConfig(adminDb, String(req?.query?.restaurantSlug || ''), process.env, true);
  if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
  try {
    const result = await processPayDunyaInvoiceCallbackWithDb(adminDb, config.data, payload);
    if (!result.success) return { statusCode: result.conflict ? 409 : 400, body: result };
    return { statusCode: 200, body: result };
  } catch (error: any) {
    console.error('Erreur callback PayDunya:', String(error?.message || error));
    return { statusCode: 500, body: { success: false, error: 'Notification PayDunya à retraiter.' } };
  }
}

export async function handlePayDunyaDisbursementCallbackRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Firestore indisponible.' } };
  const callbackSlug = String(req?.query?.restaurantSlug || '');
  const merchantConfig = await loadRestaurantPayDunyaConfig(adminDb, callbackSlug, process.env, true);
  // A callback may only reconcile an existing disbursement. Enabling status checks here
  // does not expose the initiation path, which remains guarded by both live flags.
  const config = merchantConfig.success ? { success: true as const, data: { ...merchantConfig.data, pushEnabled: merchantConfig.data.mode === 'live' } } : merchantConfig;
  if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
  try {
    const result = await processPayDunyaDisbursementCallbackWithDb(adminDb, config.data, payload);
    if (!result.success) return { statusCode: result.conflict ? 409 : 400, body: result };
    return { statusCode: 200, body: result };
  } catch (error: any) {
    console.error('Erreur callback décaissement PayDunya:', String(error?.message || error));
    return { statusCode: 500, body: { success: false, error: 'Notification de décaissement à retraiter.' } };
  }
}

export async function handlePaymentsRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) {
    return { statusCode: 503, body: { success: false, error: 'Service de caisse indisponible : Firebase Admin non configuré.' } };
  }
  const method = String(req?.method || '').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (method === 'POST' && (!req || !requestHasValidOrigin(req))) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }

  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };

    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const input = (payload && typeof payload === 'object') ? { ...(payload as any) } : {};
    const rawSlug = method === 'GET' ? req.query?.restaurantSlug : input.restaurantSlug;
    const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) {
      return { statusCode: 400, body: { success: false, error: 'Restaurant invalide.' } };
    }

    const restaurantRef = adminDb.collection('restaurants').doc(slug);
    const memberRef = adminDb.collection('managers').doc(decoded.uid);
    const [restaurantSnap, memberSnap] = await Promise.all([restaurantRef.get(), memberRef.get()]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(decoded.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { statusCode: 403, body: { success: false, error: 'Compte inactif, session révoquée ou accès au restaurant refusé.' } };
    }

    const isOwner = member.role === 'owner' && restaurant.ownerUid === decoded.uid;
    const canManageCash = isOwner || member.role === 'manager' ||
      (member.role === 'cashier' && Array.isArray(member.permissions) && member.permissions.includes('cash.manage'));
    const canViewCash = isOwner || member.role === 'manager' ||
      (member.role === 'cashier' && Array.isArray(member.permissions) &&
        (member.permissions.includes('cash.view') || member.permissions.includes('cash.manage') || member.permissions.includes('reports.cash.view')));

    if (method === 'GET' && String(req.query?.action || '') === 'paydunya_account_status') {
      if (!isOwner) return { statusCode: 403, body: { success: false, error: 'Seul le propriétaire vérifié peut consulter la configuration du compte marchand.' } };
      const merchantSnap = await restaurantRef.collection('_private').doc('paydunya').get();
      const merchantData = merchantSnap.exists ? merchantSnap.data() : null;
      return { statusCode: 200, body: {
        success: true,
        connected: Boolean(merchantData?.enabled === true && merchantData?.credentials),
        mode: merchantData?.enabled === true ? String(merchantData?.mode || 'test') : null
      } };
    }

    if (method === 'GET') {
      if (!canViewCash) return { statusCode: 403, body: { success: false, error: 'Votre rôle ne permet pas de consulter les encaissements.' } };
      if (String(req.query?.action || '') === 'session_status') {
        const session = await getCashSessionWithDb(adminDb, slug, decoded.uid);
        return { statusCode: 200, body: { success: true, session } };
      }
      if (String(req.query?.action || '') === 'closed_sessions_history') {
        const limitCount = Math.min(30, Math.max(1, Number(req.query?.limit || 15)));
        const closedSessions = await listClosedCashSessionsWithDb(adminDb, slug, limitCount);
        return { statusCode: 200, body: { success: true, closedSessions } };
      }
      const payments = await listRecentCashPaymentsWithDb(adminDb, slug, 100);
      return { statusCode: 200, body: { success: true, payments } };
    }

    if (!canManageCash) {
      return { statusCode: 403, body: { success: false, error: 'Votre rôle ne permet pas de gérer la caisse.' } };
    }

    if (input.action === 'configure_paydunya_account') {
      if (!isOwner) return { statusCode: 403, body: { success: false, error: 'Seul le propriétaire vérifié peut connecter le compte PayDunya.' } };
      if (input.enabled === false) {
        await adminDb.collection('restaurants').doc(slug).collection('_private').doc('paydunya')
          .set({ enabled: false, disabledAt: Date.now(), updatedAt: Date.now() }, { merge: true });
        return { statusCode: 200, body: { success: true, connected: false } };
      }
      try {
        const credentials = {
          mode: String(input.mode || 'test') as 'test' | 'live',
          masterKey: String(input.masterKey || ''),
          privateKey: String(input.privateKey || ''),
          token: String(input.token || '')
        };
        if (credentials.mode === 'live' && process.env.PAYDUNYA_LIVE_ENABLED !== 'true') {
          return { statusCode: 403, body: { success: false, error: 'Les clés Production ne peuvent pas être activées sur RestauMax pour le moment.' } };
        }
        await saveRestaurantPayDunyaCredentials(adminDb, slug, credentials, process.env);
        return { statusCode: 200, body: { success: true, connected: true, mode: credentials.mode } };
      } catch (error: any) {
        return { statusCode: 400, body: { success: false, error: String(error?.message || 'Identifiants PayDunya invalides.') } };
      }
    }

    if (input.action === 'reconcile_paydunya_payment') {
      // Settlement-only access: allow reconciling an existing invoice after merchant disconnect.
      const config = await loadRestaurantPayDunyaConfig(adminDb, slug, process.env, true);
      if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
      const result = await reconcilePayDunyaInvoiceIntentWithDb(
        adminDb, config.data, slug, String(input.paymentIntentId || '')
      );
      if (result.success) return { statusCode: 200, body: result };
      return { statusCode: result.conflict ? 409 : 400, body: result };
    }

    if (input.action === 'create_paydunya_invoice') {
      const config = await loadRestaurantPayDunyaConfig(adminDb, slug, process.env);
      if (!config.success) return { statusCode: 503, body: { success: false, error: config.error } };
      const requestOrigin = String(req?.headers?.origin || '').replace(/\/$/, '');
      const appOrigin = String(process.env.APP_ORIGIN || requestOrigin).replace(/\/$/, '');
      let parsedAppOrigin: URL;
      try { parsedAppOrigin = new URL(appOrigin); } catch {
        return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN PayDunya est invalide.' } };
      }
      if (parsedAppOrigin.protocol !== 'https:' || parsedAppOrigin.pathname !== '/' || !requestOrigin || parsedAppOrigin.origin !== requestOrigin) {
        return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN doit être https://restaumax.vercel.app.' } };
      }
      const channel = String(input.channel || '') as PayDunyaCiWithdrawMode;
      const result = await startPayDunyaOrderPaymentWithDb(adminDb, config.data, {
        restaurantSlug: slug,
        orderId: String(input.orderId || ''),
        actorUid: decoded.uid,
        actorName: String(decoded.name || decoded.email || decoded.uid),
        sessionVersion: Number(decoded.sessionVersion || 0),
        idempotencyKey: String(input.idempotencyKey || ''),
        channel,
        amount: input.amount,
        callbackUrl: `${parsedAppOrigin.origin}/api/payments/paydunya-callback?restaurantSlug=${encodeURIComponent(slug)}`,
        returnUrl: `${parsedAppOrigin.origin}/payments/return?restaurantSlug=${encodeURIComponent(slug)}&orderId=${encodeURIComponent(String(input.orderId || ''))}`,
        cancelUrl: `${parsedAppOrigin.origin}/payments/return?cancelled=1&restaurantSlug=${encodeURIComponent(slug)}&orderId=${encodeURIComponent(String(input.orderId || ''))}`
      });
      if (result.success) return { statusCode: 200, body: result };
      return { statusCode: result.conflict ? 409 : 400, body: result };
    }

    if (input.action === 'refund_paydunya_payment') {
      const canRefund = isOwner || member.role === 'manager' ||
        (member.role === 'cashier' && Array.isArray(member.permissions) &&
          member.permissions.includes('payments.refund'));
      if (!canRefund) return { statusCode: 403, body: { success: false, error: 'La permission distincte payments.refund est requise.' } };
      const merchantConfig = await loadRestaurantPayDunyaConfig(adminDb, slug, process.env);
      const payoutConfig = merchantConfig.success ? { success: true as const, data: { ...merchantConfig.data, pushEnabled: merchantConfig.data.mode === 'live' && process.env.PAYDUNYA_LIVE_ENABLED === 'true' && process.env.PAYDUNYA_PUSH_ENABLED === 'true' } } : merchantConfig;
      if (!payoutConfig.success) return { statusCode: 503, body: { success: false, error: payoutConfig.error } };
      const requestOrigin = String(req?.headers?.origin || '').replace(/\/$/, '');
      const appOrigin = String(process.env.APP_ORIGIN || requestOrigin).replace(/\/$/, '');
      let parsedOrigin: URL;
      try { parsedOrigin = new URL(appOrigin); } catch {
        return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN PayDunya invalide.' } };
      }
      if (parsedOrigin.protocol !== 'https:' || parsedOrigin.pathname !== '/' || !requestOrigin || parsedOrigin.origin !== requestOrigin) {
        return { statusCode: 503, body: { success: false, error: 'APP_ORIGIN doit être https://restaumax.vercel.app.' } };
      }
      const result = await startPayDunyaRefundWithDb(adminDb, payoutConfig.data, {
        restaurantSlug: slug,
        paymentId: String(input.paymentId || ''),
        actorUid: decoded.uid,
        actorName: String(decoded.name || decoded.email || decoded.uid),
        sessionVersion: Number(decoded.sessionVersion || 0),
        amount: input.amount,
        reason: String(input.reason || ''),
        idempotencyKey: String(input.idempotencyKey || ''),
        callbackUrl: `${parsedOrigin.origin}/api/payments/paydunya-disbursement-callback?restaurantSlug=${encodeURIComponent(slug)}`
      });
      if (result.success) return { statusCode: 200, body: result };
      return { statusCode: result.conflict ? 409 : 400, body: result };
    }

    if (input.action === 'refund_cash_payment') {
      const canRefund = isOwner || member.role === 'manager' ||
        (member.role === 'cashier' && Array.isArray(member.permissions) &&
          member.permissions.includes('payments.refund'));
      if (!canRefund) {
        return { statusCode: 403, body: { success: false, error: 'La permission distincte payments.refund est requise.' } };
      }
      const refundResult = await refundCashPaymentWithDb(adminDb, {
        restaurantSlug: slug,
        paymentId: String(input.paymentId || ''),
        actorUid: decoded.uid,
        actorName: String(decoded.name || decoded.email || decoded.uid),
        sessionVersion: Number(decoded.sessionVersion || 0),
        amount: input.amount,
        reason: String(input.reason || ''),
        idempotencyKey: String(input.idempotencyKey || ''),
        cashDisbursementConfirmed: input.cashDisbursementConfirmed === true
      });
      if (refundResult.success) return { statusCode: 200, body: refundResult };
      if (refundResult.conflict) return { statusCode: 409, body: refundResult };
      return { statusCode: 400, body: refundResult };
    }

    const sessionInput = {
      restaurantSlug: slug,
      actorUid: decoded.uid,
      actorName: String(decoded.name || decoded.email || decoded.uid),
      sessionVersion: Number(decoded.sessionVersion || 0),
      openingBalance: input.openingBalance,
      closingCount: input.closingCount,
      idempotencyKey: String(input.idempotencyKey || '')
    };
    if (input.action === 'open_session') {
      const result = await openCashSessionWithDb(adminDb, sessionInput);
      if (result.success) return { statusCode: 200, body: result };
      if (result.conflict) return { statusCode: 409, body: result };
      return { statusCode: 400, body: result };
    }
    if (input.action === 'close_session') {
      const result = await closeCashSessionWithDb(adminDb, sessionInput);
      if (result.success) return { statusCode: 200, body: result };
      if (result.conflict) return { statusCode: 409, body: result };
      return { statusCode: 400, body: result };
    }
    if (input.action === 'record_cash_movement') {
      const result = await recordCashMovementWithDb(adminDb, {
        restaurantSlug: slug,
        actorUid: decoded.uid,
        actorName: String(decoded.name || decoded.email || decoded.uid),
        sessionVersion: Number(decoded.sessionVersion || 0),
        movementType: input.movementType,
        amount: input.amount,
        category: String(input.category || ''),
        note: String(input.note || ''),
        idempotencyKey: String(input.idempotencyKey || '')
      });
      if (result.success) return { statusCode: 200, body: result };
      if (result.conflict) return { statusCode: 409, body: result };
      return { statusCode: 400, body: result };
    }

    const result = await recordCashPaymentWithDb(adminDb, {
      restaurantSlug: slug,
      orderId: String(input.orderId || ''),
      actorUid: decoded.uid,
      actorName: String(decoded.name || decoded.email || decoded.uid),
      sessionVersion: Number(decoded.sessionVersion || 0),
      amountTendered: input.amountTendered,
      splitGuests: input.splitGuests === undefined ? 1 : Number(input.splitGuests),
      guestNumber: input.guestNumber === undefined ? 1 : Number(input.guestNumber),
      guestName: String(input.guestName || ''),
      idempotencyKey: String(input.idempotencyKey || '')
    });
    if (result.success) return { statusCode: 200, body: result };
    if (result.conflict) return { statusCode: 409, body: result };
    return { statusCode: 400, body: result };
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/auth|token|revoked|expired/i.test(message)) {
      return { statusCode: 401, body: { success: false, error: 'Session du personnel invalide. Reconnectez-vous.' } };
    }
    console.error('Erreur API paiements:', message || String(err));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne lors du traitement du paiement.' } };
  }
}

export async function handlePosOrderSubmission(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) {
    return { statusCode: 503, body: { success: false, error: 'Service POS indisponible : Firebase Admin non configuré.' } };
  }
  if (!req || !requestHasValidOrigin(req)) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }

  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };

    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const input = (payload && typeof payload === 'object') ? { ...(payload as any) } : {};
    const slug = typeof input.restaurantSlug === 'string' ? input.restaurantSlug.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) {
      return { statusCode: 400, body: { success: false, error: 'Restaurant invalide.' } };
    }
    if (!['sur_place', 'a_emporter'].includes(input.orderMode)) {
      return { statusCode: 400, body: { success: false, error: 'Mode de commande invalide.' } };
    }

    const restaurantRef = adminDb.collection('restaurants').doc(slug);
    const membershipRef = adminDb.collection('managers').doc(decoded.uid);
    const [restaurantSnap, membershipSnap] = await Promise.all([restaurantRef.get(), membershipRef.get()]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = membershipSnap.exists ? membershipSnap.data() : null;

    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(decoded.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { statusCode: 403, body: { success: false, error: 'Compte inactif ou accès à ce restaurant refusé.' } };
    }

    const isOwner = member.role === 'owner' && restaurant.ownerUid === decoded.uid;
    const canUsePos = isOwner || (
      ['manager', 'cashier', 'server'].includes(member.role) &&
      Array.isArray(member.permissions) && member.permissions.includes('pos.access')
    );
    if (!canUsePos) {
      return { statusCode: 403, body: { success: false, error: 'Votre rôle ne permet pas de créer une commande depuis le POS.' } };
    }

    input.tableNumber = input.orderMode === 'sur_place' ? String(input.tableNumber || '').trim() : null;
    delete input.tableSession;

    const staffProvider: ServerFirestoreProvider = {
      ...serverFirestoreProvider,
      async executeOrderTransaction(params) {
        return executeOrderTransactionWithDb(adminDb, {
          ...params,
          staffOrder: true,
          staffActorUid: decoded.uid,
          staffSessionVersion: Number(decoded.sessionVersion || 0)
        });
      }
    };
    const result = await processOrderSubmission(input, staffProvider);
    if (result.success) return { statusCode: 200, body: result };
    if (result.conflict) return { statusCode: 409, body: result };
    return { statusCode: 400, body: result };
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/auth|token|revoked|expired/i.test(message)) {
      return { statusCode: 401, body: { success: false, error: 'Session du personnel invalide. Reconnectez-vous.' } };
    }
    console.error('Erreur API POS:', message || String(err));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne lors de la création de la commande POS.' } };
  }
}

export async function handleOrderSubmission(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb) {
    return { statusCode: 503, body: { success: false, error: 'Service de commande indisponible : Firebase Admin non configuré.' } };
  }
  if (!req || !requestHasValidOrigin(req)) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }
  try {
    const input = (payload && typeof payload === 'object') ? { ...(payload as any) } : {};
    if (input.orderMode === 'sur_place') {
      const sessionSecret = readCookie(req.headers?.cookie, tableSessionCookieName);
      const csrfCookie = readCookie(req.headers?.cookie, tableCsrfCookieName);
      const csrfHeader = req.headers?.['x-rm-csrf-token'];
      const session = await getActiveTableSession(adminDb, sessionSecret);
      if (!session || !csrfCookie || csrfHeader !== csrfCookie || !validateCsrf(session, csrfHeader)) {
        return { statusCode: 401, body: { success: false, error: 'Session de table invalide, expirée ou révoquée. Scannez à nouveau le QR de votre table.' } };
      }
      if (String(input.restaurantSlug || '') !== session.restaurantSlug) {
        return { statusCode: 403, body: { success: false, error: 'La session de table ne correspond pas à ce restaurant.' } };
      }
      // La table est exclusivement dérivée de la session serveur. La valeur client est ignorée.
      input.tableNumber = session.tableNumber;
      input.tableSession = {
        sessionHash: session.sessionHash,
        qrTokenHash: session.qrTokenHash,
        qrVersion: session.qrVersion,
        tableId: session.tableId
      };
    } else if (input.orderMode === 'a_emporter') {
      input.tableNumber = null;
      delete input.tableSession;
    }
    const result = await processOrderSubmission(input, serverFirestoreProvider);
    if (result.success) {
      const safeOrder = result.order ? { ...result.order } as any : undefined;
      if (safeOrder) delete safeOrder.tableSession;
      return { statusCode: 200, body: { ...result, order: safeOrder } };
    }
    if (result.conflict) return { statusCode: 409, body: result };
    return { statusCode: 400, body: result };
  } catch (err: any) {
    console.error('Erreur inattendue API /api/orders:', err?.message || String(err));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne du serveur lors du traitement de la commande.' } };
  }
}

export async function handleSubscriptionReconcileRequest(req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb) return { statusCode: 503, body: { success: false, error: 'Service d’abonnement indisponible.' } };
  if (String(req?.method || '').toUpperCase() !== 'GET') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  const expectedSecret = String(process.env.RESTAUMAX_SUBSCRIPTION_CRON_SECRET || '');
  const authorization = String(req?.headers?.authorization || '');
  if (!expectedSecret || authorization !== 'Bearer ' + expectedSecret) {
    return { statusCode: 401, body: { success: false, error: 'Authentification du planificateur invalide.' } };
  }
  try {
    const result = await reconcileSubscriptionBillingWithDb(adminDb);
    return { statusCode: result.success ? 200 : 500, body: result };
  } catch (error: any) {
    console.error('[RestauMax subscription billing] Reconciliation failed:', error?.message || String(error));
    return { statusCode: 500, body: { success: false, error: 'Échec de la facturation récurrente.' } };
  }
}

export async function handleFinancialReportRequest(req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) return { statusCode: 503, body: { success: false, error: 'Service de rapports indisponible.' } };
  if (String(req?.method || '').toUpperCase() !== 'GET') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  if (!req || !requestHasValidOrigin(req)) return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const restaurantSlug = String(req.query?.restaurantSlug || '').trim();
    const from = req.query?.from ? Number(req.query.from) : undefined;
    const to = req.query?.to ? Number(req.query.to) : undefined;
    const result = await getFinancialReportWithDb(adminDb, {
      restaurantSlug, actorUid: decoded.uid,
      sessionVersion: Number(decoded.sessionVersion || 0), from, to
    });
    return result.success ? { statusCode: 200, body: result } : { statusCode: 403, body: result };
  } catch (error: any) {
    console.error('[RestauMax financial reports] Request failed:', error?.message || String(error));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne pendant le calcul des rapports.' } };
  }
}

export async function handleInventoryRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) return { statusCode: 503, body: { success: false, error: 'Service de stock indisponible : Firebase Admin non configuré.' } };
  if (String(req?.method || '').toUpperCase() !== 'POST') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  if (!req || !requestHasValidOrigin(req)) return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const input = payload && typeof payload === 'object' ? { ...(payload as any) } : {};
    const restaurantSlug = typeof input.restaurantSlug === 'string' ? input.restaurantSlug.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) return { statusCode: 400, body: { success: false, error: 'Restaurant invalide.' } };
    const result = await manageInventoryWithDb(adminDb, {
      ...input, restaurantSlug, actorUid: decoded.uid,
      sessionVersion: Number(decoded.sessionVersion || 0)
    });
    return result.success ? { statusCode: 200, body: result } : { statusCode: 403, body: result };
  } catch (error: any) {
    console.error('Erreur API gestion stock:', error?.message || String(error));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne pendant la gestion du stock.' } };
  }
}

export async function handleOrderStatusRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) return { statusCode: 503, body: { success: false, error: 'Service de commande indisponible : Firebase Admin non configuré.' } };
  if (String(req?.method || '').toUpperCase() !== 'POST') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  if (!req || !requestHasValidOrigin(req)) return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const input = payload && typeof payload === 'object' ? payload as any : {};
    const restaurantSlug = String(input.restaurantSlug || '').trim();
    const orderId = String(input.orderId || '').trim();
    const targetStatus = input.status;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug) || !/^[a-zA-Z0-9_-]{1,160}$/.test(orderId)) {
      return { statusCode: 400, body: { success: false, error: 'Restaurant ou commande invalide.' } };
    }
    const result = await transitionOrderStatusWithDb(adminDb, { restaurantSlug, orderId, targetStatus, actorUid: decoded.uid, sessionVersion: Number(decoded.sessionVersion || 0) });
    if (result.success) return { statusCode: 200, body: result };
    const errorMessage = 'error' in result ? String(result.error || '') : '';
    return { statusCode: errorMessage.includes('Transition refusée') ? 409 : 403, body: result };
  } catch (error: any) {
    console.error('[RestauMax order status] Request failed:', error?.message || String(error));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne pendant la transition de commande.' } };
  }
}
export async function handleKitchenItemRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
  if (!adminDb || !adminAuth) {
    return { statusCode: 503, body: { success: false, error: 'Service cuisine indisponible : Firebase Admin non configuré.' } };
  }
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  }
  if (!req || !requestHasValidOrigin(req)) {
    return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  }

  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const input = payload && typeof payload === 'object' ? { ...(payload as any) } : {};
    const restaurantSlug = typeof input.restaurantSlug === 'string' ? input.restaurantSlug.trim() : '';
    const orderId = typeof input.orderId === 'string' ? input.orderId.trim() : '';
    const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
    const itemIndex = input.itemIndex;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug) ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(orderId) ||
        !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex > 99 ||
        typeof input.completed !== 'boolean' ||
        itemId !== `ki-${orderId}-${itemIndex}`) {
      return { statusCode: 400, body: { success: false, error: 'Données de préparation invalides.' } };
    }

    const result = await updateKitchenItemCompletionWithDb(adminDb, {
      restaurantSlug,
      orderId,
      itemId,
      itemIndex,
      completed: input.completed,
      actorUid: decoded.uid,
      sessionVersion: Number(decoded.sessionVersion || 0)
    });
    return result.success
      ? { statusCode: 200, body: result }
      : { statusCode: 403, body: result };
  } catch (error: any) {
    console.error('Erreur API progression cuisine:', error?.message || String(error));
    return { statusCode: 500, body: { success: false, error: 'Erreur interne pendant la mise à jour cuisine.' } };
  }
}

// Shared platform administration handler used by Express and Vercel.
export async function handlePlatformAdmin(req: any, res: any, db: any = adminDb) {
  return runPlatformAdmin(req, res, db);
}

// Local Express routes. Vercel uses the equivalent files in /api.
app.all('/api/platform-admin', async (req, res) => {
  await handlePlatformAdmin(req, res);
});

app.post('/api/order-status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleOrderStatusRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});
app.post('/api/kitchen-item', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleKitchenItemRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/payments/customer-paydunya', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const result = await handleCustomerPayDunyaInvoiceRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/payments/customer-paydunya-reconcile', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const result = await handleCustomerPayDunyaReconcileRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/payments/paydunya-disbursement-callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handlePayDunyaDisbursementCallbackRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/payments/paydunya-callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handlePayDunyaCallbackRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.all('/api/payments', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handlePaymentsRequest(req.method === 'GET' ? undefined : req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.get('/api/subscription-reconcile', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleSubscriptionReconcileRequest(req);
  return res.status(result.statusCode).json(result.body);
});

app.get('/api/financial-reports', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleFinancialReportRequest(req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/inventory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleInventoryRequest(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/pos-orders', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handlePosOrderSubmission(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.post('/api/orders', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleOrderSubmission(req.body, req);
  return res.status(result.statusCode).json(result.body);
});

app.get('/q/:token', async (req, res) => {
  const result = await handleResolveTableQr(String(req.params.token || ''), req);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  if (result.cookies) res.setHeader('Set-Cookie', result.cookies);
  if (result.location) return res.redirect(result.statusCode, result.location);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const message = result.statusCode === 503
    ? 'Le service de vérification est momentanément indisponible. Réessayez dans quelques instants ou contactez le personnel.'
    : 'Ce QR code est invalide, révoqué ou associé à une table indisponible. Demandez un nouveau QR au personnel.';
  return res.status(result.statusCode).send('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR RestauMax indisponible</title><body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;display:grid;min-height:100vh;place-items:center;margin:0;padding:24px"><main style="max-width:440px;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 40px #10203018"><h1 style="font-size:22px">QR de table indisponible</h1><p style="line-height:1.6">' + message + '</p><p style="font-size:13px;color:#64748b">RestauMax — Sécurité des commandes</p></main></body></html>');
});

app.get('/api/table-session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleGetTableSession(req);
  return res.status(result.statusCode).json(result.body);
});

app.all('/api/tables/qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleTableQrManagement(req);
  return res.status(result.statusCode).json(result.body);
});

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(getServerHealth());
});

// 5. Middleware Vite en développement / Fichiers statiques en production
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur RestauMax actif sur http://0.0.0.0:${PORT} (Mode: ${isProd ? 'production' : 'développement'})`);
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  startServer().catch((err) => {
    console.error('Erreur fatale au démarrage du serveur:', err);
    process.exit(1);
  });
}
