import type { CartItem } from '../types/pos';
import type { ClientCartItem } from '../types/restaumax';

/** Prix indicatif POS ; le serveur recalcule toujours le prix de confiance depuis Firestore. */
export function getPosCartLineUnitPrice(item: Pick<CartItem, 'menuItem' | 'selectedOption' | 'selectedExtras'>): number {
  return item.menuItem.price +
    (item.selectedOption?.extraPrice || 0) +
    (item.selectedExtras || []).reduce((sum, extra) => sum + extra.price, 0);
}

/** Signature stable des choix, indépendante de l'ordre dans lequel le personnel clique les groupes. */
export function getPosCartConfigurationKey(
  option?: CartItem['selectedOption'],
  extras: NonNullable<CartItem['selectedExtras']> = []
): string {
  const groupIds = option?.groupId ? option.groupId.split('+') : [];
  const optionIds = option?.optionId ? option.optionId.split('+') : [];
  const optionPairs = groupIds
    .map((groupId, index) => [groupId, optionIds[index] || ''])
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    options: optionPairs,
    extras: extras.map((extra) => extra.extraId).sort()
  });
}

/** Contrat commun aux deux sorties POS : cuisine et encaissement direct. */
export function toClientCartItem(item: CartItem): ClientCartItem {
  const prepNotes = (item.specialInstructions || '').trim().slice(0, 150);
  return {
    id: item.id,
    menuItemId: item.menuItem.id,
    name: item.menuItem.name,
    basePrice: item.menuItem.price,
    unitPrice: getPosCartLineUnitPrice(item),
    quantity: item.quantity,
    ...(item.selectedOption ? { selectedOption: item.selectedOption } : {}),
    selectedExtras: item.selectedExtras || [],
    ...(prepNotes ? { prepNotes } : {}),
    imageUrl: item.menuItem.imageUrl
  };
}
