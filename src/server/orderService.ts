import { 
  RestauMenuItem, 
  RestauOrder, 
  RestauOrderItem, 
  RestaurantTable,
  OrderMode 
} from '../types/restaumax.js';
import { calculateOrderTotal, sanitizeNote } from '../utils/pricing.js';

export interface OrderSubmissionPayload {
  restaurantSlug: string;
  cart: Array<{
    menuItemId: string;
    quantity: number;
    name?: string;
    selectedOption?: {
      groupId: string;
      groupName?: string;
      optionId: string;
      optionName?: string;
      extraPrice?: number;
    };
    selectedExtras?: Array<{
      extraId: string;
      name?: string;
      price?: number;
    }>;
    prepNotes?: string;
  }>;
  orderMode: OrderMode;
  tableNumber: string | null;
  customerNote?: string;
  declaredTotal?: number;
  idempotencyKey?: string;
}

export interface OrderSubmissionResult {
  success: boolean;
  order?: RestauOrder;
  error?: string;
  idempotentReplay?: boolean;
}

// In-memory idempotency cache for duplicate request prevention
interface ServerIdempotencyRecord {
  timestamp: number;
  status: 'processing' | 'completed';
  order?: RestauOrder;
  signature: string;
}

const serverIdempotencyStore = new Map<string, ServerIdempotencyRecord>();

export function clearServerIdempotencyStore(): void {
  serverIdempotencyStore.clear();
}

/**
 * Interface abstraite d'accès aux données Firestore serveur
 * Permet l'injection du SDK Firebase Admin ou de mocks pour les tests
 */
export interface ServerFirestoreProvider {
  getMenuItems(restaurantSlug: string): Promise<RestauMenuItem[]>;
  getTables(restaurantSlug: string): Promise<RestaurantTable[]>;
  saveOrder(restaurantSlug: string, order: RestauOrder): Promise<void>;
}

/**
 * Point d'entrée serveur de validation et création de commande
 * - Lit le catalogue réel depuis Firestore (interdiction stricte de catalogue de secours)
 * - Valide chaque plat, option et extra
 * - Recalcule chaque ligne et le total général
 * - Rejette les totaux falsifiés
 * - Valide la table réelle
 * - Applique la protection anti-doublon idempotente
 * - Enregistre la commande dans Firestore
 */
