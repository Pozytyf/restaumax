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
app.use(express.json());

// 1. Initialisation stricte de Firebase Admin SDK
let adminDb: any = null;
let adminInitError: string | null = null;
let appletConfig: { projectId: string; firestoreDatabaseId: string } | null = null;

try {
  appletConfig = getAppletFirebaseConfig();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credPath && fs.existsSync(credPath)) {
    const serviceAccount = validateServiceAccountCredentials(credPath, appletConfig.projectId);
    const adminApp = initAdminApp(serviceAccount, appletConfig.projectId);
    adminDb = initAdminFirestore(adminApp, appletConfig.firestoreDatabaseId);
    console.log(`[RestauMax Server] Firebase Admin SDK initialisé avec succès pour la base '${appletConfig.firestoreDatabaseId}' (Projet: ${appletConfig.projectId})`);
  } else {
    adminInitError = credPath 
      ? `Fichier de credentials spécifié introuvable : ${credPath}` 
      : "Variable GOOGLE_APPLICATION_CREDENTIALS non configurée.";
    console.warn(`[RestauMax Server] AVERTISSEMENT : Firebase Admin SDK non initialisé (${adminInitError}). Le traitement de commandes sera désactivé.`);
  }
} catch (err: any) {
  adminInitError = err.message || String(err);
  console.error(`[RestauMax Server] Erreur lors de l'initialisation de Firebase Admin SDK : ${adminInitError}`);
}

// 2. Fournisseur Firestore serveur reposant EXCLUSIVEMENT sur Firebase Admin SDK
// Suppression totale du recours au SDK client pour les écritures de commande
export const serverFirestoreProvider: ServerFirestoreProvider = {
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
          if (now - data.timestamp < timeoutMs) {
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
        timestamp: now,
        status: 'processing',
        signature
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
    await docRef.set({
      timestamp: Date.now(),
      status: 'completed',
      order,
      signature
    });
  },

  async markIdempotencyAmbiguous(key: string, orderId: string, signature: string, reason: string): Promise<void> {
    if (!adminDb) {
      throw new Error("Impossible de marquer l'état ambigu : Firebase Admin SDK non initialisé sur le serveur.");
    }
    const docRef = adminDb.collection('idempotency_keys').doc(key);
    await docRef.set({
      timestamp: Date.now(),
      status: 'ambiguous',
      pendingOrderId: orderId,
      signature,
      errorReason: reason
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

// 3. Route API : Soumission, recalcul de confiance et persistance de commande
app.post('/api/orders', async (req, res) => {
  // RÈGLE CRITIQUE D'AUDIT : Interdire formellement le traitement des commandes
  // si Firebase Admin SDK n'est pas initialisé correctement.
  if (!adminDb) {
    return res.status(503).json({
      success: false,
      error: `Service de commande indisponible : Firebase Admin SDK n'est pas initialisé sur le serveur. ` +
        `Raison : ${adminInitError || 'Identifiants administrateur absents'}. ` +
        `Pour activer le traitement des commandes en production, configurez GOOGLE_APPLICATION_CREDENTIALS ` +
        `avec un compte de service autorisé sur le projet '${appletConfig?.projectId || 'Firebase'}'. ` +
        `Les écritures directes via le SDK client sont formellement interdites par les règles Firestore.`
    });
  }

  try {
    const result = await processOrderSubmission(req.body, serverFirestoreProvider);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Erreur inattendue API /api/orders:', err);
    return res.status(500).json({
      success: false,
      error: `Erreur interne serveur lors du traitement de la commande : ${err.message || String(err)}`
    });
  }
});

// 4. Route Diagnostic / Santé du serveur
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    hasAdminDb: Boolean(adminDb),
    projectId: appletConfig?.projectId || null,
    databaseId: appletConfig?.firestoreDatabaseId || null,
    adminInitError,
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

startServer().catch((err) => {
  console.error('Erreur fatale au démarrage du serveur:', err);
  process.exit(1);
});
