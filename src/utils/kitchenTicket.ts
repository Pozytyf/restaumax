import type { KitchenTicket, TicketStatus } from '../types/pos';
import type { RestauOrder } from '../types/restaumax';

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
        course: 'plat',
        notes: notes.join(' · '),
        completed: order.kitchenItemCompletion?.[String(index)] === true
      };
    })
  };
}
