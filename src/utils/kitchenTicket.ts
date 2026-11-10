import type { KitchenItem, KitchenTicket, TicketStatus } from '../types/pos';
import type { RestauOrder } from '../types/restaumax';

export type KitchenStation = 'grillades' | 'plats' | 'bar';
export function getKitchenStationFromCategory(category?: string): KitchenStation {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'grillades') return 'grillades';
  if (normalized === 'boissons') return 'bar';
  return 'plats';
}
export function getKitchenCourseFromCategory(category?: string): KitchenItem['course'] {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'entrees') return 'entree';
  if (normalized === 'desserts') return 'dessert';
  if (normalized === 'boissons') return 'boisson';
  return 'plat';
}
export function filterKitchenTicketItems(items: KitchenItem[], station: 'all' | KitchenStation): KitchenItem[] {
  return station === 'all' ? items : items.filter(item => (item.station || 'plats') === station);
}

/** Projection déterministe d'une commande persistée vers le ticket cuisine. */
export function mapRestauOrderToKitchenTicket(order: RestauOrder): KitchenTicket {
  let ticketStatus: TicketStatus = 'in_prep';
  if (order.status === 'ready') ticketStatus = 'ready';
  else if (order.status === 'completed') ticketStatus = 'served';
  else if (order.status === 'cancelled') ticketStatus = 'cancelled';

  return {
    id: `ord-${order.id}`,
    ticketNumber: order.orderNumber,
    tableNumber: order.tableNumber ? `Table ${order.tableNumber}` : 'À emporter',
    orderType: order.orderMode === 'sur_place' ? 'sur_place' : 'emporter',
    waiter: order.customerNote?.startsWith('Commande saisie au comptoir par ') ? 'Personnel POS' : 'QR Menu Client',
    createdAt: new Date(order.createdAt),
    status: ticketStatus,
    stockTrackingStatus: order.stockTrackingStatus,
    stockUntrackedItemIds: order.stockUntrackedItemIds,
    items: order.items.map((item, index) => {
      const notes: string[] = [];
      if (item.selectedOption?.optionName) notes.push(`Options : ${item.selectedOption.optionName}`);
      if (item.selectedExtras?.length) {
        notes.push(`Suppléments : ${item.selectedExtras.map(extra => extra.name).join(', ')}`);
      }
      if (item.prepNotes) notes.push(`Note : ${item.prepNotes}`);
      return {
        id: `ki-${order.id}-${index}`,
        name: item.name,
        quantity: item.quantity,
        course: getKitchenCourseFromCategory(item.category),
        station: getKitchenStationFromCategory(item.category),
        notes: notes.join(' · '),
        completed: order.kitchenItemCompletion?.[String(index)] === true
      };
    })
  };
}
