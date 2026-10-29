import { 
  RestauMenuItem, 
  ClientCartItem, 
  RestauOrder, 
  RestauOrderItem, 
  RestaurantTable,
  OrderMode 
} from '../types/restaumax';

/**
 * Calcule de façon déterministe le prix unitaire en FCFA (sans centimes)
 * en combinant le prix de base du plat, l'option choisie et les extras.
 */
export function calculateItemUnitPrice(
  basePrice: number,
  selectedOption?: { extraPrice: number } | null,
  selectedExtras?: { price: number }[] | null
): number {
  const safeBase = Math.max(0, Math.round(Number(basePrice) || 0));
  const optionCost = Math.max(0, Math.round(Number(selectedOption?.extraPrice) || 0));
  const extrasCost = (selectedExtras || []).reduce(
    (sum, extra) => sum + Math.max(0, Math.round(Number(extra.price) || 0)),
    0
  );
  return safeBase + optionCost + extrasCost;
}

/**
 * Calcule le montant total d'une commande à partir des lignes recalculées
 */
export function calculateOrderTotal(
  items: Array<{ unitPrice: number; quantity: number }>
): number {
  return items.reduce((total, item) => {
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const unit = Math.max(0, Math.round(Number(item.unitPrice) || 0));
    return total + (unit * qty);
  }, 0);
}

// In-memory idempotency cache for duplicate submission protection (15 seconds TTL)
interface CachedSubmission {
  timestamp: number;
  order: RestauOrder;
  signature: string;
}
const submissionCache = new Map<string, CachedSubmission>();

export function clearOrderSubmissionCache(): void {
  submissionCache.clear();
}

/**
 * Nettoie une chaîne de notes (anti-XSS et limite de taille)
 */
export function sanitizeNote(note?: string, maxLength: number = 150): string | undefined {
  if (!note) return undefined;
  const stripped = note.replace(/<[^>]*>?/gm, '').trim();
  if (!stripped) return undefined;
  return stripped.substring(0, maxLength);
}

export interface ValidateOrderParams {
  cart: ClientCartItem[];
  catalog: RestauMenuItem[];
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  customerNote?: string;
  allowedTables?: RestaurantTable[];
  idempotencyKey?: string;
  declaredTotal?: number;
  rejectTamperedPrices?: boolean;
}

/**
 * Valide un panier client contre le catalogue de plats de confiance (côté serveur / service)
 * Rejette toute incohérence de prix, plat inexistant ou indisponible, et construit la commande RestauMax.
 */
