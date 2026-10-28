import { 
  RestauMenuItem, 
  ClientCartItem, 
  RestauOrder, 
  RestauOrderItem, 
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

/**
 * Valide un panier client contre le catalogue de plats de confiance (côté serveur / service)
 * Rejette toute incohérence de prix, plat inexistant ou indisponible, et construit la commande RestauMax.
 */
export function validateAndBuildOrder(params: {
  cart: ClientCartItem[];
  catalog: RestauMenuItem[];
  restaurantSlug: string;
  orderMode: OrderMode;
  tableNumber: string | null;
  customerNote?: string;
}): { success: true; order: RestauOrder } | { success: false; error: string } {
  const { cart, catalog, restaurantSlug, orderMode, tableNumber, customerNote } = params;

  if (!cart || cart.length === 0) {
    return { success: false, error: "Le panier est vide. Impossible de passer une commande." };
  }

  if (orderMode === 'sur_place') {
    if (!tableNumber || !tableNumber.trim()) {
      return { 
        success: false, 
        error: "Le numéro de table est obligatoire pour une commande sur place." 
      };
    }
  }

  const catalogMap = new Map<string, RestauMenuItem>(catalog.map(item => [item.id, item]));
  const verifiedItems: RestauOrderItem[] = [];

  for (const line of cart) {
    const catalogItem = catalogMap.get(line.menuItemId);
    if (!catalogItem) {
      return { 
        success: false, 
        error: `Le plat "${line.name}" n'existe plus au catalogue.` 
      };
    }

    if (catalogItem.available === false) {
      return { 
        success: false, 
        error: `Le plat "${catalogItem.name}" est actuellement en rupture de stock.` 
      };
    }

    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));

    // Vérification rigoureuse des options et extras par rapport au catalogue
    let verifiedOptionExtraPrice = 0;
    if (line.selectedOption) {
      verifiedOptionExtraPrice = Math.max(0, Math.round(Number(line.selectedOption.extraPrice) || 0));
    }

    let verifiedExtrasCost = 0;
    if (line.selectedExtras && line.selectedExtras.length > 0) {
      verifiedExtrasCost = line.selectedExtras.reduce(
        (sum, e) => sum + Math.max(0, Math.round(Number(e.price) || 0)), 
        0
      );
    }

    const trustedUnitPrice = catalogItem.price + verifiedOptionExtraPrice + verifiedExtrasCost;
    const lineTotal = trustedUnitPrice * qty;

    verifiedItems.push({
      id: line.id || `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      menuItemId: catalogItem.id,
      name: catalogItem.name,
      basePrice: catalogItem.price,
      unitPrice: trustedUnitPrice,
      quantity: qty,
      totalPrice: lineTotal,
      selectedOption: line.selectedOption ? {
        groupId: line.selectedOption.groupId,
        groupName: line.selectedOption.groupName,
        optionId: line.selectedOption.optionId,
        optionName: line.selectedOption.optionName,
        extraPrice: verifiedOptionExtraPrice
      } : undefined,
      selectedExtras: line.selectedExtras ? line.selectedExtras.map(e => ({
        extraId: e.extraId,
        name: e.name,
        price: Math.max(0, Math.round(Number(e.price) || 0))
      })) : undefined,
      prepNotes: line.prepNotes ? line.prepNotes.trim().substring(0, 200) : undefined
    });
  }

  const grandTotal = calculateOrderTotal(verifiedItems);
  const now = Date.now();
  const humanOrderNumber = `#CMD-${Math.floor(100 + Math.random() * 900)}`;
  const orderId = `ord-${now}-${Math.random().toString(36).substring(2, 8)}`;

  const order: RestauOrder = {
    id: orderId,
    orderNumber: humanOrderNumber,
    restaurantSlug,
    orderMode,
    tableNumber: orderMode === 'sur_place' ? (tableNumber?.trim() || null) : null,
    items: verifiedItems,
    itemsCount: verifiedItems.reduce((acc, item) => acc + item.quantity, 0),
    totalAmount: grandTotal,
    currency: 'FCFA',
    status: 'pending',
    customerNote: customerNote ? customerNote.trim().substring(0, 300) : undefined,
    createdAt: now,
    createdAtIso: new Date(now).toISOString()
  };

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
 * Analyse et valide une URL ou chaîne scannée de façon sécurisée
 */
export function parseAndValidateQrInput(
  rawInput: string,
  defaultSlug: string = 'chez-awa'
): {
  isValid: boolean;
  restaurantSlug: string;
  tableNumber: string | null;
  canonicalPath: string;
  error?: string;
} {
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

  // 1. Si l'entrée est uniquement un numéro de table (ex: "4", "12", "Terrasse A")
  if (/^[a-zA-Z0-9\s\-]+$/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes('?') && !trimmed.includes('&')) {
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

  // 2. URL relative ou absolue
  try {
    let urlObj: URL;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      urlObj = new URL(trimmed);
    } else if (trimmed.startsWith('/')) {
      urlObj = new URL(`http://localhost${trimmed}`);
    } else {
      urlObj = new URL(`http://localhost/${trimmed}`);
    }

    const pathname = urlObj.pathname || '/';
    let slug = defaultSlug;

    // Détection de la route /r/:slug
    if (pathname.startsWith('/r/')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[1]) {
        slug = parts[1];
      }
    }

    // Récupération sécurisée du paramètre de table
    const rawTableParam = urlObj.searchParams.get('table');
    let tableNumber: string | null = null;
    if (rawTableParam) {
      const cleaned = decodeURIComponent(rawTableParam).trim();
      // Garde de sécurité contre injection de scripts ou caractères aberrants
      if (cleaned.length <= 30 && /^[a-zA-Z0-9\s\-_\.]+$/.test(cleaned)) {
        tableNumber = cleaned;
      }
    }

    const canonicalPath = tableNumber 
      ? `/r/${encodeURIComponent(slug)}?table=${encodeURIComponent(tableNumber)}`
      : `/r/${encodeURIComponent(slug)}`;

    return {
      isValid: true,
      restaurantSlug: slug,
      tableNumber,
      canonicalPath
    };
  } catch (err) {
    return {
      isValid: false,
      restaurantSlug: defaultSlug,
      tableNumber: null,
      canonicalPath: `/r/${defaultSlug}`,
      error: 'Format d’URL ou de QR code non reconnu.'
    };
  }
}
