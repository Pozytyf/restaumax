import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  signOut, 
  onIdTokenChanged, 
  getIdTokenResult,
  connectAuthEmulator,
  type User
} from 'firebase/auth';

export type { User };
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocFromServer,
  getDocs,
  setDoc, 
  deleteDoc,
  runTransaction,
  collection, 
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  connectFirestoreEmulator
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { 
  RestaurantInfo, 
  RestauMenuItem, 
  RestauOrder, 
  RestaurantTable,
  ClientCartItem,
  OrderMode 
} from '../types/restaumax';

// Resolve Preview Firebase settings from Vercel environment variables.
// Production keeps using the committed Production config; Preview fails closed
// unless every required public setting explicitly targets restaumax-demo.
const viteEnv = import.meta.env;
const isDemoPreview = viteEnv?.VITE_APP_ENV === 'preview';
const resolvedFirebaseConfig = {
  ...firebaseConfig,
  apiKey: viteEnv?.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: viteEnv?.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: viteEnv?.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: viteEnv?.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: viteEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: viteEnv?.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: viteEnv?.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId,
  firestoreDatabaseId: viteEnv?.VITE_FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId,
};

if (isDemoPreview) {
  const requiredPreviewValues = [
    viteEnv?.VITE_FIREBASE_API_KEY,
    viteEnv?.VITE_FIREBASE_AUTH_DOMAIN,
    viteEnv?.VITE_FIREBASE_PROJECT_ID,
    viteEnv?.VITE_FIREBASE_STORAGE_BUCKET,
    viteEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID,
    viteEnv?.VITE_FIREBASE_APP_ID,
    viteEnv?.VITE_FIRESTORE_DATABASE_ID,
  ];
  if (resolvedFirebaseConfig.projectId !== 'restaumax-demo' || requiredPreviewValues.some((value) => !value)) {
    throw new Error('[RestauMax] Configuration Demo invalide : toutes les variables Firebase Preview doivent être définies et cibler restaumax-demo.');
  }
}

// Initialize Firebase only after validating the selected environment.
const app = getApps().length > 0 ? getApp() : initializeApp(resolvedFirebaseConfig);

// CRITICAL: Always use the explicitly selected Firestore database.
export const db = getFirestore(app, resolvedFirebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Isolate local development from production Firebase when explicitly requested.
// The server uses FIRESTORE_EMULATOR_HOST; the browser SDK needs its own connections.
// import.meta.env is injected by Vite in the browser but absent when this module
// is imported directly by Node-based unit tests.
const useFirebaseEmulators =
  viteEnv?.DEV === true &&
  viteEnv?.VITE_USE_FIREBASE_EMULATOR === 'true';

if (useFirebaseEmulators) {
  const emulatorHost = viteEnv?.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
  const rawFirestorePort = Number(viteEnv?.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  const firestorePort =
    Number.isInteger(rawFirestorePort) && rawFirestorePort > 0 && rawFirestorePort <= 65535
      ? rawFirestorePort
      : 8080;
  const authEmulatorUrl =
    viteEnv?.VITE_FIREBASE_AUTH_EMULATOR_URL || `http://${emulatorHost}:9099`;

  connectFirestoreEmulator(db, emulatorHost, firestorePort);
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  console.info(
    `[RestauMax] Firebase Emulator activé (Firestore: ${emulatorHost}:${firestorePort}, Auth: ${authEmulatorUrl}).`
  );
}

// Error Handling Specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Validates connection to Firestore at boot time
 */
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Client Firestore hors ligne. Vérification de la configuration Firebase.");
      return false;
    }
    // Connection test is benign, non-fatal if document does not exist
    return true;
  }
}

/**
 * Seeds initial restaurant and menu items data if Firestore is currently empty
 */
export async function seedInitialFirestoreData(
  defaultRestaurant: RestaurantInfo, 
  defaultItems: RestauMenuItem[]
): Promise<void> {
  const restaurantRef = doc(db, 'restaurants', defaultRestaurant.slug);
  const restaurantSnap = await getDoc(restaurantRef);

  if (!restaurantSnap.exists()) {
    const batch = writeBatch(db);
    batch.set(restaurantRef, defaultRestaurant);

    for (const item of defaultItems) {
      const itemRef = doc(db, 'restaurants', defaultRestaurant.slug, 'menuItems', item.id);
      batch.set(itemRef, item);
    }

    await batch.commit();
  }
}

