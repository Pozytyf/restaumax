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

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { 
  processOrderSubmission,
  DEFAULT_IDEMPOTENCY_TIMEOUT_MS,
  ServerFirestoreProvider,
  ServerIdempotencyRecord,
  OrderProbeResult,
  IdempotencyReservationResult
} from './src/server/orderService.js';
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

// Cloud Run is behind Google's trusted proxy. Outside Cloud Run, trust proxy only
// when explicitly configured to avoid accepting spoofed X-Forwarded-For headers.
const trustProxySetting = (process.env.TRUST_PROXY || '').trim().toLowerCase();
if (trustProxySetting === '1' || trustProxySetting === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxySetting === '0' || trustProxySetting === 'false') {
  app.set('trust proxy', false);
} else if (process.env.K_SERVICE) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '100kb' }));

// Per-instance fixed-window protection for the public QR order endpoint.
// For multi-instance/global enforcement, add an edge or shared-store limiter before launch.
const orderRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const ORDER_RATE_LIMIT_WINDOW_MS = 60_000;
const ORDER_RATE_LIMIT_MAX_REQUESTS = 60;
const ORDER_RATE_LIMIT_MAX_CLIENTS = 10_000;

function orderSubmissionRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = orderRateLimitBuckets.get(clientIp);

  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && orderRateLimitBuckets.size >= ORDER_RATE_LIMIT_MAX_CLIENTS) {
      for (const [ip, entry] of orderRateLimitBuckets) {
        if (entry.resetAt <= now) orderRateLimitBuckets.delete(ip);
      }
      if (orderRateLimitBuckets.size >= ORDER_RATE_LIMIT_MAX_CLIENTS) {
        const oldestIp = orderRateLimitBuckets.keys().next().value;
        if (oldestIp) orderRateLimitBuckets.delete(oldestIp);
      }
    }
    bucket = { count: 0, resetAt: now + ORDER_RATE_LIMIT_WINDOW_MS };
    orderRateLimitBuckets.set(clientIp, bucket);
  }

  bucket.count += 1;
  if (bucket.count > ORDER_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      error: 'Trop de tentatives de commande depuis cette connexion. Veuillez patienter avant de réessayer.'
    });
  }

  next();
}

// 1. Initialisation stricte de Firebase Admin SDK
let adminDb: any = null;
let adminInitError: string | null = null;
let appletConfig: { projectId: string; firestoreDatabaseId: string } | null = null;

