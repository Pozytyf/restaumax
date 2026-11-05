import { createHash } from 'node:crypto';

export interface InventoryRequestParams {
  action: 'create' | 'move' | 'update' | 'save_recipe' | 'archive';
  restaurantSlug: string;
  actorUid: string;
  sessionVersion: number;
  idempotencyKey?: string;
  itemId?: string;
  menuItemId?: string;
  recipeLines?: Array<{ inventoryItemId: string; quantityPerDish: number }>;
  name?: string;
  unit?: string;
  quantity?: number;
  minQuantity?: number;
  unitCost?: number;
  supplier?: string;
  delta?: number;
  reason?: string;
}

const allowedUnits = new Set(['kg', 'g', 'L', 'ml', 'unité', 'carton', 'sac']);
const validAmount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000000;

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

async function authorizeInventoryTransaction(tx: any, db: any, slug: string, uid: string, version: number) {
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(uid);
  const [restaurantSnap, memberSnap] = await Promise.all([tx.get(restaurantRef), tx.get(memberRef)]);
  const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
  const member = memberSnap.exists ? memberSnap.data() : null;
  if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
      !member || member.active !== true || member.restaurantSlug !== slug ||
      Number(member.sessionVersion || 0) !== Number(version || 0)) {
    return { ok: false, error: 'Compte inactif, session révoquée ou accès au restaurant refusé.' };
  }
  const isOwner = member.role === 'owner' && restaurant.ownerUid === uid;
  const canManage = member.role === 'manager' && Array.isArray(member.permissions) &&
    member.permissions.includes('inventory.manage');
  if (!isOwner && !canManage) {
    return { ok: false, error: 'Votre rôle ne permet pas de gérer les stocks.' };
  }
  return { ok: true, restaurantRef };
}

/**
 * All inventory mutations run through Admin SDK transactions.
 * Movement rows are append-only and contain before/delta/after values.
 */