/**
 * Subscribe in real time to restaurant info
 */
export function subscribeToRestaurant(
  slug: string, 
  onData: (restaurant: RestaurantInfo) => void,
  onError?: (err: unknown) => void
) {
  const path = `restaurants/${slug}`;
  const restaurantRef = doc(db, 'restaurants', slug);

  return onSnapshot(
    restaurantRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as RestaurantInfo);
      }
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.GET, path);
      }
    }
  );
}

/**
 * Subscribe in real time to menu items subcollection
 */
export function subscribeToMenuItems(
  slug: string,
  onData: (items: RestauMenuItem[]) => void,
  onError?: (err: unknown) => void
) {
  const path = `restaurants/${slug}/menuItems`;
  const itemsRef = collection(db, 'restaurants', slug, 'menuItems');
  const q = query(itemsRef);

  return onSnapshot(
    q,
    (snapshot) => {
      const items: RestauMenuItem[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as RestauMenuItem);
      });
      onData(items);
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Persist restaurant changes (e.g. toggle isOpen)
 */
export async function persistRestaurant(restaurant: RestaurantInfo): Promise<void> {
  const path = `restaurants/${restaurant.slug}`;
  try {
    const restaurantRef = doc(db, 'restaurants', restaurant.slug);
    await setDoc(restaurantRef, restaurant, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Persist dish creation or edition
 */
export async function persistMenuItem(restaurantSlug: string, item: RestauMenuItem): Promise<void> {
  const path = `restaurants/${restaurantSlug}/menuItems/${item.id}`;
  try {
    const itemRef = doc(db, 'restaurants', restaurantSlug, 'menuItems', item.id);
    await setDoc(itemRef, item, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Persist dish availability toggle
 */
export async function persistDishAvailability(restaurantSlug: string, dishId: string, available: boolean): Promise<void> {
  const path = `restaurants/${restaurantSlug}/menuItems/${dishId}`;
  try {
    const itemRef = doc(db, 'restaurants', restaurantSlug, 'menuItems', dishId);
    await setDoc(itemRef, { available }, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Permanently remove a menu item. Firestore rules restrict this to an authenticated
 * manager of the restaurant; historical orders keep their own item snapshots.
 */
export async function deleteMenuItem(restaurantSlug: string, dishId: string): Promise<void> {
  const path = `restaurants/${restaurantSlug}/menuItems/${dishId}`;
  const menuItemRef = doc(db, 'restaurants', restaurantSlug, 'menuItems', dishId);
  const recipeRef = doc(db, 'restaurants', restaurantSlug, 'menuRecipes', dishId);
  try {
    await runTransaction(db, async (transaction) => {
      const [menuItemSnapshot, recipeSnapshot] = await Promise.all([
        transaction.get(menuItemRef),
        transaction.get(recipeRef)
      ]);
      // Delete the private recipe and its menu item atomically. Firestore rules
      // require both documents to be absent after the same transaction.
      if (recipeSnapshot.exists()) transaction.delete(recipeRef);
      if (menuItemSnapshot.exists()) transaction.delete(menuItemRef);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Checks if a given Firebase user has the manager role:
 * 1. Via Custom Claims (role === 'manager' or 'admin')
 * 2. Via trusted server-side document in /managers/{uid}
 */
export async function checkIsManager(user: User | null): Promise<boolean> {
  if (!user) return false;

  try {
    const tokenResult = await getIdTokenResult(user);

    // Restaurant operational access requires a trusted tenant membership.
    // Platform super-admins must use /admin and never inherit restaurant operations.
    const managerDocRef = doc(db, 'managers', user.uid);
    const managerDoc = await getDoc(managerDocRef);
    const data = managerDoc.exists() ? managerDoc.data() : null;
    if (
      !data ||
      data.active !== true ||
      Number(tokenResult.claims?.sessionVersion || 0) !== Number(data.sessionVersion || 0) ||
      !['owner', 'manager', 'cashier', 'server', 'kitchen'].includes(data.role) ||
      typeof data.restaurantSlug !== 'string' ||
      !data.restaurantSlug
    ) return false;

    const restaurantSnap = await getDoc(doc(db, 'restaurants', data.restaurantSlug));
    if (!restaurantSnap.exists() || restaurantSnap.data()?.status !== 'active' || restaurantSnap.data()?.deletedAt) return false;
    if (data.role === 'owner') return restaurantSnap.data()?.ownerUid === user.uid;
    return true;
  } catch (err) {
    console.warn('Erreur lors de la vérification des privilèges gestionnaire:', err);
    return false;
  }
}

/**
 * Signs in a manager with email and password, verifying privileges.
 * Returns generic error message without revealing sensitive details.
 */
export async function signInManager(
  email: string, 
  password: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const hasRole = await checkIsManager(cred.user);

    if (!hasRole) {
      // Disconnect immediately if the authenticated account lacks manager privileges
      await signOut(auth);
      return {
        success: false,
        error: "Ce compte ne dispose pas des privilèges de gestion requis. Accès refusé."
      };
    }

    return { success: true, user: cred.user };
  } catch (err: any) {
    const code = err?.code;
    let message = "Identifiants invalides ou accès non autorisé.";

    if (
      code === 'auth/user-not-found' || 
      code === 'auth/wrong-password' || 
      code === 'auth/invalid-credential'
    ) {
      message = "Adresse e-mail ou mot de passe incorrect.";
    } else if (code === 'auth/too-many-requests') {
      message = "Trop de tentatives infructueuses. Veuillez patienter avant de réessayer.";
    } else if (code === 'auth/user-disabled') {
      message = "Ce compte d'accès a été désactivé.";
    }

    return { success: false, error: message };
  }
}

/**
 * Envoie un lien de réinitialisation du mot de passe via Firebase Authentication.
 * Le message côté interface reste générique pour ne pas révéler si un compte existe.
 */
export async function requestManagerPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
    return { success: true };
  } catch (err: any) {
    const code = err?.code;
    if (code === 'auth/invalid-email') {
      return { success: false, error: "L'adresse e-mail saisie n'est pas valide." };
    }
    if (code === 'auth/too-many-requests') {
      return { success: false, error: "Trop de demandes. Veuillez patienter avant de réessayer." };
    }
    console.error('Erreur de demande de réinitialisation du mot de passe:', code || err);
    return { success: false, error: "Impossible d'envoyer le lien pour le moment. Réessayez plus tard." };
  }
}

/**
 * Signs out the manager
 */
export async function signOutManager(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribes to Firebase Auth state changes and evaluates manager authorization
 */
export function subscribeToAuth(
  callback: (user: User | null, isAuthorizedManager: boolean) => void
) {
  return onIdTokenChanged(auth, async (user) => {
    if (!user) {
      callback(null, false);
      return;
    }
    const isAuthorized = await checkIsManager(user);
    callback(user, isAuthorized);
  });
}

/**
 * Valide et soumet une commande en effectuant un recalcul strict côté serveur
 * via l'API sécurisée /api/orders (recalcul de prix depuis Firestore de référence,
 * validation des options, extras et tables, détection des falsifications et idempotence atomique).
 */
export async function submitOrderWithServerValidation(
  restaurantSlug: string,
  params: {
    cart: ClientCartItem[];
    orderMode: OrderMode;
    tableNumber: string | null;
    idempotencyKey: string;
    customerNote?: string;
    allowedTables?: RestaurantTable[];
    declaredTotal?: number;
    fallbackCatalog?: RestauMenuItem[];
    csrfToken?: string;
  }
): Promise<{ success: true; order: RestauOrder; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.csrfToken ? { 'X-RM-CSRF-Token': params.csrfToken } : {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        restaurantSlug,
        orderMode: params.orderMode,
        customerNote: params.customerNote,
        declaredTotal: params.declaredTotal,
        idempotencyKey: params.idempotencyKey,
        cart: params.cart,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return {
        success: false,
        conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Erreur lors de la validation serveur de la commande.',
      };
    }

    return {
      success: true,
      order: data.order,
      idempotentReplay: data.idempotentReplay === true,
    };
  } catch (err: any) {
    console.error('Erreur appel /api/orders:', err);
    return {
      success: false,
      error: err?.message || 'Erreur réseau lors de la communication avec le serveur RestauMax.',
    };
  }
}

/**
 * Soumet une commande POS après authentification du personnel.
 * Contrairement au parcours QR client, les commandes sur place sont autorisées
 * via le contrôle serveur du rôle, du restaurant et de la table active.
 */
export async function submitPosOrderWithServerValidation(
  restaurantSlug: string,
  params: {
    cart: ClientCartItem[];
    orderMode: OrderMode;
    tableNumber: string | null;
    idempotencyKey: string;
    customerNote?: string;
  }
): Promise<{ success: true; order: RestauOrder; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/pos-orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        restaurantSlug,
        orderMode: params.orderMode,
        tableNumber: params.tableNumber,
        customerNote: params.customerNote,
        idempotencyKey: params.idempotencyKey,
        cart: params.cart,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return {
        success: false,
        conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Erreur lors de la validation serveur de la commande POS.',
      };
    }
    return { success: true, order: data.order, idempotentReplay: data.idempotentReplay === true };
  } catch (err: any) {
    console.error('Erreur appel /api/pos-orders:', err);
    return { success: false, error: err?.message || 'Erreur réseau lors de la communication avec le serveur RestauMax.' };
  }
}

export interface CashPaymentApiRecord {
  id: string;
  restaurantSlug: string;
  cashSessionId?: string;
  orderId: string;
  orderNumber: string;
  tableNumber: string | null;
  actorUid: string;
  actorName: string;
  actorRole: string;
  method: 'especes';
  currency: string;
  amountTendered: number;
  paidAmount: number;
  changeAmount: number;
  totalAmount: number;
  splitGuests?: number;
  guestAccountId?: string;
  guestNumber?: number;
  guestName?: string;
  guestShareAmount?: number;
  guestPreviouslyPaidAmount?: number;
  guestRemainingBefore?: number;
  guestRemainingAfter?: number;
  previouslyPaidAmount: number;
  remainingBefore: number;
  remainingAfter: number;
  paymentStatus: 'partial' | 'paid';
  items: any[];
  createdAt: number;
}

export interface CashMovementApiRecord {
  id: string;
  sessionId: string;
  movementType: 'expense' | 'withdrawal';
  amount: number;
  category: string;
  note?: string;
  actorName: string;
  createdAt: number;
}

export interface CashSessionApiRecord {
  id: string;
  restaurantSlug: string;
  openedByUid: string;
  openedByName: string;
  openingBalance: number;
  cashCollected: number;
  paymentCount: number;
  cashOut: number;
  cashMovementCount: number;
  cashMovements?: CashMovementApiRecord[];
  status: 'active' | 'closed';
  openedAt: number;
  closedAt?: number;
  closingCount?: number;
  expectedCash?: number;
  variance?: number;
}

async function cashSessionRequest(
  restaurantSlug: string,
  body?: Record<string, unknown>,
  action = 'session_status'
): Promise<{ success: true; session: CashSessionApiRecord | null; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch(
      body ? '/api/payments' : `/api/payments?restaurantSlug=${encodeURIComponent(restaurantSlug)}&action=${encodeURIComponent(action)}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${idToken}`,
        },
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body ? { body: JSON.stringify({ restaurantSlug, ...body }) } : {}),
      }
    );
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Opération de caisse refusée.' };
    }
    return { success: true, session: data.session || null, idempotentReplay: data.idempotentReplay === true };
  } catch (err: any) {
    console.error('Erreur API session de caisse:', err);
    return { success: false, error: err?.message || 'Erreur réseau pendant la gestion de caisse.' };
  }
}

export async function getCashSessionWithServerValidation(restaurantSlug: string) {
  return cashSessionRequest(restaurantSlug);
}

export async function openCashSessionWithServerValidation(
  restaurantSlug: string, openingBalance: number, idempotencyKey: string
) {
  return cashSessionRequest(restaurantSlug, { action: 'open_session', openingBalance, idempotencyKey });
}

export async function closeCashSessionWithServerValidation(
  restaurantSlug: string, closingCount: number, idempotencyKey: string
) {
  return cashSessionRequest(restaurantSlug, { action: 'close_session', closingCount, idempotencyKey });
}

export async function listClosedCashSessionsWithServerValidation(
  restaurantSlug: string,
  limitCount = 15
): Promise<{ success: true; closedSessions: CashSessionApiRecord[] } | { success: false; error: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch(
      `/api/payments?restaurantSlug=${encodeURIComponent(restaurantSlug)}&action=closed_sessions_history&limit=${limitCount}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
        credentials: 'same-origin',
        cache: 'no-store'
      }
    );
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Impossible de charger l\'historique des sessions de caisse.' };
    }
    return { success: true, closedSessions: Array.isArray(data.closedSessions) ? data.closedSessions : [] };
  } catch (err: any) {
    console.error('Erreur API historique sessions de caisse:', err);
    return { success: false, error: err?.message || 'Erreur réseau pendant le chargement de l\'historique.' };
  }
}

export async function recordCashMovementWithServerValidation(
  restaurantSlug: string,
  movementType: 'expense' | 'withdrawal',
  amount: number,
  category: string,
  note: string,
  idempotencyKey: string
) {
  return cashSessionRequest(restaurantSlug, {
    action: 'record_cash_movement', movementType, amount, category, note, idempotencyKey
  });
}

export async function collectCashPaymentWithServerValidation(
  restaurantSlug: string,
  orderId: string,
  amountTendered: number,
  idempotencyKey: string,
  splitGuests = 1,
  guestNumber = 1,
  guestName = ''
): Promise<{ success: true; payment: CashPaymentApiRecord; order: any; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ restaurantSlug, orderId, amountTendered, idempotencyKey, splitGuests, guestNumber, guestName }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return {
        success: false,
        conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Le serveur a refusé cet encaissement.',
      };
    }
    return {
      success: true,
      payment: data.payment as CashPaymentApiRecord,
      order: data.order,
      idempotentReplay: data.idempotentReplay === true,
    };
  } catch (err: any) {
    console.error('Erreur appel /api/payments POST:', err);
    return { success: false, error: err?.message || 'Erreur réseau pendant l’encaissement.' };
  }
}

export type PayDunyaClientChannel = 'orange-money-ci' | 'wave-ci' | 'mtn-ci' | 'moov-ci' | 'djamo-ci';

export async function createPayDunyaPaymentWithServerValidation(
  restaurantSlug: string,
  orderId: string,
  channel: PayDunyaClientChannel,
  idempotencyKey: string,
  amount: number
): Promise<{ success: true; checkoutUrl: string; paymentIntentId: string; amount: number; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        action: 'create_paydunya_invoice', restaurantSlug, orderId, channel, idempotencyKey, amount
      })
    });
    const data = await response.json();
    if (!response.ok || !data.success || typeof data.checkoutUrl !== 'string') {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'PayDunya n’a pas pu créer la facture.' };
    }
    return {
      success: true, checkoutUrl: data.checkoutUrl,
      paymentIntentId: String(data.paymentIntentId || ''),
      amount: Number(data.amount || 0), idempotentReplay: data.idempotentReplay === true
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau lors de la création de la facture PayDunya.' };
  }
}

export async function createCustomerPayDunyaPaymentWithServerValidation(
  restaurantSlug: string,
  orderId: string,
  channel: PayDunyaClientChannel,
  idempotencyKey: string,
  csrfToken: string,
  amount: number
): Promise<{ success: true; checkoutUrl: string; paymentIntentId: string; amount: number } | { success: false; error: string; conflict?: boolean }> {
  try {
    const response = await fetch('/api/payments/customer-paydunya', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RM-CSRF-Token': csrfToken },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ restaurantSlug, orderId, channel, idempotencyKey, csrfToken, amount })
    });
    const data = await response.json();
    if (!response.ok || !data.success || typeof data.checkoutUrl !== 'string') {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'PayDunya n’a pas pu créer la facture de cette commande.' };
    }
    return { success: true, checkoutUrl: data.checkoutUrl,
      paymentIntentId: String(data.paymentIntentId || ''), amount: Number(data.amount || 0) };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau lors de la création du paiement QR.' };
  }
}

export async function reconcileCustomerPayDunyaPaymentWithServerValidation(
  restaurantSlug: string,
  paymentIntentId: string,
  csrfToken: string
): Promise<{ success: true; status: string; paymentId?: string } | { success: false; error: string; conflict?: boolean }> {
  try {
    const response = await fetch('/api/payments/customer-paydunya-reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RM-CSRF-Token': csrfToken },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ restaurantSlug, paymentIntentId, csrfToken })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Le statut du paiement QR ne peut pas être vérifié.' };
    }
    return { success: true, status: String(data.status || 'pending'),
      paymentId: data.paymentId ? String(data.paymentId) : undefined };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau pendant le rapprochement du paiement QR.' };
  }
}

export async function reconcilePayDunyaPaymentWithServerValidation(
  restaurantSlug: string,
  paymentIntentId: string
): Promise<{ success: true; status: string; paymentId?: string; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ action: 'reconcile_paydunya_payment', restaurantSlug, paymentIntentId })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Le statut PayDunya ne peut pas être vérifié.' };
    }
    return { success: true, status: String(data.status || 'pending'),
      paymentId: data.paymentId ? String(data.paymentId) : undefined,
      idempotentReplay: data.idempotentReplay === true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau pendant le rapprochement PayDunya.' };
  }
}

export async function refundPayDunyaPaymentWithServerValidation(
  restaurantSlug: string,
  paymentId: string,
  amount: number,
  reason: string,
  idempotencyKey: string
): Promise<{ success: true; refundId: string; status: string; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        action: 'refund_paydunya_payment', restaurantSlug, paymentId, amount, reason, idempotencyKey
      })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Le remboursement Mobile Money a été refusé.' };
    }
    return { success: true, refundId: String(data.refundId || ''), status: String(data.status || ''),
      idempotentReplay: data.idempotentReplay === true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau lors du remboursement Mobile Money.' };
  }
}

export async function refundCashPaymentWithServerValidation(
  restaurantSlug: string,
  paymentId: string,
  amount: number,
  reason: string,
  idempotencyKey: string,
  cashDisbursementConfirmed: boolean
): Promise<{ success: true; payment: Record<string, unknown>; status: string; idempotentReplay?: boolean } | { success: false; error: string; conflict?: boolean }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        action: 'refund_cash_payment', restaurantSlug, paymentId, amount, reason, idempotencyKey, cashDisbursementConfirmed
      })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, conflict: response.status === 409 || data.conflict === true,
        error: data.error || 'Le remboursement espèces a été refusé.' };
    }
    return { success: true, payment: data.payment || {}, status: 'recorded', idempotentReplay: data.idempotentReplay === true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Erreur réseau lors du remboursement espèces.' };
  }
}

export async function listRecentCashPaymentsWithServerValidation(
  restaurantSlug: string
): Promise<{ success: true; payments: CashPaymentApiRecord[] } | { success: false; error: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch(`/api/payments?restaurantSlug=${encodeURIComponent(restaurantSlug)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Impossible de charger le journal de caisse.' };
    }
    return { success: true, payments: Array.isArray(data.payments) ? data.payments : [] };
  } catch (err: any) {
    console.error('Erreur appel /api/payments GET:', err);
    return { success: false, error: err?.message || 'Erreur réseau pendant le chargement du journal de caisse.' };
  }
}

/**
 * Souscrit en temps réel au flux des commandes (réservé aux gestionnaires)
 */
export function subscribeToOrders(
  restaurantSlug: string,
  onData: (orders: RestauOrder[]) => void,
  onError?: (err: unknown) => void
) {
  const path = `restaurants/${restaurantSlug}/orders`;
  const ordersRef = collection(db, 'restaurants', restaurantSlug, 'orders');
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const orders: RestauOrder[] = [];
      snapshot.forEach((d) => {
        orders.push(d.data() as RestauOrder);
      });
      onData(orders);
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    }
  );
}

type InventoryApiResult = { success: true; itemId?: string; quantityBefore?: number; quantityAfter?: number; idempotentReplay?: boolean } | { success: false; error: string; retryable?: boolean };

async function inventoryRequest(
  restaurantSlug: string,
  payload: Record<string, unknown>
): Promise<InventoryApiResult> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ restaurantSlug, ...payload })
    });
    const data = await response.json();
    if (!response.ok || !data.success) return { success: false, error: data.error || 'Opération de stock refusée.', retryable: response.status >= 500 || response.status === 408 || response.status === 429 };
    return data as InventoryApiResult;
  } catch (error: any) {
    console.error('Erreur appel /api/inventory:', error);
    return { success: false, error: error?.message || 'Erreur réseau pendant la gestion du stock.', retryable: true };
  }
}

