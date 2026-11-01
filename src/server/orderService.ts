import crypto from 'node:crypto';
import { 
  RestauMenuItem, 
  RestauOrder, 
  RestauOrderItem, 
  RestaurantTable, 
  OrderMode 
} from '../types/restaumax.js';
import { calculateOrderTotal, sanitizeNote } from '../utils/pricing.js';

export const DEFAULT_IDEMPOTENCY_TIMEOUT_MS = 15_000;

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
    selectedOptions?: Array<{
      groupId: string;
      groupName?: string;
      optionId: string;
      optionName?: string;
      extraPrice?: number;
    }>;
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
  conflict?: boolean;
  uncertain?: boolean;
}

/**
 * Enregistrement d'idempotence stocké dans la collection Firestore idempotency_keys
 */
export interface ServerIdempotencyRecord {
  id: string;
  namespacedKey: string;
  restaurantSlug: string;
  signature: string;
  orderId: string;
  status: 'completed' | 'processing' | 'ambiguous' | 'failed';
  createdAt: number;
  updatedAt: number;
  timestamp?: number;
  errorReason?: string;
  order?: RestauOrder;
  pendingOrderId?: string;
}

export type IdempotencyReservationStatus = 
  | 'reserved'
  | 'completed'
  | 'in_progress'
  | 'conflict'
  | 'ambiguous';

export interface IdempotencyReservationResult {
  status: IdempotencyReservationStatus;
  record?: ServerIdempotencyRecord;
  error?: string;
}

export type OrderProbeResult = 
  | { status: 'found'; order: RestauOrder }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

export interface ExecuteOrderTransactionParams {
  restaurantSlug: string;
  idempotencyKey: string;
  keyDocId: string;
  orderId: string;
  signature: string;
  orderToCreate: RestauOrder;
}

export interface ExecuteOrderTransactionResult {
  success: boolean;
  order?: RestauOrder;
  error?: string;
  idempotentReplay?: boolean;
  conflict?: boolean;
  uncertain?: boolean;
}

/**
 * Calcule les identifiants sûrs et déterministes à partir du slug restaurant et de la clé client
 */
export function deriveIdempotencyIdentifiers(restaurantSlug: string, idempotencyKey: string) {
  const cleanSlug = restaurantSlug.trim();
  const cleanKey = idempotencyKey.trim();
  const namespacedKey = `${cleanSlug}:${cleanKey}`;
  const hash = crypto.createHash('sha256').update(namespacedKey).digest('hex');
  return {
    namespacedKey,
    keyDocId: `idem_${hash.substring(0, 32)}`,
    orderId: `ord_${hash.substring(0, 24)}`,
    orderNumber: `#CMD-${hash.substring(0, 6).toUpperCase()}`
  };
}

/**
 * Calcule l'empreinte canonique et déterministe (SHA-256) d'une intention de commande
 */