export async function manageInventoryWithDb(db: any, params: InventoryRequestParams) {
  if (!db) return { success: false, error: 'Service de stock indisponible.' };
  const slug = String(params.restaurantSlug || '').trim();
  const uid = String(params.actorUid || '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !uid) {
    return { success: false, error: 'Restaurant ou utilisateur invalide.' };
  }

  try {
    if (params.action === 'create') {
      const name = String(params.name || '').trim();
      const unit = String(params.unit || '');
      const quantity = params.quantity;
      const minQuantity = params.minQuantity;
      const unitCost = params.unitCost;
      const supplier = String(params.supplier || '').trim();
      const key = String(params.idempotencyKey || '');
      if (!name || name.length > 160 || !allowedUnits.has(unit) ||
          !validAmount(quantity) || !validAmount(minQuantity) || !validAmount(unitCost) || !Number.isInteger(unitCost) ||
          supplier.length > 160 || !/^[a-zA-Z0-9_-]{16,128}$/.test(key) ||
          ![quantity, minQuantity].every(v => Math.round(Number(v) * 1000) === Number(v) * 1000)) {
        return { success: false, error: 'Données de création de stock invalides.' };
      }
      const initialQuantity = Number(quantity);
      const initialMinQuantity = Number(minQuantity);
      const initialUnitCost = Number(unitCost);
      const keyHash = digest(`${slug}:${uid}:${key}`);
      const requestSignature = digest(JSON.stringify({ name, unit, quantity: initialQuantity, minQuantity: initialMinQuantity, unitCost: initialUnitCost, supplier }));
      const itemId = `inv_${keyHash}`;
      const itemRef = db.collection('restaurants').doc(slug).collection('inventoryItems').doc(itemId);
      const movementRef = db.collection('restaurants').doc(slug).collection('stockMovements').doc(`initial_${keyHash}`);
      return await db.runTransaction(async (tx: any) => {
        const authz = await authorizeInventoryTransaction(tx, db, slug, uid, params.sessionVersion);
        if (!authz.ok) return { success: false, error: authz.error };
        const [itemSnap, movementSnap] = await Promise.all([tx.get(itemRef), tx.get(movementRef)]);
        if (itemSnap.exists) {
          if (itemSnap.data().requestSignature !== requestSignature) return { success: false, error: 'Conflit : cette clé de création a déjà été utilisée avec des données différentes.' };
          return { success: true, itemId, idempotentReplay: true };
        }
        if (movementSnap.exists) return { success: false, error: 'Journal initial orphelin : création bloquée pour contrôle.' };
        const now = Date.now();
        tx.create(itemRef, { id: itemId, name, unit, quantity: initialQuantity, minQuantity: initialMinQuantity, unitCost: initialUnitCost, supplier, active: true, requestSignature, createdAt: now, updatedAt: now });
        if (initialQuantity > 0) {
          tx.create(movementRef, {
            itemId, itemName: name, unit, quantityBefore: 0, delta: initialQuantity,
            quantityAfter: initialQuantity, reason: 'Stock initial', createdAt: now,
            createdBy: uid, idempotencyKey: keyHash
          });
        }
        return { success: true, itemId, idempotentReplay: false };
      });
    }

    if (params.action === 'move') {
      const itemId = String(params.itemId || '');
      const delta = params.delta;
      const reason = String(params.reason || '').trim();
      const key = String(params.idempotencyKey || '');
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId) ||
          typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000000 ||
          Math.round(delta * 1000) !== delta * 1000 ||
          !reason || reason.length > 160 || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
        return { success: false, error: 'Mouvement de stock invalide.' };
      }
      const keyHash = digest(`${slug}:${uid}:${key}`);
      const requestSignature = digest(JSON.stringify({ itemId, delta, reason }));
      const itemRef = db.collection('restaurants').doc(slug).collection('inventoryItems').doc(itemId);
      const movementRef = db.collection('restaurants').doc(slug).collection('stockMovements').doc(`mov_${keyHash}`);
      return await db.runTransaction(async (tx: any) => {
        const authz = await authorizeInventoryTransaction(tx, db, slug, uid, params.sessionVersion);
        if (!authz.ok) return { success: false, error: authz.error };
        const [itemSnap, movementSnap] = await Promise.all([tx.get(itemRef), tx.get(movementRef)]);
        if (movementSnap.exists) {
          if (movementSnap.data().requestSignature !== requestSignature) return { success: false, error: 'Conflit : cette clé de mouvement a déjà été utilisée avec une opération différente.' };
          return { success: true, idempotentReplay: true };
        }
        if (!itemSnap.exists || itemSnap.data().active === false) return { success: false, error: 'Article de stock introuvable ou archivé.' };
        const item = itemSnap.data();
        const before = Number(item.quantity);
        if (!Number.isFinite(before) || before < 0 || before + delta < 0) {
          return { success: false, error: 'Stock insuffisant : sortie refusée.' };
        }
        const after = Math.round((before + delta) * 1000) / 1000;
        const now = Date.now();
        tx.update(itemRef, { quantity: after, updatedAt: now });
        tx.create(movementRef, {
          itemId, itemName: String(item.name || ''), unit: String(item.unit || ''),
          quantityBefore: before, delta, quantityAfter: after, reason, requestSignature,
          createdAt: now, createdBy: uid, idempotencyKey: keyHash
        });
        return { success: true, quantityBefore: before, quantityAfter: after, idempotentReplay: false };
      });
    }

    if (params.action === 'update') {
      const itemId = String(params.itemId || '');
      const name = String(params.name || '').trim();
      const unit = String(params.unit || '');
      const minQuantity = params.minQuantity;
      const unitCost = params.unitCost;
      const supplier = String(params.supplier || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId) ||
          !name || name.length > 160 || !allowedUnits.has(unit) ||
          !validAmount(minQuantity) || !validAmount(unitCost) || !Number.isInteger(unitCost) ||
          supplier.length > 160 ||
          Math.round(Number(minQuantity) * 1000) !== Number(minQuantity) * 1000) {
        return { success: false, error: 'Données de modification de stock invalides.' };
      }
      const itemRef = db.collection('restaurants').doc(slug).collection('inventoryItems').doc(itemId);
      return await db.runTransaction(async (tx: any) => {
        const authz = await authorizeInventoryTransaction(tx, db, slug, uid, params.sessionVersion);
        if (!authz.ok) return { success: false, error: authz.error };
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists || itemSnap.data().active === false) {
          return { success: false, error: 'Article de stock introuvable ou archivé.' };
        }
        const item = itemSnap.data();
        if (String(item.unit || '') !== unit && Number(item.quantity || 0) !== 0) {
          return { success: false, error: 'L’unité ne peut pas être modifiée tant que le stock n’est pas à zéro.' };
        }
        tx.update(itemRef, {
          name, unit, minQuantity: Number(minQuantity), unitCost: Number(unitCost),
          supplier, updatedAt: Date.now()
        });
        return { success: true, idempotentReplay: false };
      });
    }

    if (params.action === 'save_recipe') {
      const menuItemId = String(params.menuItemId || '');
      const recipeLines = params.recipeLines;
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(menuItemId) ||
          !Array.isArray(recipeLines) || recipeLines.length < 1 || recipeLines.length > 30) {
        return { success: false, error: 'Fiche recette invalide : sélectionnez un plat et au moins un ingrédient.' };
      }
      const seenInventoryIds = new Set<string>();
      for (const line of recipeLines) {
        const inventoryItemId = String(line?.inventoryItemId || '');
        const quantity = line?.quantityPerDish;
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(inventoryItemId) ||
            seenInventoryIds.has(inventoryItemId) ||
            typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000 ||
            Math.round(quantity * 1000) !== quantity * 1000) {
          return { success: false, error: 'Chaque ingrédient doit être unique et avoir une quantité positive (maximum 3 décimales).' };
        }
        seenInventoryIds.add(inventoryItemId);
      }

      const restaurantRef = db.collection('restaurants').doc(slug);
      const menuItemRef = restaurantRef.collection('menuItems').doc(menuItemId);
      const recipeRef = restaurantRef.collection('menuRecipes').doc(menuItemId);
      const inventoryRefs = recipeLines.map(line =>
        restaurantRef.collection('inventoryItems').doc(String(line.inventoryItemId))
      );
      return await db.runTransaction(async (tx: any) => {
        const authz = await authorizeInventoryTransaction(tx, db, slug, uid, params.sessionVersion);
        if (!authz.ok) return { success: false, error: authz.error };
        const [menuItemSnap, ...inventorySnaps] = await Promise.all([
          tx.get(menuItemRef),
          ...inventoryRefs.map((ref: any) => tx.get(ref))
        ]);
        if (!menuItemSnap.exists || menuItemSnap.data().restaurantSlug !== slug) {
          return { success: false, error: 'Plat introuvable dans le catalogue de ce restaurant.' };
        }
        const resolvedLines = recipeLines.map((line, index) => {
          const snap = inventorySnaps[index];
          if (!snap?.exists || snap.data().active === false) {
            throw new Error('Un ingrédient est introuvable ou archivé.');
          }
          const item = snap.data();
          return {
            inventoryItemId: String(line.inventoryItemId),
            itemName: String(item.name || ''),
            unit: String(item.unit || ''),
            quantityPerDish: Number(line.quantityPerDish)
          };
        });
        const now = Date.now();
        tx.set(recipeRef, {
          menuItemId,
          menuItemName: String(menuItemSnap.data().name || ''),
          lines: resolvedLines,
          updatedAt: now,
          updatedBy: uid
        });
        return { success: true, menuItemId, lineCount: resolvedLines.length, idempotentReplay: false };
      });
    }

    if (params.action === 'archive') {
      const itemId = String(params.itemId || '');
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId)) return { success: false, error: 'Article de stock invalide.' };
      const itemRef = db.collection('restaurants').doc(slug).collection('inventoryItems').doc(itemId);
      return await db.runTransaction(async (tx: any) => {
        const authz = await authorizeInventoryTransaction(tx, db, slug, uid, params.sessionVersion);
        if (!authz.ok) return { success: false, error: authz.error };
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists) return { success: false, error: 'Article de stock introuvable.' };
        const item = itemSnap.data();
        if (item.active === false) return { success: true, idempotentReplay: true };
        if (Number(item.quantity || 0) !== 0) {
          return { success: false, error: 'Impossible d’archiver un article avec un stock restant. Enregistrez d’abord une sortie ou un inventaire.' };
        }
        tx.update(itemRef, { active: false, archivedAt: Date.now(), archivedBy: uid, updatedAt: Date.now() });
        return { success: true, idempotentReplay: false };
      });
    }

    return { success: false, error: 'Action de stock inconnue.' };
  } catch (error: any) {
    console.error('[RestauMax inventory] Échec de transaction:', error?.message || String(error));
    return { success: false, error: 'Impossible de modifier le stock. Réessayez.' };
  }
}
