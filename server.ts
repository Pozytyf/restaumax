import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { 
  processOrderSubmission, 
  ServerFirestoreProvider 
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

// Initialisation conditionnelle de Firebase Admin SDK
let adminDb: any = null;
try {
  const config = getAppletFirebaseConfig();
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    const serviceAccount = validateServiceAccountCredentials(credPath, config.projectId);
    const adminApp = initAdminApp(serviceAccount, config.projectId);
    adminDb = initAdminFirestore(adminApp, config.firestoreDatabaseId);
    console.log('Firebase Admin SDK initialisé avec succès pour la base:', config.firestoreDatabaseId);
  } else {
    console.log('GOOGLE_APPLICATION_CREDENTIALS non configuré. Mode passerelle active.');
  }
} catch (err: any) {
  console.warn('Initialisation Firebase Admin SDK:', err.message);
}

// Fournisseur Firestore serveur
export const serverFirestoreProvider: ServerFirestoreProvider = {
  async getMenuItems(restaurantSlug: string) {
    if (adminDb) {
      const snap = await adminDb.collection('restaurants').doc(restaurantSlug).collection('menuItems').get();
      return snap.docs.map((d: any) => d.data());
    }
    // Lecture directe depuis l'instance Firestore du projet
    const { getDocs, collection } = await import('firebase/firestore');
    const { db } = await import('./src/lib/firebase.js');
    const snap = await getDocs(collection(db, 'restaurants', restaurantSlug, 'menuItems'));
    return snap.docs.map(d => d.data() as any);
  },
  async getTables(restaurantSlug: string) {
    if (adminDb) {
      const snap = await adminDb.collection('restaurants').doc(restaurantSlug).collection('tables').get();
      return snap.docs.map((d: any) => d.data());
    }
    const { getDocs, collection } = await import('firebase/firestore');
    const { db } = await import('./src/lib/firebase.js');
    const snap = await getDocs(collection(db, 'restaurants', restaurantSlug, 'tables'));
    return snap.docs.map(d => d.data() as any);
  },
  async saveOrder(restaurantSlug: string, order: any) {
    if (adminDb) {
      await adminDb.collection('restaurants').doc(restaurantSlug).collection('orders').doc(order.id).set(order);
      return;
    }
    // En environnement de développement sans clé Admin, sauvegarde via le client serveur
    const { setDoc, doc } = await import('firebase/firestore');
    const { db } = await import('./src/lib/firebase.js');
    await setDoc(doc(db, 'restaurants', restaurantSlug, 'orders', order.id), order);
  }
};

// Route API : Soumission et recalcul de commande côté serveur
app.post('/api/orders', async (req, res) => {
  try {
    const result = await processOrderSubmission(req.body, serverFirestoreProvider);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Erreur API /api/orders:', err);
    return res.status(500).json({
      success: false,
      error: `Erreur interne serveur lors du traitement de la commande : ${err.message || String(err)}`
    });
  }
});

// Route Santé serveur
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    hasAdminDb: Boolean(adminDb),
    serverTime: Date.now() 
  });
});

// Middleware Vite en développement / Fichiers statiques en production
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
    console.log(`Serveur RestauMax actif sur http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Erreur au démarrage du serveur:', err);
  process.exit(1);
});