export function validateAndBuildOrder(params: ValidateOrderParams): 
  { success: true; order: RestauOrder } | { success: false; error: string } {
  const { 
    cart, 
    catalog, 
    restaurantSlug, 
    orderMode, 
    tableNumber, 
    customerNote,
    allowedTables,
    idempotencyKey 
  } = params;

  if (!restaurantSlug || !restaurantSlug.trim()) {
    return { success: false, error: "Identifiant du restaurant requis." };
  }

  const cleanRestaurantSlug = restaurantSlug.trim();

  // 1. Validation du panier non vide
  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return { success: false, error: "Le panier est vide. Impossible de passer une commande." };
  }

  // 2. Validation du mode de commande et de la table
  let cleanTableNumber: string | null = null;
  if (orderMode === 'sur_place') {
    if (!tableNumber || !tableNumber.trim()) {
      return { 
        success: false, 
        error: "Le numéro de table est obligatoire pour une commande sur place." 
      };
    }
    cleanTableNumber = tableNumber.trim();

    // Vérification de la validité de la table si la liste des tables réelles est fournie
    if (allowedTables && Array.isArray(allowedTables) && allowedTables.length > 0) {
      const matchedTable = allowedTables.find(
        t => t.tableNumber.trim().toLowerCase() === cleanTableNumber!.toLowerCase()
      );

      if (!matchedTable) {
        return { 
          success: false, 
          error: `La table "${cleanTableNumber}" n'existe pas dans cet établissement.` 
        };
      }

      if (matchedTable.isActive === false) {
        return { 
          success: false, 
          error: `La table "${cleanTableNumber}" est actuellement fermée ou indisponible.` 
        };
      }
    }
  }

  // 3. Protection anti double-soumission / idempotence
  const now = Date.now();
  // Nettoyage des entrées périmées (> 15s)
  for (const [key, entry] of submissionCache.entries()) {
    if (now - entry.timestamp > 15000) {
      submissionCache.delete(key);
    }
  }

  // Signature du contenu de la commande
  const cartSignature = cart
    .map(c => `${c.menuItemId}:${c.quantity}:${c.selectedOption?.optionId || ''}:${(c.selectedExtras || []).map(e => e.extraId).sort().join(',')}`)
    .sort()
    .join('|');
  const submissionKey = idempotencyKey 
    ? `idem:${idempotencyKey}`
    : `sub:${cleanRestaurantSlug}:${orderMode}:${cleanTableNumber || 'none'}:${cartSignature}`;

  const existingSubmission = submissionCache.get(submissionKey);
  if (existingSubmission && (now - existingSubmission.timestamp < 10000)) {
    return { 
      success: false, 
      error: "Une commande identique est déjà en cours de traitement. Veuillez patienter." 
    };
  }

  // 4. Vérification et recalcul strict fondé sur le catalogue officiel
  const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
  const verifiedItems: RestauOrderItem[] = [];

  for (const line of cart) {
    const catalogItem = catalogMap.get(line.menuItemId);
    if (!catalogItem) {
      return { 
        success: false, 
        error: `Le plat "${line.name || line.menuItemId}" n'existe plus au catalogue.` 
      };
    }

    // Vérification de l'appartenance au même restaurant
    if (catalogItem.restaurantSlug && catalogItem.restaurantSlug !== cleanRestaurantSlug) {
      return {
        success: false,
        error: `Le plat "${catalogItem.name}" n'appartient pas au restaurant "${cleanRestaurantSlug}".`
      };
    }

    // Vérification de la disponibilité du plat
    if (catalogItem.available === false) {
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" est actuellement en rupture de stock.` 
      };
    }

    // Vérification de la quantité (doit être un entier positif entre 1 et 50)
    const rawQty = line.quantity;
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 50) {
      return {
        success: false,
        error: `La quantité pour le plat "${catalogItem.name}" doit être un nombre entier compris entre 1 et 50.`
      };
    }
    const qty = rawQty;

    // Vérification des groupes d'options (obligatoires et exclusifs)
    let verifiedSelectedOption: RestauOrderItem['selectedOption'] = undefined;
    let verifiedOptionExtraPrice = 0;

    if (catalogItem.optionGroups && catalogItem.optionGroups.length > 0) {
      // Trouver tous les groupes d'options obligatoires
      for (const group of catalogItem.optionGroups) {
        if (group.required) {
          const hasSelection = line.selectedOption && line.selectedOption.groupId === group.id;
          if (!hasSelection) {
            return {
              success: false,
              error: `Une option est obligatoire pour le groupe "${group.name}" du plat "${catalogItem.name}".`
            };
          }
        }
      }
    }

    if (line.selectedOption) {
      // Trouver le groupe dans le catalogue
      const catalogGroup = (catalogItem.optionGroups || []).find(g => g.id === line.selectedOption?.groupId);
      if (!catalogGroup) {
        return {
          success: false,
          error: `Le groupe d'options spécifié pour "${catalogItem.name}" n'existe pas.`
        };
      }

      // Trouver l'option dans le groupe du catalogue
      const catalogOption = catalogGroup.options.find(o => o.id === line.selectedOption?.optionId);
      if (!catalogOption) {
        return {
          success: false,
          error: `L'option sélectionnée pour "${catalogItem.name}" n'existe pas au catalogue.`
        };
      }

      // Utiliser impérativement le prix du catalogue, pas celui envoyé par le client !
      verifiedOptionExtraPrice = Math.max(0, Math.round(Number(catalogOption.extraPrice) || 0));

      verifiedSelectedOption = {
        groupId: catalogGroup.id,
        groupName: catalogGroup.name,
        optionId: catalogOption.id,
        optionName: catalogOption.name,
        extraPrice: verifiedOptionExtraPrice
      };
    }

    // Vérification des extras
    let verifiedExtrasCost = 0;
    const verifiedExtrasList: RestauOrderItem['selectedExtras'] = [];

    if (line.selectedExtras && line.selectedExtras.length > 0) {
      const availableExtras = catalogItem.availableExtras || [];
      const extrasMap = new Map(availableExtras.map(e => [e.id, e]));

      for (const extraSelection of line.selectedExtras) {
        const catalogExtra = extrasMap.get(extraSelection.extraId);
        if (!catalogExtra) {
          return {
            success: false,
            error: `L'extra "${extraSelection.name || extraSelection.extraId}" n'est pas disponible pour le plat "${catalogItem.name}".`
          };
        }

        // Utiliser impérativement le prix du catalogue officiel !
        const trustedExtraPrice = Math.max(0, Math.round(Number(catalogExtra.price) || 0));
        verifiedExtrasCost += trustedExtraPrice;

        verifiedExtrasList.push({
          extraId: catalogExtra.id,
          name: catalogExtra.name,
          price: trustedExtraPrice
        });
      }
    }

    const trustedBasePrice = Math.max(0, Math.round(Number(catalogItem.price) || 0));
    const trustedUnitPrice = trustedBasePrice + verifiedOptionExtraPrice + verifiedExtrasCost;
    const lineTotal = trustedUnitPrice * qty;

    if (params.rejectTamperedPrices === true) {
      if (line.unitPrice !== undefined && Math.round(Number(line.unitPrice)) !== trustedUnitPrice) {
        return {
          success: false,
          error: `Le prix unitaire du plat "${catalogItem.name}" est falsifié (attendu: ${trustedUnitPrice} FCFA, soumis: ${line.unitPrice} FCFA).`
        };
      }
    }

    verifiedItems.push({
      id: line.id || `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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

  const grandTotal = calculateOrderTotal(verifiedItems);

  // Vérification explicite contre la falsification du montant total
  if (params.declaredTotal !== undefined && Math.round(Number(params.declaredTotal)) !== grandTotal) {
    return {
      success: false,
      error: `Le montant total de la commande a été falsifié ou ne correspond pas au catalogue officiel (recalculé: ${grandTotal} FCFA, soumis: ${params.declaredTotal} FCFA).`
    };
  }

  const humanOrderNumber = `#CMD-${Math.floor(100 + Math.random() * 900)}`;
  const orderId = `ord-${now}-${Math.random().toString(36).substring(2, 8)}`;

  const order: RestauOrder = {
    id: orderId,
    orderNumber: humanOrderNumber,
    restaurantSlug: cleanRestaurantSlug,
    orderMode,
    tableNumber: orderMode === 'sur_place' ? cleanTableNumber : null,
    items: verifiedItems,
    itemsCount: verifiedItems.reduce((acc, item) => acc + item.quantity, 0),
    totalAmount: grandTotal,
    currency: 'FCFA',
    status: 'pending',
    customerNote: sanitizeNote(customerNote, 150),
    createdAt: now,
    createdAtIso: new Date(now).toISOString(),
    idempotencyKey
  };

  // Enregistrer dans le cache d'idempotence
  submissionCache.set(submissionKey, {
    timestamp: now,
    order,
    signature: cartSignature
  });

  return { success: true, order };
}

/**
 * Génère l'URL canonique pour le QR code d'une table
 */
export function generateTableQrUrl(
  origin: string, 
  restaurantSlug: string, 
  tableNumber: string
): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent(restaurantSlug.trim());
  const cleanTable = encodeURIComponent(tableNumber.trim());
  return `${cleanOrigin}/r/${cleanSlug}?table=${cleanTable}`;
}