try {
  appletConfig = getAppletFirebaseConfig();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credPath) {
    if (!fs.existsSync(credPath)) {
      throw new Error("Le chemin GOOGLE_APPLICATION_CREDENTIALS est défini mais le fichier est introuvable.");
    }
    const serviceAccount = validateServiceAccountCredentials(credPath, appletConfig.projectId);
    const adminApp = initAdminApp(serviceAccount, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé avec une clé de service validée pour la base '${appletConfig.firestoreDatabaseId}'.`);
  } else if (process.env.FIRESTORE_EMULATOR_HOST || isProd) {
    // En production (Cloud Run), utiliser le compte de service attaché au runtime via ADC.
    // En CI/local, Firebase Admin détecte automatiquement FIRESTORE_EMULATOR_HOST.
    const adminApp = initAdminApp(null as any, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    const authMode = process.env.FIRESTORE_EMULATOR_HOST
      ? `émulateur Firestore (${process.env.FIRESTORE_EMULATOR_HOST})`
      : 'Application Default Credentials (ADC)';
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé via ${authMode} pour la base '${appletConfig.firestoreDatabaseId}'.`);
  } else {
    adminInitError = "Firebase Admin SDK non configuré en développement local. Configurez l'émulateur Firestore ou GOOGLE_APPLICATION_CREDENTIALS.";
    console.warn(`[RestauMax Server] ${adminInitError}`);
  }
} catch (err: any) {
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
  | { type: 'REJECT'; error: string; conflict?: boolean; uncertain?: boolean }
  | { type: 'REPLAY_NOMINAL'; order: any }
  | { type: 'RECONCILE_AND_REPLAY'; order: any }
  | { type: 'AUTO_REPAIR'; order: any }
  | { type: 'CREATE_NOMINAL' };

function getIdempotencyTimestampMillis(record: any): number | null {
  const candidates = [record?.createdAt, record?.updatedAt, record?.timestamp];
  for (const value of candidates) {
    let millis: number | null = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      millis = value;
    } else if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      const parsed = Number.isFinite(numeric) ? numeric : Date.parse(value);
      if (Number.isFinite(parsed)) millis = parsed;
    } else if (value instanceof Date) {
      millis = value.getTime();
    } else if (value && typeof value.toMillis === 'function') {
      try { millis = value.toMillis(); } catch { millis = null; }
    }
    if (millis !== null && Number.isFinite(millis) && millis > 0) return millis;
  }
  return null;
}

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
    timeoutMs = DEFAULT_IDEMPOTENCY_TIMEOUT_MS
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
        conflict: true,
        error: "La tentative précédente associée à cette clé d'idempotence s'est terminée par un échec définitif. Une nouvelle clé est nécessaire."
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
        uncertain: true,
        error: "Incohérence persistante : Le registre confirme la clé mais la commande associée est introuvable. Création bloquée; une vérification est nécessaire."
      };
    }

    if (keyData.status === 'processing') {
      const recTime = getIdempotencyTimestampMillis(keyData);
      if (recTime === null) {
        return {
          type: 'REJECT',
          uncertain: true,
          error: "Registre d'idempotence incohérent : horodatage de traitement absent ou invalide. Vérification nécessaire avant toute reprise."
        };
      }
      if (now - recTime < timeoutMs) {
        return {
          type: 'REJECT',
          uncertain: true,
          error: "Une requête identique avec cette clé d'idempotence est encore en cours. Réessayez sans modifier le panier."
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
  const { restaurantSlug, idempotencyKey, keyDocId, orderId, signature, orderToCreate } = params;
  const docRefKey = db.collection('idempotency_keys').doc(keyDocId);
  const docRefOrder = db.collection('restaurants').doc(restaurantSlug).collection('orders').doc(orderId);

  return await db.runTransaction(async (t: any) => {
    // 1. Lectures préalables obligatoires
    const [snapKey, snapOrder] = await Promise.all([
      t.get(docRefKey),
      t.get(docRefOrder)
    ]);

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
        uncertain: decision.uncertain,
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

    // CREATE_NOMINAL : Première soumission nominale ou reprise après échec
    t.set(docRefOrder, orderToCreate);
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
  async getRestaurant(restaurantSlug: string) {
    if (!adminDb) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const snapshot = await adminDb.collection('restaurants').doc(restaurantSlug).get();
    return snapshot.exists ? snapshot.data() as { isOpen?: boolean } : null;
  },

  async getMenuItems(restaurantSlug: string) {
    if (!adminDb) {
      throw new Error("Opération refusée : Firebase Admin SDK n'est pas initialisé sur le serveur.");
    }
    const snap = await adminDb.collection('restaurants').doc(restaurantSlug).collection('menuItems').get();
    return snap.docs.map((d: any) => d.data());
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
    } catch (err: any) {
      console.warn('[RestauMax Server] Échec de lecture du registre d’idempotence:', err.message || String(err));
      throw new Error('Impossible de lire le registre d’idempotence.');
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

// 3. Route API : Soumission, recalcul de confiance et persistance de commande
app.post('/api/orders', orderSubmissionRateLimiter, async (req, res) => {
  // RÈGLE CRITIQUE D'AUDIT : Interdire formellement le traitement des commandes
  // si Firebase Admin SDK n'est pas initialisé correctement.
  if (!adminDb) {
    return res.status(503).json({
      success: false,
      error: "Le service de commande est temporairement indisponible. Veuillez réessayer ultérieurement."
    });
  }

  try {
    const result = await processOrderSubmission(req.body, serverFirestoreProvider);
    if (result.success) {
      return res.status(200).json(result);
    } else if (result.conflict) {
      return res.status(409).json(result);
    } else if (result.uncertain) {
      return res.status(503).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Erreur inattendue API /api/orders:', err);
    return res.status(500).json({
      success: false,
      uncertain: true,
      error: "La confirmation de la commande est incertaine. Réessayez avec la même clé sans modifier le panier."
    });
  }
});

// 4. Route Diagnostic / Santé du serveur
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    orderSubmissionEnabled: Boolean(adminDb),
    serverTime: Date.now()
  });
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