export function computeOrderSignature(payload: {
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  customerNote?: string;
  cart: OrderSubmissionPayload['cart'];
}): string {
  const cleanSlug = (payload.restaurantSlug || '').trim();
  const cleanMode = payload.orderMode;
  const cleanTable = (payload.tableNumber || '').trim();
  const cleanNote = (payload.customerNote || '').trim();

  const canonicalItems = (payload.cart || [])
    .map(c => {
      const optionSelections = Array.isArray(c.selectedOptions) && c.selectedOptions.length > 0
        ? c.selectedOptions
        : c.selectedOption ? [c.selectedOption] : [];
      const opt = optionSelections
        .map(option => `${(option.groupId || '').trim()}:${(option.optionId || '').trim()}`)
        .sort()
        .join(',');
      const extras = (c.selectedExtras || [])
        .map(e => (e.extraId || '').trim())
        .filter(Boolean)
        .sort()
        .join(',');
      const lineNote = (c.prepNotes || '').trim();
      return `${(c.menuItemId || '').trim()}#${c.quantity}#${opt}#[${extras}]#${lineNote}`;
    })
    .sort()
    .join('|');

  const rawString = `${cleanSlug}::${cleanMode}::${cleanTable}::${cleanNote}::${canonicalItems}`;
  return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Interface de confiance d'accès aux données Firestore serveur
 */
export interface ServerFirestoreProvider {
  getRestaurant?(restaurantSlug: string): Promise<{ slug?: string; isOpen?: boolean } | null>;
  getMenuItems(restaurantSlug: string): Promise<RestauMenuItem[]>;
  getTables(restaurantSlug: string): Promise<RestaurantTable[]>;

  // Transaction atomique unifiée (L'exigence centrale 4.4)
  executeOrderTransaction?(params: ExecuteOrderTransactionParams): Promise<ExecuteOrderTransactionResult>;

  // Méthodes de secours et de transition (pour compatibilité)
  saveOrder?(restaurantSlug: string, order: RestauOrder): Promise<void>;
  getOrderById?(restaurantSlug: string, orderId: string): Promise<OrderProbeResult>;
  reserveIdempotencyKey?(key: string, signature: string, timeoutMs?: number): Promise<IdempotencyReservationResult>;
  transitionKeyToProcessing?(key: string, signature: string, fromStatus: 'ambiguous' | 'failed'): Promise<boolean>;
  commitIdempotencyKey?(key: string, order: RestauOrder, signature: string): Promise<void>;
  markIdempotencyAmbiguous?(key: string, orderId: string, signature: string, reason: string): Promise<void>;
  releaseIdempotencyKey?(key: string): Promise<void>;
  getIdempotencyRecord?(key: string): Promise<ServerIdempotencyRecord | null>;
  saveIdempotencyRecord?(key: string, record: ServerIdempotencyRecord): Promise<void>;
  deleteIdempotencyRecord?(key: string): Promise<void>;
}

// Registre en mémoire pour rétro-compatibilité des tests unitaires minimaux sans transaction
const testFallbackStore = new Map<string, { signature: string; order: RestauOrder; restaurantSlug: string }>();

// Fonction de compatibilité pour tests existants (efface le registre de mock en mémoire)
export function clearServerIdempotencyStore(): void {
  testFallbackStore.clear();
}

/**
 * Point d'entrée serveur de validation et création de commande
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

  // 1. Validation structurelle du restaurant
  if (!restaurantSlug || typeof restaurantSlug !== 'string' || !restaurantSlug.trim()) {
    return { success: false, error: "Identifiant du restaurant manquant ou invalide." };
  }
  const cleanSlug = restaurantSlug.trim();

  // 2. Validation de la clé d'idempotence (Obligatoire et format strict)
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return { 
      success: false, 
      error: "Clé d'idempotence ('idempotencyKey') obligatoire pour toute création de commande." 
    };
  }
  const cleanKey = idempotencyKey.trim();
  if (cleanKey.length < 8 || cleanKey.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(cleanKey)) {
    return {
      success: false,
      error: "Clé d'idempotence malformée (doit comporter entre 8 et 128 caractères alphanumériques, tiret ou tiret bas)."
    };
  }

  // 3. Validation du panier non vide
  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return { success: false, error: "Le panier est vide. Impossible de créer une commande." };
  }

  // 4. Validation du mode de commande
  if (orderMode !== 'sur_place' && orderMode !== 'a_emporter') {
    return { success: false, error: "Mode de commande invalide (doit être 'sur_place' ou 'a_emporter')." };
  }

  const now = Date.now();

  // 5. Calcul de l'empreinte canonique et dérivation des identifiants Firestore
  const currentSignature = computeOrderSignature({
    restaurantSlug: cleanSlug,
    orderMode,
    tableNumber,
    customerNote,
    cart
  });

  const { keyDocId, orderId, orderNumber } = deriveIdempotencyIdentifiers(cleanSlug, cleanKey);

  // 5b. Vérification précoce d'idempotence pour les fournisseurs mocks sans transaction unifiée
  if (!dataProvider.executeOrderTransaction && !dataProvider.reserveIdempotencyKey) {
    const existing = testFallbackStore.get(cleanKey);
    if (existing) {
      if (existing.restaurantSlug !== cleanSlug || existing.signature !== currentSignature) {
        return {
          success: false,
          conflict: true,
          error: `Conflit d'idempotence : La clé "${cleanKey}" a déjà été utilisée pour une requête différente.`
        };
      }
      return { success: true, order: existing.order, idempotentReplay: true };
    }
  }

  // 5c. Si un registre d'idempotence existe déjà, vérifier une commande persistée
  // avant la validation du catalogue (qui peut avoir changé depuis le premier envoi).
  if (
    dataProvider.executeOrderTransaction &&
    dataProvider.getIdempotencyRecord &&
    dataProvider.getOrderById
  ) {
    let existingKeyRecord: ServerIdempotencyRecord | null;
    try {
      existingKeyRecord = await dataProvider.getIdempotencyRecord(keyDocId);
    } catch (err: any) {
      return {
        success: false,
        uncertain: true,
        error: "Impossible de vérifier la clé de commande existante. Réessayez avec la même clé sans modifier le panier."
      };
    }

    if (existingKeyRecord) {
      if (
        existingKeyRecord.restaurantSlug !== cleanSlug ||
        existingKeyRecord.orderId !== orderId ||
        existingKeyRecord.signature !== currentSignature
      ) {
        return {
          success: false,
          conflict: true,
          error: "Conflit d'idempotence : cette clé est déjà associée à une autre commande."
        };
      }

      if (existingKeyRecord.status === 'failed') {
        return {
          success: false,
          conflict: true,
          error: "La tentative précédente a échoué définitivement. Une nouvelle clé de commande est nécessaire."
        };
      }

      let existingOrderProbe: OrderProbeResult;
      try {
        existingOrderProbe = await dataProvider.getOrderById(cleanSlug, orderId);
      } catch (err: any) {
        return {
          success: false,
          uncertain: true,
          error: "Impossible de vérifier l'existence de la commande précédente. Réessayez avec la même clé."
        };
      }

      if (existingOrderProbe.status === 'error') {
        return {
          success: false,
          uncertain: true,
          error: "Impossible de vérifier la commande précédente. Réessayez avec la même clé d'idempotence."
        };
      }

      if (existingOrderProbe.status === 'found') {
        const replayResult = await dataProvider.executeOrderTransaction({
          restaurantSlug: cleanSlug,
          idempotencyKey: cleanKey,
          keyDocId,
          orderId,
          signature: currentSignature,
          orderToCreate: existingOrderProbe.order
        });

        return replayResult.success
          ? { ...replayResult, idempotentReplay: true }
          : replayResult;
      }

      if (existingOrderProbe.status === 'not_found') {
        if (existingKeyRecord.status === 'completed') {
          return {
            success: false,
            uncertain: true,
            error: "Le registre indique une commande confirmée, mais le document de commande est introuvable. Ne modifiez pas le panier; une vérification est nécessaire."
          };
        }
        if (existingKeyRecord.status === 'processing') {
          const startedAt = existingKeyRecord.createdAt || existingKeyRecord.updatedAt || existingKeyRecord.timestamp || 0;
          if (Date.now() - startedAt < DEFAULT_IDEMPOTENCY_TIMEOUT_MS) {
            return {
              success: false,
              uncertain: true,
              error: "La commande précédente est encore en cours de traitement. Réessayez avec la même clé sans modifier le panier."
            };
          }
        }
      }
    }
  }

  // 5d. Le statut d'ouverture est vérifié côté serveur pour empêcher les commandes restaurant fermé.
  // Le rejeu d'une commande déjà confirmée a été traité plus haut et reste autorisé.
  if (dataProvider.getRestaurant) {
    let restaurant: { slug?: string; isOpen?: boolean } | null;
    try {
      restaurant = await dataProvider.getRestaurant(cleanSlug);
    } catch {
      return {
        success: false,
        error: "Impossible de vérifier l'état du restaurant. Aucune nouvelle commande n'a été envoyée; veuillez réessayer."
      };
    }
    if (!restaurant || restaurant.slug !== cleanSlug || restaurant.isOpen !== true) {
      return { success: false, error: "Ce restaurant est actuellement fermé ou indisponible. Votre commande n'a pas été envoyée." };
    }
  }

  // 6. Validation préalable du catalogue Firestore (Lecture de référence)
  let catalog: RestauMenuItem[];
  try {
    catalog = await dataProvider.getMenuItems(cleanSlug);
  } catch (err: any) {
    return { 
      success: false, 
      error: "Le catalogue est temporairement indisponible. Aucune commande n'a été envoyée; veuillez réessayer." 
    };
  }

  if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
    return { 
      success: false, 
      error: `Le catalogue du restaurant "${cleanSlug}" est vide ou introuvable dans Firestore. Commande refusée.` 
    };
  }

  // 7. Validation obligatoire des tables réelles pour les commandes sur place
  let cleanTableNumber: string | null = null;
  if (orderMode === 'sur_place') {
    if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
      return { success: false, error: "Le numéro de table est obligatoire pour une commande sur place." };
    }
    cleanTableNumber = tableNumber.trim();

    let realTables: RestaurantTable[];
    try {
      realTables = await dataProvider.getTables(cleanSlug);
    } catch (err: any) {
      return { 
        success: false, 
        error: "La configuration des tables est temporairement indisponible. Aucune commande n'a été envoyée; veuillez réessayer." 
      };
    }

    if (!realTables || !Array.isArray(realTables) || realTables.length === 0) {
      return { 
        success: false, 
        error: `Aucune table n'est configurée dans Firestore pour le restaurant "${cleanSlug}". Commande sur place refusée.` 
      };
    }

    const matched = realTables.find(
      t => t.tableNumber && t.tableNumber.trim().toLowerCase() === cleanTableNumber!.toLowerCase()
    );

    if (!matched) {
      return { 
        success: false, 
        error: `La table "${cleanTableNumber}" n'existe pas dans la configuration du restaurant.` 
      };
    }

    if (matched.isActive !== true) {
      return { 
        success: false, 
        error: `La table "${cleanTableNumber}" est actuellement inactive ou fermée.` 
      };
    }
  }

  // 8. Validation stricte du catalogue et de chaque ligne
  const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
  const verifiedItems: RestauOrderItem[] = [];

  for (let i = 0; i < cart.length; i++) {
    const line = cart[i];
    const catalogItem = catalogMap.get(line.menuItemId);

    if (!catalogItem) {
      return { 
        success: false, 
        error: `Le plat sélectionné (ID: "${line.menuItemId}") n'existe pas au catalogue officiel.` 
      };
    }

    if (!catalogItem.name || typeof catalogItem.name !== 'string' || !catalogItem.name.trim()) {
      return {
        success: false,
        error: `Donnée de catalogue corrompue : Le plat "${line.menuItemId}" ne possède pas de nom valide.`
      };
    }

    if (typeof catalogItem.price !== 'number' || !Number.isFinite(catalogItem.price) || catalogItem.price < 0) {
      return {
        success: false,
        error: `Donnée de catalogue corrompue : Le plat "${catalogItem.name}" possède un tarif invalide (${catalogItem.price}).`
      };
    }

    if (catalogItem.restaurantSlug && catalogItem.restaurantSlug !== cleanSlug) {
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" n'appartient pas au restaurant "${cleanSlug}".` 
      };
    }

    if (catalogItem.available !== true) {
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" est actuellement indisponible ou en rupture.` 
      };
    }

    const rawQty = line.quantity;
    if (typeof rawQty !== 'number' || !Number.isInteger(rawQty) || rawQty <= 0 || rawQty > 50) {
      return { 
        success: false, 
        error: `La quantité pour le plat "${catalogItem.name}" doit être un entier positif compris entre 1 et 50 (reçu: ${rawQty}).` 
      };
    }
    const qty = rawQty;

    // Validation serveur de chaque groupe d'options, obligatoire ou facultatif.
    // Compatibilité : les anciennes intentions à choix composite (groupId/optionId séparés par '+')
    // sont normalisées sans faire confiance aux noms ni aux prix envoyés par le client.
    const requiredGroups = (catalogItem.optionGroups || []).filter(g => g.required);
    if (line.selectedOptions !== undefined && !Array.isArray(line.selectedOptions)) {
      return { success: false, error: `Les options sélectionnées pour "${catalogItem.name}" sont invalides.` };
    }
    let requestedOptions = Array.isArray(line.selectedOptions) && line.selectedOptions.length > 0
      ? line.selectedOptions
      : line.selectedOption ? [line.selectedOption] : [];
    if ((!line.selectedOptions || line.selectedOptions.length === 0) && line.selectedOption?.groupId?.includes('+') && line.selectedOption?.optionId?.includes('+')) {
      const legacyGroups = line.selectedOption.groupId.split('+');
      const legacyOptions = line.selectedOption.optionId.split('+');
      if (legacyGroups.length === legacyOptions.length && legacyGroups.length > 1) {
        requestedOptions = legacyGroups.map((groupId, index) => ({ groupId, optionId: legacyOptions[index] }));
      }
    }

    const verifiedSelectedOptions: NonNullable<RestauOrderItem['selectedOptions']> = [];
    const selectedGroupIds = new Set<string>();
    for (const requestedOption of requestedOptions) {
      if (!requestedOption || typeof requestedOption.groupId !== 'string' || typeof requestedOption.optionId !== 'string') {
        return { success: false, error: `Une option sélectionnée pour "${catalogItem.name}" est malformée.` };
      }
      if (selectedGroupIds.has(requestedOption.groupId)) {
        return { success: false, error: `Plusieurs options ont été envoyées pour le même groupe de "${catalogItem.name}".` };
      }
      const targetGroup = (catalogItem.optionGroups || []).find(g => g.id === requestedOption.groupId);
      if (!targetGroup) {
        return { success: false, error: `Le groupe d'options "${requestedOption.groupId}" n'existe pas pour "${catalogItem.name}".` };
      }
      const targetOption = targetGroup.options.find(o => o.id === requestedOption.optionId);
      if (!targetOption) {
        return { success: false, error: `L'option "${requestedOption.optionId}" est introuvable dans le groupe "${targetGroup.name}".` };
      }
      if (typeof targetOption.extraPrice !== 'number' || !Number.isFinite(targetOption.extraPrice) || targetOption.extraPrice < 0) {
        return {
          success: false,
          error: `Donnée de catalogue corrompue : L'option "${targetOption.name}" possède un surcoût invalide (${targetOption.extraPrice}).`
        };
      }
      selectedGroupIds.add(targetGroup.id);
      verifiedSelectedOptions.push({
        groupId: targetGroup.id,
        groupName: targetGroup.name,
        optionId: targetOption.id,
        optionName: targetOption.name,
        extraPrice: targetOption.extraPrice
      });
    }

    const missingRequiredGroups = requiredGroups.filter(group => !selectedGroupIds.has(group.id));
    if (missingRequiredGroups.length > 0) {
      return {
        success: false,
        error: `Une option obligatoire (${missingRequiredGroups.map(group => group.name).join(', ')}) est requise pour "${catalogItem.name}".`
      };
    }
    const verifiedSelectedOption = verifiedSelectedOptions.length === 1 ? verifiedSelectedOptions[0] : undefined;

    // Validation des suppléments (extras)
    const verifiedExtrasList: Array<{ extraId: string; name: string; price: number }> = [];
    if (line.selectedExtras !== undefined && !Array.isArray(line.selectedExtras)) {
      return { success: false, error: `Les suppléments sélectionnés pour "${catalogItem.name}" sont invalides.` };
    }
    if (line.selectedExtras && Array.isArray(line.selectedExtras)) {
      const availableExtrasMap = new Map((catalogItem.availableExtras || []).map(e => [e.id, e]));
      const selectedExtraIds = new Set<string>();

      for (const reqExtra of line.selectedExtras) {
        if (selectedExtraIds.has(reqExtra.extraId)) {
          return { success: false, error: `Le supplément "${reqExtra.extraId}" a été sélectionné plusieurs fois pour "${catalogItem.name}".` };
        }
        selectedExtraIds.add(reqExtra.extraId);
        const catalogExtra = availableExtrasMap.get(reqExtra.extraId);
        if (!catalogExtra) {
          return { 
            success: false, 
            error: `Le supplément sélectionné ("${reqExtra.extraId}") est non disponible pour le plat "${catalogItem.name}".` 
          };
        }

        if (typeof catalogExtra.price !== 'number' || !Number.isFinite(catalogExtra.price) || catalogExtra.price < 0) {
          return {
            success: false,
            error: `Donnée de catalogue corrompue : Le supplément "${catalogExtra.name}" possède un prix invalide (${catalogExtra.price}).`
          };
        }

        verifiedExtrasList.push({
          extraId: catalogExtra.id,
          name: catalogExtra.name,
          price: catalogExtra.price
        });
      }
    }

    const trustedBasePrice = catalogItem.price;
    const optionExtraPrice = verifiedSelectedOptions.reduce((sum, option) => sum + option.extraPrice, 0);
    const extrasCost = verifiedExtrasList.reduce((sum, e) => sum + e.price, 0);
    const trustedUnitPrice = trustedBasePrice + optionExtraPrice + extrasCost;
    const lineTotal = trustedUnitPrice * qty;

    verifiedItems.push({
      id: `line-${orderId}-${i}`,
      menuItemId: catalogItem.id,
      name: catalogItem.name,
      basePrice: trustedBasePrice,
      unitPrice: trustedUnitPrice,
      quantity: qty,
      totalPrice: lineTotal,
      selectedOption: verifiedSelectedOption,
      selectedOptions: verifiedSelectedOptions.length > 1 ? verifiedSelectedOptions : undefined,
      selectedExtras: verifiedExtrasList.length > 0 ? verifiedExtrasList : undefined,
      prepNotes: sanitizeNote(line.prepNotes, 150)
    });
  }

  // 9. Recalcul déterministe du total général
  const grandTotal = calculateOrderTotal(verifiedItems);

  // 10. Détection de falsification de prix par rapport au total déclaré
  if (declaredTotal !== undefined && Math.round(Number(declaredTotal)) !== grandTotal) {
    return { 
      success: false, 
      error: `Le total de la commande a été falsifié ou ne concorde pas avec le tarif officiel (recalculé: ${grandTotal} FCFA, soumis: ${declaredTotal} FCFA).` 
    };
  }

  // 11. Construction de la commande confirmée avec identifiants stables et traçabilité
  const confirmedOrder: RestauOrder = {
    id: orderId,
    orderNumber,
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
    idempotencyKey: cleanKey,
    idempotencyDocId: keyDocId,
    contentSignature: currentSignature
  };

  // 12. Transaction Firestore atomique unifiée (L'exigence centrale 4.4)
  if (dataProvider.executeOrderTransaction) {
    try {
      const txResult = await dataProvider.executeOrderTransaction({
        restaurantSlug: cleanSlug,
        idempotencyKey: cleanKey,
        keyDocId,
        orderId,
        signature: currentSignature,
        orderToCreate: confirmedOrder
      });
      return txResult;
    } catch (err: any) {
      return {
        success: false,
        uncertain: true,
        error: "La confirmation de la transaction est incertaine. Réessayez avec la même clé sans modifier le panier."
      };
    }
  }

  // 13. Fallback pour fournisseurs sans executeOrderTransaction (tests unitaires mocks historiques)
  if (!dataProvider.executeOrderTransaction && !dataProvider.reserveIdempotencyKey) {
    const existing = testFallbackStore.get(cleanKey);
    if (existing) {
      if (existing.restaurantSlug !== cleanSlug || existing.signature !== currentSignature) {
        return {
          success: false,
          conflict: true,
          error: `Conflit d'idempotence : La clé "${cleanKey}" a déjà été utilisée pour une requête différente.`
        };
      }
      return { success: true, order: existing.order, idempotentReplay: true };
    }
  }

  if (dataProvider.reserveIdempotencyKey) {
    let reservation: IdempotencyReservationResult;
    try {
      reservation = await dataProvider.reserveIdempotencyKey(cleanKey, currentSignature);
    } catch (err: any) {
      return {
        success: false,
        uncertain: true,
        error: "Le registre de commande est temporairement indisponible. Réessayez avec la même clé de commande."
      };
    }

    if (reservation.status === 'conflict') {
      return {
        success: false,
        conflict: true,
        error: reservation.error || `Conflit d'idempotence : La clé "${cleanKey}" a déjà été utilisée pour une requête différente.`
      };
    }

    if (reservation.status === 'completed' && !reservation.record?.order) {
      return {
        success: false,
        uncertain: true,
        error: "Le registre confirme une commande mais ne contient pas de résultat vérifiable. Une vérification est nécessaire avant toute nouvelle commande."
      };
    }

    if (reservation.status === 'completed' && reservation.record?.order) {
      if (dataProvider.getOrderById && reservation.record.order.id) {
        const probe = await dataProvider.getOrderById(cleanSlug, reservation.record.order.id);
        if (probe.status === 'found') {
          return { success: true, order: probe.order, idempotentReplay: true };
        } else if (probe.status === 'error') {
          return { success: false, uncertain: true, error: "Impossible de vérifier la commande précédente. Réessayez avec la même clé." };
        } else {
          return { success: false, uncertain: true, error: "Incohérence persistante : la commande enregistrée sous cette clé est introuvable dans Firestore. Vérification nécessaire." };
        }
      }
      return { success: true, order: reservation.record.order, idempotentReplay: true };
    }

    if (reservation.status === 'in_progress') {
      return {
        success: false,
        uncertain: true,
        error: "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement. Réessayez avec la même clé sans modifier le panier."
      };
    }

    if (reservation.status === 'ambiguous') {
      const pendingId = reservation.record?.pendingOrderId;
      if (!pendingId) {
        return { success: false, uncertain: true, error: "La clé d'idempotence est dans un état ambigu sans identifiant traçable. Vérification nécessaire avant toute nouvelle tentative." };
      }
      if (!dataProvider.getOrderById) {
        return { success: false, uncertain: true, error: "Impossible de vérifier si la commande précédente a été enregistrée. Réessayez avec la même clé." };
      }
      const probe = await dataProvider.getOrderById(cleanSlug, pendingId);
      if (probe.status === 'error') {
        return { success: false, uncertain: true, error: "Impossible de vérifier la commande précédente. Réessayez avec la même clé." };
      }
      if (probe.status === 'found') {
        if (dataProvider.commitIdempotencyKey) {
          await dataProvider.commitIdempotencyKey(cleanKey, probe.order, currentSignature);
        }
        return { success: true, order: probe.order, idempotentReplay: true };
      }
      if (!dataProvider.transitionKeyToProcessing) {
        return { success: false, uncertain: true, error: "La reprise sécurisée de cette commande n'est pas disponible. Vérification nécessaire." };
      }
      const transitioned = await dataProvider.transitionKeyToProcessing(cleanKey, currentSignature, 'ambiguous');
      if (!transitioned) {
        return { success: false, uncertain: true, error: "Une autre instance a déjà repris le traitement de cette clé. Réessayez avec la même clé." };
      }
    }
  }

  // Sauvegarde simple avec commit séparé pour mocks anciens
  if (dataProvider.saveOrder) {
    try {
      await dataProvider.saveOrder(cleanSlug, confirmedOrder);
    } catch (writeErr: any) {
      if (dataProvider.getOrderById) {
        const probe = await dataProvider.getOrderById(cleanSlug, confirmedOrder.id);
        if (probe.status === 'found') {
          if (dataProvider.commitIdempotencyKey) {
            await dataProvider.commitIdempotencyKey(cleanKey, probe.order, currentSignature);
          }
          return { success: true, order: probe.order, idempotentReplay: true };
        }
      }
      if (dataProvider.markIdempotencyAmbiguous) {
        try {
          await dataProvider.markIdempotencyAmbiguous(cleanKey, confirmedOrder.id, currentSignature, writeErr.message);
        } catch (markErr: any) {
          return {
            success: false,
            uncertain: true,
            error: "Le statut de la commande ne peut pas être confirmé. Réessayez avec la même clé sans modifier le panier."
          };
        }
      }
      return {
        success: false,
        uncertain: true,
        error: "Le statut de la commande est incertain. Réessayez avec la même clé sans modifier le panier."
      };
    }
  }

  if (dataProvider.commitIdempotencyKey) {
    try {
      await dataProvider.commitIdempotencyKey(cleanKey, confirmedOrder, currentSignature);
    } catch (commitErr: any) {
      if (dataProvider.markIdempotencyAmbiguous) {
        try {
          await dataProvider.markIdempotencyAmbiguous(cleanKey, confirmedOrder.id, currentSignature, commitErr.message);
        } catch (markErr: any) {
          // ignore nested failure
        }
      }
      return {
        success: false,
        uncertain: true,
        error: "La commande a peut-être été enregistrée, mais sa confirmation a échoué. Réessayez avec la même clé sans modifier le panier."
      };
    }
  }

  if (!dataProvider.executeOrderTransaction && !dataProvider.reserveIdempotencyKey) {
    testFallbackStore.set(cleanKey, {
      signature: currentSignature,
      order: confirmedOrder,
      restaurantSlug: cleanSlug
    });
  }

  return { 
    success: true, 
    order: confirmedOrder 
  };
}
