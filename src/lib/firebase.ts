import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocFromServer,
  setDoc, 
  collection, 
  onSnapshot,
  query,
  writeBatch
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { RestaurantInfo, RestauMenuItem } from '../types/restaumax';

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: The app will break without passing the configured firestoreDatabaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
      onError?.(err);
      handleFirestoreError(err, OperationType.GET, path);
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
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
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
