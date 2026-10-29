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

/**
 * Enregistrement d'idempotence horodaté avec empreinte canonique du payload
 */
export interface ServerIdempotencyRecord {
  timestamp: number;
  status: 'processing' | 'completed';
  order?: RestauOrder;
  signature: string;
}

// Cache d'idempotence mémoire local (protection au sein du même processus Node.js)
const serverIdempotencyStore = new Map<string, ServerIdempotencyRecord>();

export function clearServerIdempotencyStore(): void {
  serverIdempotencyStore.clear();
}

/**
 * Calcule l'empreinte canonique et déterministe d'un panier et de sa configuration
 */
export function computeOrderSignature(payload: {
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  cart: OrderSubmissionPayload['cart'];
}): string {
  const normCart = payload.cart
    .map(c => {
      const opt = c.selectedOption ? `${c.selectedOption.groupId}:${c.selectedOption.optionId}` : '';
      const extras = (c.selectedExtras || [])
        .map(e => e.extraId)
        .sort()
        .join(',');
      const note = (c.prepNotes || '').trim();
      return `${c.menuItemId}*${c.quantity}*${opt}*[${extras}]*${note}`;
    })
    .sort()
    .join('|');

  return `${payload.restaurantSlug.trim()}::${payload.orderMode}::${(payload.tableNumber || '').trim()}::${normCart}`;
}

/**
 * Interface de confiance d'accès aux données Firestore serveur
 * Permet l'injection du SDK Firebase Admin ou de mocks pour les tests
 */
export interface ServerFirestoreProvider {
  getMenuItems(restaurantSlug: string): Promise<RestauMenuItem[]>;
  getTables(restaurantSlug: string): Promise<RestaurantTable[]>;
  saveOrder(restaurantSlug: string, order: RestauOrder): Promise<void>;
  getIdempotencyRecord?(key: string): Promise<ServerIdempotencyRecord | null>;
  saveIdempotencyRecord?(key: string, record: ServerIdempotencyRecord): Promise<void>;
  deleteIdempotencyRecord?(key: string): Promise<void>;
}

/**
 * Libère une clé d'idempotence en cas d'erreur de traitement ou d'écriture Firestore
 */
async function releaseIdempotencyKey(key: string, dataProvider: ServerFirestoreProvider): Promise<void> {
  serverIdempotencyStore.delete(key);
  if (dataProvider.deleteIdempotencyRecord) {
    try {
      await dataProvider.deleteIdempotencyRecord(key);
    } catch {
      // Ignorer l'erreur de suppression en fallback
    }
  }
}

