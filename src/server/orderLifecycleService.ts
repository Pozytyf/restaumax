import { createHash } from 'node:crypto';

export interface OrderLifecycleParams {
  restaurantSlug: string;
  orderId: string;
  targetStatus: 'in_prep' | 'ready' | 'completed' | 'cancelled';
  actorUid: string;
  sessionVersion: number;
}

const validSlug = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

function movementId(orderId: string, itemId: string, action: 'consume' | 'restore') {
  return `order_${hash(`${orderId}:${itemId}:${action}`)}`;
}

/**
 * Changes an order status and its recipe-based stock movements atomically.
 * Stock is consumed only on pending -> in_prep; cancellation restores it once.
 * Recipes use the inventory item's exact unit: no implicit unit conversion.
 */
export async function transitionOrderStatusWithDb(db: any, params: OrderLifecycleParams) {
  const { restaurantSlug, orderId, targetStatus, actorUid, sessionVersion } = params;
  if (!db || !validSlug(restaurantSlug) || !validId(orderId) || !actorUid ||
      !['in_prep', 'ready', 'completed', 'cancelled'].includes(targetStatus)) {
    return { success: false, error: 'Demande de transition invalide.' };
  }

  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const memberRef = db.collection('managers').doc(actorUid);
  const orderRef = restaurantRef.collection('orders').doc(orderId);
  const consumptionRef = restaurantRef.collection('stockOrderConsumptions').doc(orderId);

  try {
    return await db.runTransaction(async (tx: any) => {
      const [restaurantSnap, memberSnap, orderSnap] = await Promise.all([
        tx.get(restaurantRef), tx.get(memberRef), tx.get(orderRef)
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
      if (!order || order.id !== orderId || order.restaurantSlug !== restaurantSlug || !Array.isArray(order.items)) {
        return { success: false, error: 'Commande introuvable dans ce restaurant.' };
      }

      const isOwner = member.role === 'owner' && restaurant.ownerUid === actorUid;
      const permissions = Array.isArray(member.permissions) ? member.permissions : [];
      const canManage = member.role === 'manager' && permissions.includes('orders.manage');
      const canKitchen = (member.role === 'kitchen' && permissions.includes('kitchen.access')) ||
        (member.role === 'manager' && (permissions.includes('kitchen.access') || canManage));
      const canCancel = member.role === 'cashier' && permissions.includes('orders.cancel');
      const canServe = member.role === 'server' && permissions.includes('orders.serve');

      const allowed = isOwner || canManage ||
        (targetStatus === 'in_prep' && canKitchen) ||
        (targetStatus === 'ready' && canKitchen) ||
        (targetStatus === 'completed' && canServe) ||
        (targetStatus === 'cancelled' && canCancel);
      if (!allowed) return { success: false, error: 'Votre rôle ne permet pas cette transition de commande.' };

      if (order.status === targetStatus) return { success: true, idempotentReplay: true, status: targetStatus };
      const transitions: Record<string, string[]> = {
        pending: ['in_prep', 'cancelled'],
        in_prep: ['ready', 'cancelled'],
        ready: ['completed', 'cancelled']
      };
      if (!(transitions[String(order.status)] || []).includes(targetStatus)) {
        return { success: false, error: `Transition refusée : ${order.status} → ${targetStatus}.` };
      }
      if (targetStatus === 'ready' &&
          Number(order.kitchenItemsCompletedCount || 0) !== order.items.length) {
        return { success: false, error: 'Toutes les lignes doivent être terminées avant de déclarer la commande prête.' };
      }

      const consumptionSnap = await tx.get(consumptionRef);
      const consumption = consumptionSnap.exists ? consumptionSnap.data() : null;
      let recipeLines: any[] = [];
      const untrackedItemIds: string[] = [];
      let inventorySnapshots: any[] = [];
      let inventoryRefs: any[] = [];
      let movementRefs: any[] = [];

      if (order.status === 'pending' && targetStatus === 'in_prep') {
        const menuIds: string[] = Array.from(new Set<string>(
          (order.items as any[]).map((item: any) => String(item.menuItemId || '')).filter((id: string) => id.length > 0)
        ));
        const recipeRefs = menuIds.map((id: string) => restaurantRef.collection('menuRecipes').doc(id));
        const recipeSnaps = await Promise.all(recipeRefs.map((ref: any) => tx.get(ref)));
        const aggregated = new Map<string, { quantity: number; unit: string; itemName: string }>();
        const addRecipeLines = (lines: any[], portions: number, label: string) => {
          if (!Array.isArray(lines) || lines.length === 0) {
            throw new Error(`Fiche de stock invalide : ${label}.`);
          }
          for (const line of lines) {
            const inventoryItemId = String(line.inventoryItemId || '');
            const perDish = Number(line.quantityPerDish);
            if (!validId(inventoryItemId) || !Number.isFinite(perDish) || perDish <= 0 ||
                Math.round(perDish * 1000) !== perDish * 1000 || !line.unit || !String(line.itemName || '')) {
              throw new Error(`Une ligne de fiche de stock de ${label} est invalide.`);
            }
            const existing = aggregated.get(inventoryItemId);
            if (existing && existing.unit !== String(line.unit)) throw new Error('Unités incohérentes pour un même ingrédient.');
            aggregated.set(inventoryItemId, {
              quantity: (existing?.quantity || 0) + perDish * portions,
              unit: String(line.unit), itemName: String(line.itemName)
            });
          }
        };

        for (let i = 0; i < recipeSnaps.length; i++) {
          const recipeSnap = recipeSnaps[i];
          const menuId = menuIds[i];
          const matchingItems = (order.items as any[]).filter((item: any) => String(item.menuItemId || '') === menuId);
          const portions = matchingItems.reduce((sum: number, item: any) => {
            const quantity = Number(item.quantity);
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw new Error('Quantité de commande invalide pour le calcul de stock.');
            return sum + quantity;
          }, 0);
          if (!recipeSnap.exists) untrackedItemIds.push(menuId);
          else addRecipeLines(recipeSnap.data().lines, portions, `plat ${menuId}`);

          for (const item of matchingItems) {
            const selection = item.selectedOption;
            if (selection) {
              const groupIds = String(selection.groupId || '').split('+');
              const optionIds = String(selection.optionId || '').split('+');
              if (!groupIds.length || groupIds.length !== optionIds.length || groupIds.some((id: string) => !validId(id)) || optionIds.some((id: string) => !validId(id))) {
                throw new Error(`Sélection d'options incohérente pour ${menuId}.`);
              }
              for (let optionIndex = 0; optionIndex < groupIds.length; optionIndex++) {
                const groupId = groupIds[optionIndex];
                const optionId = optionIds[optionIndex];
                const recipeId = hash(`option:${menuId}:${groupId}:${optionId}`);
                const recipeRef = restaurantRef.collection('menuCustomizationRecipes').doc(recipeId);
                const recipeSnap = await tx.get(recipeRef);
                if (!recipeSnap.exists) {
                  untrackedItemIds.push(`${menuId}:option:${groupId}:${optionId}`);
                } else {
                  const optionRecipe = recipeSnap.data();
                  if (optionRecipe.customizationType !== 'option' || optionRecipe.menuItemId !== menuId ||
                      optionRecipe.groupId !== groupId || optionRecipe.optionId !== optionId) {
                    throw new Error('Fiche de stock d’option incohérente avec le catalogue.');
                  }
                  addRecipeLines(optionRecipe.lines, Number(item.quantity), `option ${optionRecipe.targetName || optionId}`);
                }
              }
            }
            for (const extra of Array.isArray(item.selectedExtras) ? item.selectedExtras : []) {
              const extraId = String(extra.extraId || extra.id || '');
              if (!validId(extraId)) throw new Error(`Supplément invalide pour ${menuId}.`);
              const recipeId = hash(`extra:${menuId}::${extraId}`);
              const recipeRef = restaurantRef.collection('menuCustomizationRecipes').doc(recipeId);
              const recipeSnap = await tx.get(recipeRef);
              if (!recipeSnap.exists) {
                untrackedItemIds.push(`${menuId}:extra:${extraId}`);
              } else {
                const extraRecipe = recipeSnap.data();
                if (extraRecipe.customizationType !== 'extra' || extraRecipe.menuItemId !== menuId || extraRecipe.extraId !== extraId) {
                  throw new Error('Fiche de stock de supplément incohérente avec le catalogue.');
                }
                addRecipeLines(extraRecipe.lines, Number(item.quantity), `supplément ${extraRecipe.targetName || extraId}`);
              }
            }
          }
        }
        recipeLines = [...aggregated.entries()].map(([inventoryItemId, value]) => ({
          inventoryItemId, quantity: Math.round(value.quantity * 1000) / 1000,
          unit: value.unit, itemName: value.itemName
        }));
            } else if (targetStatus === 'cancelled' && ['applied', 'partial'].includes(String(consumption?.status || ''))) {
        recipeLines = Array.isArray(consumption.lines) ? consumption.lines : [];
      }

      inventoryRefs = recipeLines.map((line: any) => restaurantRef.collection('inventoryItems').doc(line.inventoryItemId));
      movementRefs = recipeLines.map((line: any) => restaurantRef.collection('stockMovements').doc(
        movementId(orderId, line.inventoryItemId, targetStatus === 'in_prep' ? 'consume' : 'restore')
      ));
      const [inventorySnaps, movementSnaps] = await Promise.all([
        Promise.all(inventoryRefs.map((ref: any) => tx.get(ref))),
        Promise.all(movementRefs.map((ref: any) => tx.get(ref)))
      ]);
      // All reads are complete before any transaction write.
      const now = Date.now();
      if (order.status === 'pending' && targetStatus === 'in_prep') {
        if (consumptionSnap.exists) {
          if (consumption?.status === 'applied' || consumption?.status === 'skipped') {
            return { success: false, error: 'Journal de consommation déjà présent alors que la commande est encore en attente : contrôle requis.' };
          }
          return { success: false, error: 'Journal de consommation incohérent : transition bloquée.' };
        }
        for (let i = 0; i < recipeLines.length; i++) {
          const line = recipeLines[i];
          const snap = inventorySnaps[i];
          if (!snap?.exists || snap.data().active === false) {
            return { success: false, error: `Ingrédient indisponible : ${line.itemName}.` };
          }
          const item = snap.data();
          if (String(item.unit || '') !== line.unit) {
            return { success: false, error: `Unité différente pour ${line.itemName} : stock ${item.unit}, recette ${line.unit}. Aucune conversion automatique.` };
          }
          const before = Number(item.quantity);
          if (!Number.isFinite(before) || before < line.quantity) {
            return { success: false, error: `Stock insuffisant pour ${line.itemName} (requis : ${line.quantity} ${line.unit}).` };
          }
          if (movementSnaps[i]?.exists) return { success: false, error: 'Mouvement de consommation déjà présent : contrôle requis.' };
        }
        for (let i = 0; i < recipeLines.length; i++) {
          const line = recipeLines[i];
          const item = inventorySnaps[i].data();
          const before = Number(item.quantity);
          const unitCost = Number(item.unitCost);
          line.unitCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : null;
          const after = Math.round((before - line.quantity) * 1000) / 1000;
          tx.update(inventoryRefs[i], { quantity: after, updatedAt: now });
          tx.create(movementRefs[i], {
            itemId: line.inventoryItemId, itemName: String(item.name || line.itemName), unit: line.unit,
            unitCost: line.unitCost,
            quantityBefore: before, delta: -line.quantity, quantityAfter: after,
            reason: `Consommation commande ${orderId}`, orderId, createdAt: now, createdBy: actorUid,
            idempotencyKey: movementRefs[i].path.split('/').pop()
          });
        }
        tx.create(consumptionRef, {
          orderId, restaurantSlug,
          status: recipeLines.length ? (untrackedItemIds.length ? 'partial' : 'applied') : 'skipped',
          lines: recipeLines, untrackedItemIds, consumedAt: now, consumedBy: actorUid
        });
      } else if (targetStatus === 'cancelled' && ['applied', 'partial'].includes(String(consumption?.status || '')) && !consumption.restoredAt) {
        for (let i = 0; i < recipeLines.length; i++) {
          if (!inventorySnaps[i]?.exists) return { success: false, error: 'Un ingrédient consommé est introuvable : restauration bloquée.' };
          if (movementSnaps[i]?.exists) return { success: false, error: 'Mouvement de restauration déjà présent : contrôle requis.' };
        }
        for (let i = 0; i < recipeLines.length; i++) {
          const line = recipeLines[i];
          const item = inventorySnaps[i].data();
          const before = Number(item.quantity);
          const after = Math.round((before + Number(line.quantity)) * 1000) / 1000;
          tx.update(inventoryRefs[i], { quantity: after, updatedAt: now });
          tx.create(movementRefs[i], {
            itemId: line.inventoryItemId, itemName: String(item.name || line.itemName), unit: line.unit,
            unitCost: line.unitCost === undefined ? null : line.unitCost,
            quantityBefore: before, delta: Number(line.quantity), quantityAfter: after,
            reason: `Restauration annulation commande ${orderId}`, orderId, createdAt: now, createdBy: actorUid,
            idempotencyKey: movementRefs[i].path.split('/').pop()
          });
        }
        tx.update(consumptionRef, { status: 'restored', restoredAt: now, restoredBy: actorUid });
      }

      const orderUpdate: Record<string, any> = { status: targetStatus, statusUpdatedAt: now, statusUpdatedBy: actorUid };
      if (order.status === 'pending' && targetStatus === 'in_prep') {
        orderUpdate.stockTrackingStatus = recipeLines.length ? (untrackedItemIds.length ? 'partial' : 'applied') : 'skipped';
        orderUpdate.stockUntrackedItemIds = untrackedItemIds;
      }
      if (targetStatus === 'cancelled' && ['applied', 'partial'].includes(String(consumption?.status || '')) && !consumption.restoredAt) {
        orderUpdate.stockTrackingStatus = 'restored';
      }
      tx.update(orderRef, orderUpdate);
      return { success: true, status: targetStatus, idempotentReplay: false, stockLines: recipeLines.length };
    }, { maxAttempts: 10 });
  } catch (error: any) {
    console.error('[RestauMax order lifecycle] Transaction failed:', error?.message || String(error));
    return { success: false, error: 'Impossible de mettre à jour la commande et son stock. Réessayez.' };
  }
}
