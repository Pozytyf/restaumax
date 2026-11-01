import { ClientCartItem, OrderMode } from '../types/restaumax';

export interface PendingOrderIntent {
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  cart: ClientCartItem[];
  idempotencyKey: string;
  customerNote?: string;
  timestamp: number;
  isUncertain: boolean;
}

export const ORDER_INTENT_STORAGE_KEY = 'restaumax_pending_order_intent';

/**
 * Sauvegarde l'intention de commande du client dans sessionStorage.
 * Sécurisé pour les environnements de test et navigateurs réels.
 */
export function savePendingOrderIntent(intent: PendingOrderIntent): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return false;
  }
  try {
    const payload = JSON.stringify({
      restaurantSlug: intent.restaurantSlug || 'chez-awa',
      orderMode: intent.orderMode || 'sur_place',
      tableNumber: intent.tableNumber ?? null,
      cart: Array.isArray(intent.cart) ? intent.cart : [],
      idempotencyKey: intent.idempotencyKey,
      customerNote: intent.customerNote || '',
      timestamp: intent.timestamp || Date.now(),
      isUncertain: Boolean(intent.isUncertain)
    });
    window.sessionStorage.setItem(ORDER_INTENT_STORAGE_KEY, payload);
    return true;
  } catch (err) {
    console.warn('[RestauMax] Impossible de sauvegarder l\'intention dans sessionStorage:', err);
    return false;
  }
}

/**
 * Charge et valide l'intention de commande persistée depuis sessionStorage.
 * Retourne null si aucune intention n'est présente ou si les données sont corrompues.
 */
export function loadPendingOrderIntent(): PendingOrderIntent | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(ORDER_INTENT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      clearPendingOrderIntent();
      return null;
    }

    if (!parsed.idempotencyKey || typeof parsed.idempotencyKey !== 'string' || !parsed.idempotencyKey.trim()) {
      clearPendingOrderIntent();
      return null;
    }

    if (!Array.isArray(parsed.cart)) {
      clearPendingOrderIntent();
      return null;
    }

    return {
      restaurantSlug: typeof parsed.restaurantSlug === 'string' ? parsed.restaurantSlug : 'chez-awa',
      orderMode: parsed.orderMode === 'emporter' || parsed.orderMode === 'a_emporter' ? 'a_emporter' : 'sur_place',
      tableNumber: parsed.tableNumber ?? null,
      cart: parsed.cart,
      idempotencyKey: parsed.idempotencyKey,
      customerNote: typeof parsed.customerNote === 'string' && parsed.customerNote.trim() ? parsed.customerNote.trim() : undefined,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      isUncertain: Boolean(parsed.isUncertain)
    };
  } catch (err) {
    console.warn('[RestauMax] Erreur lors de la lecture de l\'intention:', err);
    clearPendingOrderIntent();
    return null;
  }
}

/**
 * Supprime définitivement l'intention de commande stockée dans sessionStorage.
 */
export function clearPendingOrderIntent(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    window.sessionStorage.removeItem(ORDER_INTENT_STORAGE_KEY);
  } catch {
    // Aucune action si la suppression échoue
  }
}

/**
 * Met à jour spécifiquement le statut d'incertitude sans altérer les autres métadonnées de l'intention.
 */
export function updatePendingOrderIntentUncertainty(isUncertain: boolean): void {
  const current = loadPendingOrderIntent();
  if (current) {
    current.isUncertain = isUncertain;
    savePendingOrderIntent(current);
  }
}