/**
 * Point d'entrée serveur de validation et création de commande
 * 
 * Garanties de sécurité :
 * 1. Validation obligatoire des tables pour 'sur_place' (panne, liste vide, inexistante ou inactive => rejet).
 * 2. Validation stricte du catalogue (available === true obligatoire, champs et prix vérifiés sans fallback 0).
 * 3. Idempotence renforcée (conflit de signature détecté, verrou mémoire + persistant).
 * 4. Recalcul serveur intégral des totaux et rejet de tout prix falsifié.
 * 5. Aucune confirmation si l'écriture Firestore a échoué.
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

  const now = Date.now();

  // Nettoyage des clés mémoires de plus de 10 minutes
  for (const [key, record] of serverIdempotencyStore.entries()) {
    if (now - record.timestamp > 600000) {
      serverIdempotencyStore.delete(key);
    }
  }

  const effectiveIdempotencyKey = idempotencyKey?.trim() || null;
  const currentSignature = computeOrderSignature({
    restaurantSlug: cleanSlug,
    orderMode,
    tableNumber,
    cart
  });

  // 2. Gestion stricte de l'idempotence
  if (effectiveIdempotencyKey) {
    let existingRecord: ServerIdempotencyRecord | null = null;
    if (dataProvider.getIdempotencyRecord) {
      try {
        existingRecord = await dataProvider.getIdempotencyRecord(effectiveIdempotencyKey);
      } catch (err: any) {
        console.warn('Avertissement lecture idempotence persistante:', err.message);
      }
    }
    if (!existingRecord) {
      existingRecord = serverIdempotencyStore.get(effectiveIdempotencyKey) || null;
    }

    if (existingRecord) {
      // Détection de conflit de payload sur une même clé
      if (existingRecord.signature && existingRecord.signature !== currentSignature) {
        return {
          success: false,
          error: `Conflit d'idempotence : La clé "${effectiveIdempotencyKey}" a déjà été utilisée pour une requête différente (restaurant, mode de commande, table ou panier distinct).`
        };
      }

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

    // Poser le verrou d'idempotence
    const processingRecord: ServerIdempotencyRecord = {
      timestamp: now,
      status: 'processing',
      signature: currentSignature
    };
    serverIdempotencyStore.set(effectiveIdempotencyKey, processingRecord);
    if (dataProvider.saveIdempotencyRecord) {
      await dataProvider.saveIdempotencyRecord(effectiveIdempotencyKey, processingRecord).catch(() => {});
    }
  }

  try {
    // 3. Lecture du catalogue réel du restaurant depuis Firestore
    // RÈGLE CRITIQUE : Ne JAMAIS utiliser de catalogue de secours local (fallbackCatalog / CHEZ_AWA_MENU_ITEMS)
    let catalog: RestauMenuItem[];
    try {
      catalog = await dataProvider.getMenuItems(cleanSlug);
    } catch (err: any) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Erreur serveur lors de la lecture du catalogue Firestore : ${err.message || 'Échec de connexion'}. Aucun catalogue de secours n'est autorisé.` 
      };
    }

    if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Le catalogue du restaurant "${cleanSlug}" est vide ou introuvable dans Firestore. Commande refusée.` 
      };
    }

    // 4. Validation obligatoire des tables réelles pour les commandes sur place
    let cleanTableNumber: string | null = null;
    if (orderMode === 'sur_place') {
      if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { success: false, error: "Le numéro de table est obligatoire pour une commande sur place." };
      }
      cleanTableNumber = tableNumber.trim();

      // RÈGLE D'AUDIT : Toute erreur de lecture des tables doit entraîner un rejet immédiat
      let realTables: RestaurantTable[];
      try {
        realTables = await dataProvider.getTables(cleanSlug);
      } catch (err: any) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Erreur serveur lors de la lecture des tables Firestore pour "${cleanSlug}" : ${err.message || 'Panne de connexion'}. Commande sur place refusée.` 
        };
      }

      // RÈGLE D'AUDIT : Une collection de tables vide doit entraîner un rejet
      if (!realTables || !Array.isArray(realTables) || realTables.length === 0) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Aucune table n'est configurée dans Firestore pour le restaurant "${cleanSlug}". Commande sur place refusée.` 
        };
      }

      const matched = realTables.find(
        t => t.tableNumber && t.tableNumber.trim().toLowerCase() === cleanTableNumber!.toLowerCase()
      );

      // RÈGLE D'AUDIT : La table doit exister
      if (!matched) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `La table "${cleanTableNumber}" n'existe pas dans la configuration du restaurant.` 
        };
      }

      // RÈGLE D'AUDIT : La table doit être explicitement active (isActive === true)
      if (matched.isActive !== true) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `La table "${cleanTableNumber}" est actuellement inactive ou fermée.` 
        };
      }
    }

    // 5. Validation stricte du catalogue et de chaque ligne du panier
    const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
    const verifiedItems: RestauOrderItem[] = [];

    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const catalogItem = catalogMap.get(line.menuItemId);

      if (!catalogItem) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Le plat sélectionné (ID: "${line.menuItemId}") n'existe pas au catalogue officiel.` 
        };
      }

      // RÈGLE D'AUDIT : Vérification des champs et prix du catalogue avant tout calcul
      if (!catalogItem.name || typeof catalogItem.name !== 'string' || !catalogItem.name.trim()) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return {
          success: false,
          error: `Donnée de catalogue corrompue : Le plat "${line.menuItemId}" ne possède pas de nom valide.`
        };
      }

      if (typeof catalogItem.price !== 'number' || !Number.isFinite(catalogItem.price) || catalogItem.price < 0) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return {
          success: false,
          error: `Donnée de catalogue corrompue : Le prix de base du plat "${catalogItem.name}" est invalide (${catalogItem.price}). Commande rejetée.`
        };
      }

      // Vérification que le plat appartient bien au restaurant cible
      if (catalogItem.restaurantSlug && catalogItem.restaurantSlug !== cleanSlug) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Le plat "${catalogItem.name}" n'appartient pas au restaurant "${cleanSlug}".` 
        };
      }

      // RÈGLE D'AUDIT : Rejeter tout plat dont available n'est pas explicitement true
      if (catalogItem.available !== true) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Le plat "${catalogItem.name}" est actuellement indisponible ou en rupture de stock.` 
        };
      }

      // Validation de la quantité (entier compris entre 1 et 50)
      const qty = line.quantity;
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
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
            if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
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
          if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
          return { 
            success: false, 
            error: `Le groupe d'options "${line.selectedOption.groupId}" n'est pas autorisé pour le plat "${catalogItem.name}".` 
          };
        }

        const catalogOption = catalogGroup.options?.find(o => o.id === line.selectedOption?.optionId);
        if (!catalogOption) {
          if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
          return { 
            success: false, 
            error: `L'option "${line.selectedOption.optionId}" est introuvable / inexistante dans le groupe "${catalogGroup.name}".` 
          };
        }

        // RÈGLE D'AUDIT : Rejeter toute donnée incohérente de prix d'option (interdiction de conversion en 0)
        if (catalogOption.extraPrice !== undefined) {
          if (typeof catalogOption.extraPrice !== 'number' || !Number.isFinite(catalogOption.extraPrice) || catalogOption.extraPrice < 0) {
            if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
            return {
              success: false,
              error: `Donnée de catalogue corrompue : Le surcoût de l'option "${catalogOption.name}" est invalide (${catalogOption.extraPrice}). Commande rejetée.`
            };
          }
          optionExtraPrice = Math.round(catalogOption.extraPrice);
        } else {
          optionExtraPrice = 0;
        }

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
            if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
            return { 
              success: false, 
              error: `Le supplément "${ext.extraId}" est non disponible / non autorisé pour le plat "${catalogItem.name}".` 
            };
          }

          // RÈGLE D'AUDIT : Rejeter toute donnée incohérente de prix d'extra (interdiction de conversion en 0)
          if (typeof catalogExtra.price !== 'number' || !Number.isFinite(catalogExtra.price) || catalogExtra.price < 0) {
            if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
            return {
              success: false,
              error: `Donnée de catalogue corrompue : Le prix du supplément "${catalogExtra.name}" est invalide (${catalogExtra.price}). Commande rejetée.`
            };
          }

          const extraPrice = Math.round(catalogExtra.price);
          extrasCost += extraPrice;
          verifiedExtrasList.push({
            extraId: catalogExtra.id,
            name: catalogExtra.name,
            price: extraPrice
          });
        }
      }

      const trustedBasePrice = Math.round(catalogItem.price);
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
      if (effectiveIdempotencyKey) await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Le total de la commande a été falsifié ou ne concorde pas avec le tarif officiel (recalculé: ${grandTotal} FCFA, soumis: ${declaredTotal} FCFA).` 
      };
    }

    // 8. Génération du numéro de commande lisible et de l'ordre complet
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const humanOrderNumber = `#CMD-${randomSuffix}`;

    const confirmedOrder: RestauOrder = {
      id: `ord-${now}-${Math.random().toString(36).substring(2, 7)}`,
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

    // 9. RÈGLE D'AUDIT : Enregistrement de confiance dans Firestore par le serveur
    // Ne JAMAIS annoncer qu'une commande a été enregistrée si Firestore n'a pas confirmé son écriture
    await dataProvider.saveOrder(cleanSlug, confirmedOrder);

    // 10. Mise à jour de l'enregistrement d'idempotence après confirmation réelle
    if (effectiveIdempotencyKey) {
      const completedRecord: ServerIdempotencyRecord = {
        timestamp: now,
        status: 'completed',
        order: confirmedOrder,
        signature: currentSignature
      };
      serverIdempotencyStore.set(effectiveIdempotencyKey, completedRecord);
      if (dataProvider.saveIdempotencyRecord) {
        await dataProvider.saveIdempotencyRecord(effectiveIdempotencyKey, completedRecord).catch(() => {});
      }
    }

    return { 
      success: true, 
      order: confirmedOrder 
    };
  } catch (err: any) {
    // En cas d'erreur de sauvegarde Firestore, libérer le verrou d'idempotence pour autoriser un rejeu ultérieur
    if (effectiveIdempotencyKey) {
      await releaseIdempotencyKey(effectiveIdempotencyKey, dataProvider);
    }
    return { 
      success: false, 
      error: `Échec d'enregistrement de la commande dans Firestore : ${err.message || String(err)}. La commande n'a PAS été enregistrée.` 
    };
  }
}
