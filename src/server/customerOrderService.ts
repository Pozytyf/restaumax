import { createHash, timingSafeEqual } from 'node:crypto';
import { calculateOrderTax, sanitizeNote } from '../utils/pricing.ts';

const validSlug = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const tokenMatches = (storedHash: unknown, token: string) => {
  const expected = String(storedHash || '');
  const actual = createHash('sha256').update(token).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export interface CustomerOrderMutation {
  restaurantSlug: string;
  orderId: string;
  accessToken: string;
  action: 'get' | 'cancel' | 'edit';
  reason?: string;
  items?: Array<{ id: string; quantity: number; prepNotes?: string }>;
  customerNote?: string;
}

/**
 * Public customer mutation is capability-based: a high-entropy, per-order token
 * is stored only as a SHA-256 digest. It can change/cancel only unpaid pending
 * orders; all financial/catalogue fields remain server-owned.
 */
export async function mutateCustomerOrderWithDb(db: any, input: CustomerOrderMutation) {
  const { restaurantSlug, orderId, accessToken, action } = input;
  if (!db || !validSlug(restaurantSlug) || !validId(orderId) ||
      typeof accessToken !== 'string' || accessToken.length < 32 ||
      !['get', 'cancel', 'edit'].includes(action)) {
    return { success: false, error: 'Demande de modification invalide.' };
  }
  const restaurantRef = db.collection('restaurants').doc(restaurantSlug);
  const orderRef = restaurantRef.collection('orders').doc(orderId);
  const auditRef = restaurantRef.collection('orderAudit').doc();
  try {
    return await db.runTransaction(async (tx: any) => {
      const [restaurantSnap, orderSnap] = await Promise.all([tx.get(restaurantRef), tx.get(orderRef)]);
      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const order = orderSnap.exists ? orderSnap.data() : null;
      if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false) {
        return { success: false, error: 'Restaurant indisponible.' };
      }
      if (!order || order.id !== orderId || order.restaurantSlug !== restaurantSlug ||
          !tokenMatches(order.customerAccessTokenHash, accessToken)) {
        return { success: false, error: 'Accès à cette commande refusé. Vérifiez votre lien de suivi.' };
      }
      if (action === 'get') {
        const safeOrder = {
          id: order.id, orderNumber: order.orderNumber, restaurantSlug,
          orderMode: order.orderMode, tableNumber: order.tableNumber ?? null,
          items: (Array.isArray(order.items) ? order.items : []).map((item: any) => ({
            id: item.id, menuItemId: item.menuItemId, name: item.name, category: item.category,
            basePrice: item.basePrice, unitPrice: item.unitPrice, quantity: item.quantity,
            totalPrice: item.totalPrice, selectedOption: item.selectedOption,
            selectedExtras: item.selectedExtras, prepNotes: item.prepNotes
          })),
          itemsCount: order.itemsCount, totalAmount: order.totalAmount,
          subtotalAmount: order.subtotalAmount, taxAmount: order.taxAmount,
          taxRatePercent: order.taxRatePercent, taxMode: order.taxMode,
          paidAmount: order.paidAmount || 0, refundedAmount: order.refundedAmount || 0,
          remainingAmount: order.remainingAmount ?? Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || 0)),
          paymentStatus: order.paymentStatus || 'unpaid', paymentPreference: order.paymentPreference,
          currency: order.currency || 'FCFA', status: order.status,
          customerNote: order.customerNote, createdAt: order.createdAt,
          createdAtIso: order.createdAtIso, statusUpdatedAt: order.statusUpdatedAt,
          cancellationReason: order.cancellationReason,
          statusHistory: (Array.isArray(order.statusHistory) && order.statusHistory.length
            ? order.statusHistory : [{ status: 'pending', changedAt: Number(order.createdAt || 0) }])
            .slice(-50).map((event: any) => ({ status: String(event.status || ''), changedAt: Number(event.changedAt || 0), reason: event.status === 'cancelled' ? String(event.reason || order.cancellationReason || '') : undefined }))
        };
        return { success: true, status: order.status, order: safeOrder };
      }
      if (order.status !== 'pending') {
        return { success: false, error: 'Cette commande n’est plus modifiable : sa préparation a commencé ou elle est déjà clôturée.' };
      }
      if (Number(order.paidAmount || 0) > 0 || Number(order.refundedAmount || 0) > 0 || ['partial', 'paid'].includes(String(order.paymentStatus || ''))) {
        return { success: false, error: 'Une commande déjà réglée ne peut pas être modifiée ou annulée depuis le suivi client. Contactez le personnel.' };
      }
      if (action === 'cancel') {
        const reason = String(input.reason || '').trim().slice(0, 300);
        if (reason.length < 3) return { success: false, error: 'Un motif d’annulation d’au moins 3 caractères est obligatoire.' };
        const now = Date.now();
        tx.update(orderRef, {
          status: 'cancelled', statusUpdatedAt: now, cancelledAt: now,
          cancellationReason: reason, cancelledBy: 'customer',
          customerCancellation: true,
          statusHistory: [...(Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: 'pending', changedAt: Number(order.createdAt || 0) }]), { status: 'cancelled', changedAt: now, actorRole: 'customer', reason }].slice(-50)
        });
        tx.create(auditRef, {
          event: 'order.cancelled', orderId, orderNumber: String(order.orderNumber || orderId),
          restaurantSlug, previousStatus: 'pending', status: 'cancelled',
          reason, actorUid: 'customer', actorRole: 'customer', createdAt: now,
          stockRestored: false
        });
        return { success: true, status: 'cancelled' };
      }

      const currentItems = Array.isArray(order.items) ? order.items : [];
      if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > currentItems.length) {
        return { success: false, error: 'La commande doit conserver au moins un article déjà commandé.' };
      }
      const currentById = new Map(currentItems.map((item: any) => [String(item.id), item]));
      const seen = new Set<string>();
      const updatedItems: any[] = [];
      for (const change of input.items) {
        const id = String(change?.id || '');
        const original: any = currentById.get(id);
        const quantity = Number(change?.quantity);
        if (!original || seen.has(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
          return { success: false, error: 'Une ligne ou une quantité est invalide.' };
        }
        seen.add(id);
        const prepNotes = sanitizeNote(change.prepNotes, 150);
        updatedItems.push({ ...original, quantity, totalPrice: Number(original.unitPrice) * quantity,
          ...(prepNotes ? { prepNotes } : { prepNotes: null }) });
      }
      const trackedItems = updatedItems.filter(item => item.trackStock === true);
      const trackedSnapshots = await Promise.all(trackedItems.map(item =>
        tx.get(restaurantRef.collection('menuItems').doc(String(item.menuItemId)))
      ));
      for (let index = 0; index < trackedItems.length; index += 1) {
        const item: any = trackedItems[index];
        const snapshot = trackedSnapshots[index];
        const catalogueItem = snapshot.exists ? snapshot.data() : null;
        if (!catalogueItem || catalogueItem.restaurantSlug !== restaurantSlug ||
            catalogueItem.trackStock !== true || catalogueItem.available === false ||
            !Number.isInteger(catalogueItem.stockQuantity) || item.quantity > Number(catalogueItem.stockQuantity)) {
          return { success: false, error: `Stock insuffisant ou article indisponible pour « ${item.name} ». Réduisez la quantité ou contactez le restaurant.` };
        }
      }
      const subtotalAmount = updatedItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
      const tax = calculateOrderTax(subtotalAmount, Number(order.taxRatePercent || 0), order.taxMode === 'inclusive' ? 'inclusive' : 'exclusive');
      const now = Date.now();
      const customerNote = sanitizeNote(input.customerNote, 150);
      tx.update(orderRef, {
        items: updatedItems, itemsCount: updatedItems.reduce((sum, item) => sum + Number(item.quantity), 0),
        subtotalAmount: tax.subtotalAmount, taxAmount: tax.taxAmount, totalAmount: tax.totalAmount,
        remainingAmount: tax.totalAmount, paidAmount: 0, refundedAmount: 0, netPaidAmount: 0, paymentStatus: 'unpaid',
        ...(customerNote ? { customerNote } : {}),
        customerEditedAt: now, customerEditCount: Number(order.customerEditCount || 0) + 1,
        statusUpdatedAt: now
      });
      tx.create(auditRef, {
        event: 'order.edited', orderId, orderNumber: String(order.orderNumber || orderId),
        restaurantSlug, previousStatus: 'pending', status: 'pending',
        actorUid: 'customer', actorRole: 'customer', createdAt: now,
        previousItems: currentItems.map((item: any) => ({ id: item.id, quantity: item.quantity })),
        updatedItems: updatedItems.map((item: any) => ({ id: item.id, quantity: item.quantity }))
      });
      return { success: true, status: 'pending', subtotalAmount: tax.subtotalAmount, taxAmount: tax.taxAmount, totalAmount: tax.totalAmount, itemsCount: updatedItems.reduce((sum, item) => sum + Number(item.quantity), 0) };
    });
  } catch (error: any) {
    console.error('[RestauMax customer order mutation] Failed:', error?.message || String(error));
    return { success: false, error: 'Impossible de mettre à jour la commande. Réessayez.' };
  }
}