/**
 * Liste des schémas interdits pour prévenir toute tentative d'injection ou d'attaque XSS
 */
const FORBIDDEN_SCHEMES = [
  'javascript:', 
  'data:', 
  'file:', 
  'vbscript:', 
  'blob:', 
  'about:', 
  'chrome:', 
  'ws:', 
  'wss:'
];

export interface QrParseOptions {
  allowedOrigins?: string[];
  defaultSlug?: string;
}

/**
 * Analyse et valide une URL ou chaîne scannée de façon strictement sécurisée
 * Rejette les domaines tiers, schémas suspects, identifiants dans l'URL et routes non autorisées.
 */
export function parseAndValidateQrInput(
  rawInput: string,
  defaultSlugOrOptions: string | QrParseOptions = 'chez-awa',
  optionsParam?: QrParseOptions
): {
  isValid: boolean;
  restaurantSlug: string;
  tableNumber: string | null;
  canonicalPath: string;
  error?: string;
} {
  let defaultSlug = 'chez-awa';
  let allowedOrigins: string[] = [];

  if (typeof defaultSlugOrOptions === 'string') {
    defaultSlug = defaultSlugOrOptions || 'chez-awa';
    if (optionsParam?.allowedOrigins) {
      allowedOrigins = optionsParam.allowedOrigins;
    }
  } else if (defaultSlugOrOptions && typeof defaultSlugOrOptions === 'object') {
    defaultSlug = defaultSlugOrOptions.defaultSlug || 'chez-awa';
    if (defaultSlugOrOptions.allowedOrigins) {
      allowedOrigins = defaultSlugOrOptions.allowedOrigins;
    }
  }

  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      isValid: false,
      restaurantSlug: defaultSlug,
      tableNumber: null,
      canonicalPath: `/r/${defaultSlug}`,
      error: 'Entrée QR vide.'
    };
  }

  // 1. Rejet immédiat des schémas malveillants ou non autorisés
  const lowerInput = trimmed.toLowerCase();
  for (const scheme of FORBIDDEN_SCHEMES) {
    if (lowerInput.startsWith(scheme)) {
      return {
        isValid: false,
        restaurantSlug: defaultSlug,
        tableNumber: null,
        canonicalPath: `/r/${defaultSlug}`,
        error: `Protocole non autorisé : "${scheme}". Seules les URL web sécurisées RestauMax sont admises.`
      };
    }
  }

  // 2. Si l'entrée est uniquement un numéro ou nom de table (ex: "4", "12", "Terrasse A")
  if (/^[a-zA-Z0-9\s\-]+$/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes('?') && !trimmed.includes('&') && !trimmed.includes(':')) {
    const tableClean = trimmed.replace(/\s+/g, ' ').trim();
    if (tableClean.length > 20) {
      return {
        isValid: false,
        restaurantSlug: defaultSlug,
        tableNumber: null,
        canonicalPath: `/r/${defaultSlug}`,
        error: 'Identifiant de table trop long (maximum 20 caractères).'
      };
    }
    return {
      isValid: true,
      restaurantSlug: defaultSlug,
      tableNumber: tableClean,
      canonicalPath: `/r/${defaultSlug}?table=${encodeURIComponent(tableClean)}`
    };
  }

  // 3. Décodage d'URL relative ou absolue
  try {
    let urlObj: URL;
    const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);

    if (isAbsolute) {
      urlObj = new URL(trimmed);

      // Vérifier le protocole : uniquement http: ou https:
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return {
          isValid: false,
          restaurantSlug: defaultSlug,
          tableNumber: null,
          canonicalPath: `/r/${defaultSlug}`,
          error: `Protocole "${urlObj.protocol}" non autorisé.`
        };
      }

      // Rejeter les URL contenant des identifiants (ex: https://user:pass@example.com)
      if (urlObj.username || urlObj.password) {
        return {
          isValid: false,
          restaurantSlug: defaultSlug,
          tableNumber: null,
          canonicalPath: `/r/${defaultSlug}`,
          error: "Identifiants d'authentification interdits dans l'URL du QR code."
        };
      }

      // Validation de l'origine (domaine)
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const allowed = new Set<string>([
        currentOrigin,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'https://restaumax.app',
        ...allowedOrigins
      ].filter(Boolean));

      // Si des domaines autorisés sont configurés et que l'origine du QR n'est pas dedans
      if (allowed.size > 0 && !allowed.has(urlObj.origin)) {
        return {
          isValid: false,
          restaurantSlug: defaultSlug,
          tableNumber: null,
          canonicalPath: `/r/${defaultSlug}`,
          error: `Domaine tiers non autorisé ("${urlObj.origin}"). Seul le domaine officiel RestauMax est accepté.`
        };
      }
    } else {
      // URL relative
      if (!trimmed.startsWith('/')) {
        return {
          isValid: false,
          restaurantSlug: defaultSlug,
          tableNumber: null,
          canonicalPath: `/r/${defaultSlug}`,
          error: 'Format de chemin non reconnu.'
        };
      }
      urlObj = new URL(trimmed, 'http://localhost');
    }

    const pathname = urlObj.pathname || '/';

    // 4. Validation stricte du chemin d'accès : doit correspondre exactement à /r/:slug
    const routeRegex = /^\/r\/([a-zA-Z0-9_-]+)\/?$/;
    const match = pathname.match(routeRegex);

    if (!match) {
      return {
        isValid: false,
        restaurantSlug: defaultSlug,
        tableNumber: null,
        canonicalPath: `/r/${defaultSlug}`,
        error: `Chemin non valide ("${pathname}"). Le QR code doit pointer vers un menu de restaurant (/r/:slug).`
      };
    }

    const detectedSlug = match[1];

    // 5. Récupération et validation stricte du paramètre de table
    const rawTableParam = urlObj.searchParams.get('table');
    let tableNumber: string | null = null;

    if (rawTableParam !== null) {
      const cleaned = decodeURIComponent(rawTableParam).replace(/\s+/g, ' ').trim();
      if (cleaned.length === 0) {
        // Paramètre table vide
        tableNumber = null;
      } else if (cleaned.length > 20) {
        return {
          isValid: false,
          restaurantSlug: detectedSlug,
          tableNumber: null,
          canonicalPath: `/r/${detectedSlug}`,
          error: 'Numéro de table trop long (maximum 20 caractères).'
        };
      } else if (!/^[a-zA-Z0-9\s\-]+$/.test(cleaned)) {
        return {
          isValid: false,
          restaurantSlug: detectedSlug,
          tableNumber: null,
          canonicalPath: `/r/${detectedSlug}`,
          error: 'Numéro de table contenant des caractères non autorisés.'
        };
      } else {
        tableNumber = cleaned;
      }
    }

    const canonicalPath = tableNumber 
      ? `/r/${encodeURIComponent(detectedSlug)}?table=${encodeURIComponent(tableNumber)}`
      : `/r/${encodeURIComponent(detectedSlug)}`;

    return {
      isValid: true,
      restaurantSlug: detectedSlug,
      tableNumber,
      canonicalPath
    };
  } catch {
    return {
      isValid: false,
      restaurantSlug: defaultSlug,
      tableNumber: null,
      canonicalPath: `/r/${defaultSlug}`,
      error: 'Format d’URL ou de QR code non reconnu.'
    };
  }
}