export async function createInventoryItemWithServerValidation(
  restaurantSlug: string,
  item: { name: string; unit: string; quantity: number; minQuantity: number; unitCost: number; supplier: string },
  idempotencyKey: string
): Promise<InventoryApiResult> {
  return inventoryRequest(restaurantSlug, { action: 'create', ...item, idempotencyKey });
}

export async function saveInventoryRecipeWithServerValidation(
  restaurantSlug: string,
  menuItemId: string,
  recipeLines: Array<{ inventoryItemId: string; quantityPerDish: number }>
): Promise<InventoryApiResult> {
  return inventoryRequest(restaurantSlug, { action: 'save_recipe', menuItemId, recipeLines });
}

export async function updateInventoryItemWithServerValidation(
  restaurantSlug: string,
  itemId: string,
  item: { name: string; unit: string; minQuantity: number; unitCost: number; supplier: string }
): Promise<InventoryApiResult> {
  return inventoryRequest(restaurantSlug, { action: 'update', itemId, ...item });
}

export async function moveInventoryStockWithServerValidation(
  restaurantSlug: string,
  itemId: string,
  delta: number,
  reason: string,
  idempotencyKey: string
): Promise<InventoryApiResult> {
  return inventoryRequest(restaurantSlug, { action: 'move', itemId, delta, reason, idempotencyKey });
}

