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
 * Enregistrement d'idempotence avec horodatage, empreinte canonique et traçabilité post-panne
 */
export interface ServerIdempotencyRecord {
  timestamp: number;
  status: 'processing' | 'completed' | 'ambiguous' | 'failed';
  order?: RestauOrder;
  pendingOrderId?: string;
  signature: string;
  errorReason?: string;
}

export type IdempotencyReservationStatus = 
  | 'reserved'     // Réservation atomique acquise par cette instance
  | 'completed'    // Commande déjà finalisée et identique (rejeu immédiat)
  | 'in_progress'  // En cours de traitement par une autre instance (concurrence)
  | 'conflict'     // Clé déjà utilisée pour une requête différente (rejet immédiat)
  | 'ambiguous';   // Panne antérieure ambiguë (réconciliation requise)

export interface IdempotencyReservationResult {
  status: IdempotencyReservationStatus;
  record?: ServerIdempotencyRecord;
  error?: string;
}

/**
 * Résultat strict de la sonde de vérification Firestore
 * Distingue explicitement :
 * - 'found' : commande existante en base
 * - 'not_found' : lecture réussie, document confirmé absent
 * - 'error' : panne de lecture / timeout / indisponibilité
 */
export type OrderProbeResult = 
  | { status: 'found'; order: RestauOrder }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

// Cache d'idempotence mémoire local (protection au sein du même processus Node.js)
const serverIdempotencyStore = new Map<string, ServerIdempotencyRecord>();

export function clearServerIdempotencyStore(): void {
  serverIdempotencyStore.clear();
}

/**
 * Calcule l'empreinte canonique et déterministe d'un panier et de sa configuration.
 * Champs obligatoirement couverts par la signature :
 * - restaurantSlug : normalisé avec trim()
 * - orderMode : mode exact ('sur_place' | 'a_emporter')
 * - tableNumber : normalisé avec trim() ou chaîne vide
 * - customerNote : note client globale normalisée avec trim()
 * - cart : liste triée et normalisée contenant :
 *     - menuItemId
 *     - quantity
 *     - selectedOption (groupId:optionId)
 *     - selectedExtras (liste triée des extraId)
 *     - prepNotes (note de préparation de la ligne, normalisée avec trim())
 */
export function computeOrderSignature(payload: {
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  customerNote?: string;
  cart: OrderSubmissionPayload['cart'];
}): string {
  const normCart = (payload.cart || [])
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

  const cleanNote = (payload.customerNote || '').trim();
  return `${payload.restaurantSlug.trim()}::${payload.orderMode}::${(payload.tableNumber || '').trim()}::${cleanNote}::${normCart}`;
}

/**
 * Interface de confiance d'accès aux données Firestore serveur
 * Supporte les opérations transactionnelles atomiques pour l'idempotence distribuée
 */
export interface ServerFirestoreProvider {
  getMenuItems(restaurantSlug: string): Promise<RestauMenuItem[]>;
  getTables(restaurantSlug: string): Promise<RestaurantTable[]>;
  saveOrder(restaurantSlug: string, order: RestauOrder): Promise<void>;
  
  // Sonde de vérification Firestore stricte (distingue 'found', 'not_found' et 'error')
  getOrderById?(restaurantSlug: string, orderId: string): Promise<OrderProbeResult>;

  // Mécanisme transactionnel atomique de réservation de clé
  reserveIdempotencyKey?(
    key: string,
    signature: string,
    timeoutMs?: number
  ): Promise<IdempotencyReservationResult>;

  // Reprise atomique d'une clé ambiguë après confirmation de non-existence
  transitionKeyToProcessing?(
    key: string,
    signature: string,
    fromStatus: 'ambiguous' | 'failed'
  ): Promise<boolean>;

  // Finalisation atomique / mise à jour
  commitIdempotencyKey?(
    key: string,
    order: RestauOrder,
    signature: string
  ): Promise<void>;

  // Enregistrement d'un état ambigu lors d'un échec d'écriture non confirmé
  markIdempotencyAmbiguous?(
    key: string,
    orderId: string,
    signature: string,
    reason: string
  ): Promise<void>;

