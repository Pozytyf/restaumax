export interface UpdateKitchenItemCompletionParams {
  restaurantSlug: string;
  orderId: string;
  itemId: string;
  itemIndex: number;
  completed: boolean;
  actorUid: string;
  sessionVersion: number;
}

export interface UpdateKitchenItemCompletionResult {
  success: boolean;
  completed?: boolean;
  completedCount?: number;
  idempotentReplay?: boolean;
  error?: string;
}

/**
 * Persists one KDS line state with tenant, membership and session checks.
 * Admin SDK transactions bypass client rules, so every authorization check lives here.
 */
export async function updateKitchenItemCompletionWithDb(
  db: any,
  params: UpdateKitchenItemCompletionParams
): Promise<UpdateKitchenItemCompletionResult> {
  if (!db) return { success: false, error: 'Service de cuisine indisponible.' };

  const { restaurantSlug, orderId, itemId, itemIndex, completed, actorUid, sessionVersion } = params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug) ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(orderId) ||
      !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex > 99 ||
      typeof completed !== 'boolean' || !actorUid) {
    return { success: false, error: 'Données de préparation invalides.' };
  }

  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const memberRef = db.collection('managers').doc(actorUid);
  const orderRef = restaurantRef.collection('orders').doc(orderId);

  try {
    return await db.runTransaction(async (tx: any) => {
      const [restaurantSnap, memberSnap, orderSnap] = await Promise.all([
        tx.get(restaurantRef),
        tx.get(memberRef),
        tx.get(orderRef)
      ]);

      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const member = memberSnap.exists ? memberSnap.data() : null;
      const order = orderSnap.exists ? orderSnap.data() : null;

      if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false) {
        return { success: false, error: 'Restaurant inactif ou indisponible.' };
      }
      if (!member || member.active !== true || member.restaurantSlug !== restaurantSlug ||
          Number(member.sessionVersion || 0) !== Number(sessionVersion || 0)) {
        return { success: false, error: 'Compte inactif, session révoquée ou accès refusé.' };
      }

      const isOwner = member.role === 'owner' && restaurant.ownerUid === actorUid;
      const permissions = Array.isArray(member.permissions) ? member.permissions : [];
      const canOperateKitchen =
        (member.role === 'manager' && (permissions.includes('kitchen.access') || permissions.includes('orders.manage'))) ||
        (member.role === 'kitchen' && permissions.includes('kitchen.access'));
      if (!isOwner && !canOperateKitchen) {
        return { success: false, error: 'Votre rôle ne permet pas de modifier la préparation.' };
      }

      if (!order || order.id !== orderId || order.restaurantSlug !== restaurantSlug) {
        return { success: false, error: 'Commande introuvable dans ce restaurant.' };
      }
      if (!['pending', 'in_prep'].includes(order.status)) {
        return { success: false, error: 'La préparation de cette commande n’est plus modifiable.' };
      }
      if (!Array.isArray(order.items) || itemIndex >= order.items.length ||
          itemId !== `ki-${orderId}-${itemIndex}`) {
        return { success: false, error: 'Ligne de commande invalide.' };
      }

      const currentStates = order.kitchenItemCompletion && typeof order.kitchenItemCompletion === 'object'
        ? { ...order.kitchenItemCompletion }
        : {};
      const key = String(itemIndex);
      if (currentStates[key] === completed) {
        return { success: true, completed, idempotentReplay: true };
      }

      currentStates[key] = completed;
      const completedCount = order.items.reduce((count: number, _item: any, index: number) =>
        count + (currentStates[String(index)] === true ? 1 : 0), 0);
      tx.update(orderRef, {
        kitchenItemCompletion: currentStates,
        kitchenItemsCompletedCount: completedCount,
        kitchenItemUpdatedAt: Date.now(),
        kitchenItemUpdatedBy: actorUid
      });
      return { success: true, completed, completedCount, idempotentReplay: false };
    });
  } catch (error: any) {
    // Keep internal Firestore details out of the API response.
    console.error('[RestauMax KDS] Échec de persistance:', error?.message || String(error));
    return { success: false, error: 'Impossible d’enregistrer la progression cuisine. Réessayez.' };
  }
}