export async function archiveInventoryItemWithServerValidation(
  restaurantSlug: string,
  itemId: string
): Promise<InventoryApiResult> {
  return inventoryRequest(restaurantSlug, { action: 'archive', itemId });
}

/**
 * Persists a kitchen line completion state through the trusted backend.
 * The client never writes KDS progress directly to Firestore.
 */
export async function updateKitchenItemCompletionWithServerValidation(
  restaurantSlug: string,
  orderId: string,
  itemId: string,
  itemIndex: number,
  completed: boolean
): Promise<{ success: true; completed: boolean; idempotentReplay?: boolean } | { success: false; error: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Connexion du personnel requise.' };
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/kitchen-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ restaurantSlug, orderId, itemId, itemIndex, completed })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Mise à jour cuisine refusée.' };
    }
    return { success: true, completed: data.completed === true, idempotentReplay: data.idempotentReplay === true };
  } catch (error: any) {
    console.error('Erreur appel /api/kitchen-item:', error);
    return { success: false, error: error?.message || 'Erreur réseau pendant la mise à jour cuisine.' };
  }
}

/**
 * Met à jour le statut opérationnel d'une commande (in_prep, ready, completed, etc.)
 */
export async function updateOrderStatus(
  restaurantSlug: string,
  orderId: string,
  status: RestauOrder['status']
): Promise<void> {
  const path = `restaurants/${restaurantSlug}/orders/${orderId}`;
  try {
    const orderRef = doc(db, 'restaurants', restaurantSlug, 'orders', orderId);
    await setDoc(orderRef, { status, statusUpdatedAt: Date.now() }, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Souscrit en temps réel aux tables configurées du restaurant
 */
export function subscribeToTables(
  restaurantSlug: string,
  onData: (tables: RestaurantTable[]) => void,
  onError?: (err: unknown) => void
) {
  const path = `restaurants/${restaurantSlug}/tables`;
  const tablesRef = collection(db, 'restaurants', restaurantSlug, 'tables');
  const q = query(tablesRef);

  return onSnapshot(
    q,
    (snapshot) => {
      const tables: RestaurantTable[] = [];
      snapshot.forEach((d) => {
        tables.push(d.data() as RestaurantTable);
      });
      // Tri naturel par numéro de table
      tables.sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true }));
      onData(tables);
    },
    (err) => {
      if (onError) {
        onError(err);
      } else {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    }
  );
}

/**
 * Enregistre ou met à jour une table du restaurant
 */
export async function persistTable(
  restaurantSlug: string, 
  table: RestaurantTable
): Promise<void> {
  const path = `restaurants/${restaurantSlug}/tables/${table.id}`;
  try {
    const tableRef = doc(db, 'restaurants', restaurantSlug, 'tables', table.id);
    await setDoc(tableRef, table, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Supprime une table du restaurant
 */
export async function deleteTable(
  restaurantSlug: string,
  tableId: string
): Promise<void> {
  const path = `restaurants/${restaurantSlug}/tables/${tableId}`;
  try {
    const tableRef = doc(db, 'restaurants', restaurantSlug, 'tables', tableId);
    await deleteDoc(tableRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