export async function processOrderSubmission(
  payload: OrderSubmissionPayload,
  dataProvider: ServerFirestoreProvider
): Promise<OrderSubmissionResult> {
  const { 
    restaurantSlug, 
    cart, 
    orderMode, 
    tableNumber, 
    customerNote, 
    declaredTotal, 
    idempotencyKey 
  } = payload;

  // 1. Validation de base du payload
  if (!restaurantSlug || typeof restaurantSlug !== 'string' || !restaurantSlug.trim()) {
    return { success: false, error: "Identifiant du restaurant manquant ou invalide." };
  }
  const cleanSlug = restaurantSlug.trim();

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return { success: false, error: "Le panier est vide. Impossible de créer une commande." };
  }

  if (orderMode !== 'sur_place' && orderMode !== 'a_emporter') {
    return { success: false, error: "Mode de commande invalide (doit être 'sur_place' ou 'a_emporter')." };
  }

  // 2. Gestion de l'idempotence côté serveur
  const now = Date.now();
  // Nettoyage des clés de plus de 10 minutes
  for (const [key, record] of serverIdempotencyStore.entries()) {
    if (now - record.timestamp > 600000) {
      serverIdempotencyStore.delete(key);
    }
  }

  const effectiveIdempotencyKey = idempotencyKey?.trim() || null;
  if (effectiveIdempotencyKey) {
    const existingRecord = serverIdempotencyStore.get(effectiveIdempotencyKey);
    if (existingRecord) {
      if (existingRecord.status === 'completed' && existingRecord.order) {
        return { 
          success: true, 
          order: existingRecord.order,
          idempotentReplay: true 
        };
      }
      if (existingRecord.status === 'processing' && (now - existingRecord.timestamp < 15000)) {
        return { 
          success: false, 
          error: "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement." 
        };
      }
    }

    serverIdempotencyStore.set(effectiveIdempotencyKey, {
      timestamp: now,
      status: 'processing',
      signature: `${cleanSlug}:${orderMode}:${tableNumber}`
    });
  }

  try {
    // 3. Lecture du catalogue réel du restaurant depuis Firestore
    // RÈGLE CRITIQUE : Ne JAMAIS utiliser de catalogue de secours local (fallbackCatalog / CHEZ_AWA_MENU_ITEMS)
    let catalog: RestauMenuItem[];
    try {
      catalog = await dataProvider.getMenuItems(cleanSlug);
    } catch (err: any) {
      if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
      return { 
        success: false, 
        error: `Erreur serveur lors de la lecture du catalogue Firestore : ${err.message || 'Échec de connexion'}. Aucun catalogue de secours n'est autorisé.` 
      };
    }

    if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
      if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
      return { 
        success: false, 
        error: `Le catalogue du restaurant "${cleanSlug}" est vide ou introuvable dans Firestore. Commande refusée.` 
      };
    }

    // 4. Validation de la table réelle pour les commandes sur place
    let cleanTableNumber: string | null = null;
    if (orderMode === 'sur_place') {
      if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
        if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
        return { success: false, error: "Le numéro de table est obligatoire pour une commande sur place." };
      }
      cleanTableNumber = tableNumber.trim();

      // Lecture des tables réelles enregistrées dans Firestore pour ce restaurant
      let realTables: RestaurantTable[] = [];
      try {
        realTables = await dataProvider.getTables(cleanSlug);
      } catch (err: any) {
        console.warn(`Avertissement lecture tables pour ${cleanSlug}:`, err.message);
      }

      if (realTables && realTables.length > 0) {
        const matched = realTables.find(
          t => t.tableNumber.trim().toLowerCase() === cleanTableNumber!.toLowerCase()
        );

        if (!matched) {
          if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
          return { 
            success: false, 
            error: `La table "${cleanTableNumber}" n'existe pas dans la configuration du restaurant.` 
          };
        }

        if (matched.isActive === false) {
          if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
          return { 
            success: false, 
            error: `La table "${cleanTableNumber}" est actuellement inactive ou fermée.` 
          };
        }
      }
    }

    // 5. Validation stricte de chaque ligne du panier contre le catalogue de confiance
    const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
    const verifiedItems: RestauOrderItem[] = [];

    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const catalogItem = catalogMap.get(line.menuItemId);

      if (!catalogItem) {
        if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
        return { 
          success: false, 
          error: `Le plat sélectionné (ID: "${line.menuItemId}") n'existe pas au catalogue officiel.` 
        };
      }

      // Vérification que le plat appartient bien au restaurant cible
      if (catalogItem.restaurantSlug && catalogItem.restaurantSlug !== cleanSlug) {
        if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
        return { 
          success: false, 
          error: `Le plat "${catalogItem.name}" n'appartient pas au restaurant "${cleanSlug}".` 
        };
      }

      // Vérification de la disponibilité
      if (catalogItem.available === false) {
        if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
        return { 
          success: false, 
          error: `Le plat "${catalogItem.name}" est actuellement indisponible / en rupture de stock.` 
        };
      }

      // Validation de la quantité (entier compris entre 1 et 50)
      const qty = line.quantity;
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
        if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
        return { 
          success: false, 
          error: `La quantité pour "${catalogItem.name}" doit être un entier positif compris entre 1 et 50 (reçu: ${qty}).` 
        };
      }

      // Vérification stricte des groupes d'options du plat
      const availableOptionGroups = catalogItem.optionGroups || [];
      for (const group of availableOptionGroups) {
        if (group.required) {
          const hasSelectedGroup = line.selectedOption && line.selectedOption.groupId === group.id;
          if (!hasSelectedGroup) {
            if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
            return { 
              success: false, 
              error: `Une option est obligatoire (requise) pour le groupe "${group.name}" du plat "${catalogItem.name}".` 
            };
          }
        }
      }

      let verifiedSelectedOption: RestauOrderItem['selectedOption'] = undefined;
      let optionExtraPrice = 0;

      if (line.selectedOption) {
        const catalogGroup = availableOptionGroups.find(g => g.id === line.selectedOption?.groupId);
        if (!catalogGroup) {
          if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
          return { 
            success: false, 
            error: `Le groupe d'options "${line.selectedOption.groupId}" n'est pas autorisé pour le plat "${catalogItem.name}".` 
          };
        }

        const catalogOption = catalogGroup.options.find(o => o.id === line.selectedOption?.optionId);
        if (!catalogOption) {
          if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
          return { 
            success: false, 
            error: `L'option "${line.selectedOption.optionId}" est introuvable / inexistante dans le groupe "${catalogGroup.name}".` 
          };
        }

        // Prix de l'option tiré exclusivement du catalogue officiel
        optionExtraPrice = Math.max(0, Math.round(Number(catalogOption.extraPrice) || 0));
        verifiedSelectedOption = {
          groupId: catalogGroup.id,
          groupName: catalogGroup.name,
          optionId: catalogOption.id,
          optionName: catalogOption.name,
          extraPrice: optionExtraPrice
        };
      }

      // Vérification stricte de chaque extra sélectionné
      let extrasCost = 0;
      const verifiedExtrasList: RestauOrderItem['selectedExtras'] = [];

      if (line.selectedExtras && line.selectedExtras.length > 0) {
        const availableExtras = catalogItem.availableExtras || [];
        const extrasMap = new Map(availableExtras.map(e => [e.id, e]));

        for (const ext of line.selectedExtras) {
          const catalogExtra = extrasMap.get(ext.extraId);
          if (!catalogExtra) {
            if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
            return { 
              success: false, 
              error: `Le supplément "${ext.extraId}" est non disponible / non autorisé pour le plat "${catalogItem.name}".` 
            };
          }

          // Prix de l'extra tiré exclusivement du catalogue officiel
          const extraPrice = Math.max(0, Math.round(Number(catalogExtra.price) || 0));
          extrasCost += extraPrice;
          verifiedExtrasList.push({
            extraId: catalogExtra.id,
            name: catalogExtra.name,
            price: extraPrice
          });
        }
      }

      const trustedBasePrice = Math.max(0, Math.round(Number(catalogItem.price) || 0));
      const trustedUnitPrice = trustedBasePrice + optionExtraPrice + extrasCost;
      const lineTotal = trustedUnitPrice * qty;

      verifiedItems.push({
        id: `line-${now}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        menuItemId: catalogItem.id,
        name: catalogItem.name,
        basePrice: trustedBasePrice,
        unitPrice: trustedUnitPrice,
        quantity: qty,
        totalPrice: lineTotal,
        selectedOption: verifiedSelectedOption,
        selectedExtras: verifiedExtrasList.length > 0 ? verifiedExtrasList : undefined,
        prepNotes: sanitizeNote(line.prepNotes, 150)
      });
    }

    // 6. Recalcul déterministe du montant total
    const grandTotal = calculateOrderTotal(verifiedItems);

    // 7. Rejet strict si le montant déclaré par le client diffère du recalcul de confiance
    if (declaredTotal !== undefined && Math.round(Number(declaredTotal)) !== grandTotal) {
      if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
      return { 
        success: false, 
        error: `Le total de la commande a été falsifié ou ne concorde pas avec le tarif officiel (recalculé: ${grandTotal} FCFA, soumis: ${declaredTotal} FCFA).` 
      };
    }

    // 8. Construction de la commande confirmée
    const humanOrderNumber = `#CMD-${Math.floor(100 + Math.random() * 900)}`;
    const orderId = `ord-${now}-${Math.random().toString(36).substring(2, 8)}`;

    const confirmedOrder: RestauOrder = {
      id: orderId,
      orderNumber: humanOrderNumber,
      restaurantSlug: cleanSlug,
      orderMode,
      tableNumber: orderMode === 'sur_place' ? cleanTableNumber : null,
      items: verifiedItems,
      itemsCount: verifiedItems.reduce((acc, it) => acc + it.quantity, 0),
      totalAmount: grandTotal,
      currency: 'FCFA',
      status: 'pending',
      customerNote: sanitizeNote(customerNote, 150),
      createdAt: now,
      createdAtIso: new Date(now).toISOString(),
      idempotencyKey: effectiveIdempotencyKey || undefined
    };

    // 9. Enregistrement direct et sécurisé dans Firestore par le serveur
    await dataProvider.saveOrder(cleanSlug, confirmedOrder);

    // 10. Mise à jour de l'enregistrement d'idempotence
    if (effectiveIdempotencyKey) {
      serverIdempotencyStore.set(effectiveIdempotencyKey, {
        timestamp: now,
        status: 'completed',
        order: confirmedOrder,
        signature: `${cleanSlug}:${orderMode}:${tableNumber}`
      });
    }

    return { 
      success: true, 
      order: confirmedOrder 
    };
  } catch (err: any) {
    if (effectiveIdempotencyKey) serverIdempotencyStore.delete(effectiveIdempotencyKey);
    return { 
      success: false, 
      error: `Erreur inattendue lors du traitement serveur de la commande : ${err.message || String(err)}` 
    };
  }
}