  // Libération / suppression de clé (uniquement avant tentative d'écriture)
  releaseIdempotencyKey?(key: string): Promise<void>;

  // Interfaces d'accès registre simple (fallback)
  getIdempotencyRecord?(key: string): Promise<ServerIdempotencyRecord | null>;
  saveIdempotencyRecord?(key: string, record: ServerIdempotencyRecord): Promise<void>;
  deleteIdempotencyRecord?(key: string): Promise<void>;
}

/**
 * Libère une clé d'idempotence UNIQUEMENT lors des rejets de validation préliminaires
 * (panier vide, table fermée, catalogue corrompu) AVANT toute tentative d'écriture.
 */
async function releaseIdempotencyKeyBeforeWrite(key: string, dataProvider: ServerFirestoreProvider): Promise<void> {
  serverIdempotencyStore.delete(key);
  if (dataProvider.releaseIdempotencyKey) {
    try {
      await dataProvider.releaseIdempotencyKey(key);
    } catch (err: any) {
      console.warn('[Idempotency] Erreur non critique lors de releaseIdempotencyKey:', err.message);
    }
  } else if (dataProvider.deleteIdempotencyRecord) {
    try {
      await dataProvider.deleteIdempotencyRecord(key);
    } catch (err: any) {
      console.warn('[Idempotency] Erreur non critique lors de deleteIdempotencyRecord:', err.message);
    }
  }
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

  // 1. Validation structurelle du payload
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

  // Nettoyage des clés mémoires expirées (10 min)
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
    customerNote,
    cart
  });

  // 2. Gestion atomique de l'idempotence
  if (effectiveIdempotencyKey) {
    // A. Cas d'un provider avec réservation transactionnelle atomique (multi-instance)
    if (dataProvider.reserveIdempotencyKey) {
      let reservation: IdempotencyReservationResult;
      try {
        reservation = await dataProvider.reserveIdempotencyKey(effectiveIdempotencyKey, currentSignature);
      } catch (err: any) {
        // RÈGLE D'AUDIT 1 : Ne JAMAIS continuer si la lecture ou l'écriture du registre persistant échoue
        return {
          success: false,
          error: `Échec du registre persistant d'idempotence : ${err.message || 'Erreur d\'accès au registre'}. Traitement interrompu pour prévenir tout doublon.`
        };
      }

      // Rejet immédiat si conflit de signature / contenu différent
      if (reservation.status === 'conflict') {
        return {
          success: false,
          error: reservation.error || `Conflit d'idempotence : La clé "${effectiveIdempotencyKey}" a déjà été utilisée pour une requête différente.`
        };
      }

      // Rejeu immédiat si commande déjà confirmée identique
      if (reservation.status === 'completed' && reservation.record?.order) {
        return {
          success: true,
          order: reservation.record.order,
          idempotentReplay: true
        };
      }

      // Rejet si une autre instance est déjà en cours de traitement
      if (reservation.status === 'in_progress') {
        return {
          success: false,
          error: reservation.error || "Une requête identique avec cette clé d'idempotence est déjà en cours de traitement par une autre instance."
        };
      }

      // Cas ambigu : tentative antérieure avec coupure ou échec non confirmé
      if (reservation.status === 'ambiguous') {
        const pendingId = reservation.record?.pendingOrderId;
        if (!pendingId) {
          return {
            success: false,
            error: "La clé d'idempotence est dans un état ambigu sans identifiant traçable. Nouvelle tentative interrompue."
          };
        }

        if (!dataProvider.getOrderById) {
          return {
            success: false,
            error: "Sonde Firestore indisponible : impossible de vérifier si la commande précédente a été enregistrée. Nouvelle tentative suspendue."
          };
        }

        // RÈGLE D'AUDIT 1 : Distinguer strictement les résultats de la sonde
        const probe = await dataProvider.getOrderById(cleanSlug, pendingId);

        if (probe.status === 'error') {
          // La sonde a échoué (panne réseau, timeout, etc.) -> Interruption formelle
          return {
            success: false,
            error: `La vérification de l'état de la commande précédente a échoué (${probe.error}). Impossible de confirmer l'absence ou la présence de la commande. Veuillez réessayer plus tard avec la même clé d'idempotence.`
          };
        }

        if (probe.status === 'found') {
          // Commande retrouvée en base : réconcilier le registre avant de retourner le succès
          if (dataProvider.commitIdempotencyKey) {
            try {
              await dataProvider.commitIdempotencyKey(effectiveIdempotencyKey, probe.order, currentSignature);
            } catch (commitErr: any) {
              return {
                success: false,
                error: `La commande a été retrouvée dans Firestore mais la réconciliation du registre persistant a échoué (${commitErr.message}). Veuillez relancer la requête.`
              };
            }
          }
          serverIdempotencyStore.set(effectiveIdempotencyKey, {
            timestamp: now,
            status: 'completed',
            order: probe.order,
            signature: currentSignature
          });
          return {
            success: true,
            order: probe.order,
            idempotentReplay: true
          };
        }

        // probe.status === 'not_found' : Absence formellement confirmée par Firestore
        // RÈGLE : Ne pas créer immédiatement sans nouvelle décision atomique et persistante
        if (dataProvider.transitionKeyToProcessing) {
          const transitioned = await dataProvider.transitionKeyToProcessing(effectiveIdempotencyKey, currentSignature, 'ambiguous');
          if (!transitioned) {
            return {
              success: false,
              error: "Une autre instance a déjà repris le traitement de cette clé d'idempotence ambiguë."
            };
          }
        } else if (dataProvider.saveIdempotencyRecord) {
          try {
            await dataProvider.saveIdempotencyRecord(effectiveIdempotencyKey, {
              timestamp: now,
              status: 'processing',
              signature: currentSignature
            });
          } catch (err: any) {
            return {
              success: false,
              error: `Échec de mise à jour du verrou persistant après réconciliation : ${err.message}.`
            };
          }
        }
      }
    } else {
      // B. Cas d'un provider avec registre simple ou mémoire locale
      if (dataProvider.getIdempotencyRecord) {
        try {
          const remoteRecord = await dataProvider.getIdempotencyRecord(effectiveIdempotencyKey);
          if (remoteRecord) {
            serverIdempotencyStore.set(effectiveIdempotencyKey, remoteRecord);
          }
        } catch (err: any) {
          return {
            success: false,
            error: `Échec du registre persistant d'idempotence : ${err.message || 'Erreur registre'}. Traitement interrompu pour prévenir tout doublon.`
          };
        }
      }

      const existingRecord = serverIdempotencyStore.get(effectiveIdempotencyKey);
      if (existingRecord) {
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

        if (existingRecord.status === 'ambiguous' && existingRecord.pendingOrderId && dataProvider.getOrderById) {
          const probe = await dataProvider.getOrderById(cleanSlug, existingRecord.pendingOrderId);
          if (probe.status === 'error') {
            return {
              success: false,
              error: `La vérification de l'état de la commande précédente a échoué (${probe.error}). Impossible de confirmer l'absence ou la présence de la commande. Veuillez réessayer plus tard avec la même clé d'idempotence.`
            };
          }
          if (probe.status === 'found') {
            existingRecord.status = 'completed';
            existingRecord.order = probe.order;
            if (dataProvider.saveIdempotencyRecord) {
              try {
                await dataProvider.saveIdempotencyRecord(effectiveIdempotencyKey, existingRecord);
              } catch (commitErr: any) {
                return {
                  success: false,
                  error: `La commande a été retrouvée mais la mise à jour persistante du registre a échoué (${commitErr.message}).`
                };
              }
            }
            return { success: true, order: probe.order, idempotentReplay: true };
          }
          // not_found : réinitialiser l'état
          existingRecord.status = 'processing';
          existingRecord.timestamp = now;
        }
      }

      // Verrou local
      const processingRecord: ServerIdempotencyRecord = {
        timestamp: now,
        status: 'processing',
        signature: currentSignature
      };
      serverIdempotencyStore.set(effectiveIdempotencyKey, processingRecord);

      if (dataProvider.saveIdempotencyRecord) {
        try {
          await dataProvider.saveIdempotencyRecord(effectiveIdempotencyKey, processingRecord);
        } catch (err: any) {
          serverIdempotencyStore.delete(effectiveIdempotencyKey);
          return {
            success: false,
            error: `Échec d'enregistrement du verrou d'idempotence : ${err.message || 'Erreur registre'}. Traitement interrompu pour prévenir tout doublon.`
          };
        }
      }
    }
  }

  // 3. Validation préalable du catalogue
  let catalog: RestauMenuItem[];
  try {
    catalog = await dataProvider.getMenuItems(cleanSlug);
  } catch (err: any) {
    if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
    return { 
      success: false, 
      error: `Erreur serveur lors de la lecture du catalogue Firestore : ${err.message || 'Échec de connexion'}. Aucun catalogue de secours n'est autorisé.` 
    };
  }

  if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
    if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
    return { 
      success: false, 
      error: `Le catalogue du restaurant "${cleanSlug}" est vide ou introuvable dans Firestore. Commande refusée.` 
    };
  }

  // 4. Validation obligatoire des tables réelles pour les commandes sur place
  let cleanTableNumber: string | null = null;
  if (orderMode === 'sur_place') {
    if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { success: false, error: "Le numéro de table est obligatoire pour une commande sur place." };
    }
    cleanTableNumber = tableNumber.trim();

    let realTables: RestaurantTable[];
    try {
      realTables = await dataProvider.getTables(cleanSlug);
    } catch (err: any) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Erreur serveur lors de la lecture des tables Firestore pour "${cleanSlug}" : ${err.message || 'Panne de connexion'}. Commande sur place refusée.` 
      };
    }

    if (!realTables || !Array.isArray(realTables) || realTables.length === 0) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Aucune table n'est configurée dans Firestore pour le restaurant "${cleanSlug}". Commande sur place refusée.` 
      };
    }

    const matched = realTables.find(
      t => t.tableNumber && t.tableNumber.trim().toLowerCase() === cleanTableNumber!.toLowerCase()
    );

    if (!matched) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `La table "${cleanTableNumber}" n'existe pas dans la configuration du restaurant.` 
      };
    }

    if (matched.isActive !== true) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `La table "${cleanTableNumber}" est actuellement inactive ou fermée.` 
      };
    }
  }

  // 5. Validation stricte du catalogue et de chaque ligne
  const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
  const verifiedItems: RestauOrderItem[] = [];

  for (let i = 0; i < cart.length; i++) {
    const line = cart[i];
    const catalogItem = catalogMap.get(line.menuItemId);

    if (!catalogItem) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Le plat sélectionné (ID: "${line.menuItemId}") n'existe pas au catalogue officiel.` 
      };
    }

    if (!catalogItem.name || typeof catalogItem.name !== 'string' || !catalogItem.name.trim()) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return {
        success: false,
        error: `Donnée de catalogue corrompue : Le plat "${line.menuItemId}" ne possède pas de nom valide.`
      };
    }

    if (typeof catalogItem.price !== 'number' || !Number.isFinite(catalogItem.price) || catalogItem.price < 0) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return {
        success: false,
        error: `Donnée de catalogue corrompue : Le prix de base du plat "${catalogItem.name}" est invalide (${catalogItem.price}). Commande rejetée.`
      };
    }

    if (catalogItem.restaurantSlug && catalogItem.restaurantSlug !== cleanSlug) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" n'appartient pas au restaurant "${cleanSlug}".` 
      };
    }

    if (catalogItem.available !== true) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" est actuellement indisponible ou en rupture de stock.` 
      };
    }

    const qty = line.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
      return { 
        success: false, 
        error: `La quantité pour "${catalogItem.name}" doit être un entier positif compris entre 1 et 50 (reçu: ${qty}).` 
      };
    }

    const availableOptionGroups = catalogItem.optionGroups || [];
    for (const group of availableOptionGroups) {
      if (group.required) {
        const hasSelectedGroup = line.selectedOption && line.selectedOption.groupId === group.id;
        if (!hasSelectedGroup) {
          if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
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
        if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `Le groupe d'options "${line.selectedOption.groupId}" n'est pas autorisé pour le plat "${catalogItem.name}".` 
        };
      }

      const catalogOption = catalogGroup.options?.find(o => o.id === line.selectedOption?.optionId);
      if (!catalogOption) {
        if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
        return { 
          success: false, 
          error: `L'option "${line.selectedOption.optionId}" est introuvable / inexistante dans le groupe "${catalogGroup.name}".` 
        };
      }

      if (catalogOption.extraPrice !== undefined) {
        if (typeof catalogOption.extraPrice !== 'number' || !Number.isFinite(catalogOption.extraPrice) || catalogOption.extraPrice < 0) {
          if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
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

    let extrasCost = 0;
    const verifiedExtrasList: RestauOrderItem['selectedExtras'] = [];

    if (line.selectedExtras && line.selectedExtras.length > 0) {
      const availableExtras = catalogItem.availableExtras || [];
      const extrasMap = new Map(availableExtras.map(e => [e.id, e]));

      for (const ext of line.selectedExtras) {
        const catalogExtra = extrasMap.get(ext.extraId);
        if (!catalogExtra) {
          if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
          return { 
            success: false, 
            error: `Le supplément "${ext.extraId}" est non disponible / non autorisé pour le plat "${catalogItem.name}".` 
          };
        }

        if (typeof catalogExtra.price !== 'number' || !Number.isFinite(catalogExtra.price) || catalogExtra.price < 0) {
          if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
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

  // 6. Recalcul déterministe du total
  const grandTotal = calculateOrderTotal(verifiedItems);

  // 7. Détection de falsification de prix
  if (declaredTotal !== undefined && Math.round(Number(declaredTotal)) !== grandTotal) {
    if (effectiveIdempotencyKey) await releaseIdempotencyKeyBeforeWrite(effectiveIdempotencyKey, dataProvider);
    return { 
      success: false, 
      error: `Le total de la commande a été falsifié ou ne concorde pas avec le tarif officiel (recalculé: ${grandTotal} FCFA, soumis: ${declaredTotal} FCFA).` 
    };
  }

  // 8. Génération de l'ordre complet
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const humanOrderNumber = `#CMD-${randomSuffix}`;
  const orderIdSuffix = effectiveIdempotencyKey 
    ? effectiveIdempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 32)
    : Math.random().toString(36).substring(2, 7);

  const confirmedOrder: RestauOrder = {
    id: `ord-${now}-${orderIdSuffix}`,
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

  // 9. Enregistrement de la commande dans Firestore et gestion stricte des pannes
  try {
    await dataProvider.saveOrder(cleanSlug, confirmedOrder);
  } catch (writeErr: any) {
    // Panne réseau ou délai d'attente lors de l'écriture
    // RÈGLE D'AUDIT 1 & 4 : Ne pas affirmer que la commande n'existe pas sans vérification stricte
    let probe: OrderProbeResult | null = null;
    if (dataProvider.getOrderById) {
      probe = await dataProvider.getOrderById(cleanSlug, confirmedOrder.id);
    }

    if (probe && probe.status === 'found') {
      // L'écriture a réussi malgré la coupure réseau !
      if (effectiveIdempotencyKey) {
        if (dataProvider.commitIdempotencyKey) {
          try {
            await dataProvider.commitIdempotencyKey(effectiveIdempotencyKey, probe.order, currentSignature);
          } catch (commitErr: any) {
            // RÈGLE D'AUDIT 2 : Ne pas masquer l'erreur de confirmation
            if (dataProvider.markIdempotencyAmbiguous) {
              await dataProvider.markIdempotencyAmbiguous(
                effectiveIdempotencyKey,
                probe.order.id,
                currentSignature,
                `Écriture réussie mais échec commit: ${commitErr.message}`
              );
            }
            return {
              success: false,
              error: `La commande a été écrite dans Firestore mais la confirmation d'idempotence a échoué (${commitErr.message}). Pour éviter les doublons, relancez la requête avec la même clé afin de réconcilier l'état.`
            };
          }
        }
        serverIdempotencyStore.set(effectiveIdempotencyKey, {
          timestamp: now,
          status: 'completed',
          order: probe.order,
          signature: currentSignature
        });
      }
      return {
        success: true,
        order: probe.order,
        idempotentReplay: true
      };
    }

    // L'existence n'est pas confirmée ('error' ou 'not_found')
    // RÈGLE D'AUDIT 2 : Ne jamais supprimer ou libérer une clé après une tentative d'écriture
    if (effectiveIdempotencyKey) {
      if (dataProvider.markIdempotencyAmbiguous) {
        try {
          await dataProvider.markIdempotencyAmbiguous(
            effectiveIdempotencyKey, 
            confirmedOrder.id, 
            currentSignature, 
            writeErr.message || "Délai d'attente écriture Firestore"
          );
        } catch (markErr: any) {
          // RÈGLE : Ne pas utiliser de .catch(() => {}) pour masquer un échec critique
          return {
            success: false,
            error: `Échec d'enregistrement de la commande (${writeErr.message}) ET échec de marquage ambigu du registre (${markErr.message}). Traitement interrompu pour prévenir tout doublon.`
          };
        }
      }

      serverIdempotencyStore.set(effectiveIdempotencyKey, {
        timestamp: now,
        status: 'ambiguous',
        pendingOrderId: confirmedOrder.id,
        signature: currentSignature,
        errorReason: writeErr.message
      });
    }

    const probeDetail = probe?.status === 'error' ? ` (Sonde Firestore en échec: ${probe.error})` : '';
    return {
      success: false,
      error: `Statut d'écriture ambigu dans Firestore : ${writeErr.message || 'Panne réseau ou délai dépassé'}${probeDetail}. ` +
        `L'état exact de la commande n'a pas pu être immédiatement vérifié. Veuillez relancer avec la même clé d'idempotence pour permettre la réconciliation automatique sans double commande.`
    };
  }

  // 10. Confirmation d'idempotence après succès avéré de l'écriture
  if (effectiveIdempotencyKey) {
    if (dataProvider.commitIdempotencyKey) {
      try {
        await dataProvider.commitIdempotencyKey(effectiveIdempotencyKey, confirmedOrder, currentSignature);
      } catch (commitErr: any) {
        // RÈGLE D'AUDIT 2 : Ne JAMAIS annoncer une réussite confirmée tant que l'état persistant completed n'a pas été confirmé
        if (dataProvider.markIdempotencyAmbiguous) {
          try {
            await dataProvider.markIdempotencyAmbiguous(
              effectiveIdempotencyKey,
              confirmedOrder.id,
              currentSignature,
              `Commande écrite mais échec commit: ${commitErr.message}`
            );
          } catch (markErr: any) {
            console.error('[Idempotency] Erreur critique marquage ambigu:', markErr.message);
          }
        }

        serverIdempotencyStore.set(effectiveIdempotencyKey, {
          timestamp: now,
          status: 'ambiguous',
          pendingOrderId: confirmedOrder.id,
          signature: currentSignature,
          errorReason: `Échec commit idempotence: ${commitErr.message}`
        });

        return {
          success: false,
          error: `La commande a été enregistrée dans Firestore mais la confirmation d'idempotence a échoué (${commitErr.message}). Pour garantir l'absence de doublons, veuillez relancer avec la même clé d'idempotence pour réconcilier l'état.`
        };
      }
    }

    serverIdempotencyStore.set(effectiveIdempotencyKey, {
      timestamp: now,
      status: 'completed',
      order: confirmedOrder,
      signature: currentSignature
    });
  }

  return { 
    success: true, 
    order: confirmedOrder 
  };
}
