import crypto from 'node:crypto';

export interface CashPaymentInput {
  restaurantSlug: string;
  orderId: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  amountTendered: number;
  idempotencyKey: string;
}

export interface CashPaymentResult {
  success: boolean;
  conflict?: boolean;
  idempotentReplay?: boolean;
  error?: string;
  payment?: Record<string, any>;
  order?: Record<string, any>;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Enregistre un encaissement espèces dans une transaction Firestore atomique.
 * Les permissions, la session du personnel, le solde et l'idempotence sont
 * revalidés dans la même transaction que l'écriture du paiement.
 */
export async function recordCashPaymentWithDb(db: any, input: CashPaymentInput): Promise<CashPaymentResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };

  const slug = String(input.restaurantSlug || '').trim();
  const orderId = String(input.orderId || '').trim();
  const actorUid = String(input.actorUid || '').trim();
  const key = String(input.idempotencyKey || '').trim();
  const amountTendered = input.amountTendered;

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId) ||
      !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !Number.isSafeInteger(amountTendered) || amountTendered <= 0 || amountTendered > 100_000_000) {
    return { success: false, error: 'Paramètres de paiement invalides.' };
  }

  const namespace = `${slug}::${orderId}::${key}`;
  const paymentId = `pay_${sha256(namespace).slice(0, 32)}`;
  const signature = sha256(JSON.stringify({ restaurantSlug: slug, orderId, amountTendered, method: 'especes' }));
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const orderRef = restaurantRef.collection('orders').doc(orderId);
  const paymentRef = restaurantRef.collection('payments').doc(paymentId);
  const idempotencyRef = db.collection('payment_idempotency').doc(`cash_${sha256(namespace).slice(0, 40)}`);

  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, orderSnap, idempotencySnap, paymentSnap] = await Promise.all([
      tx.get(restaurantRef),
      tx.get(memberRef),
      tx.get(orderRef),
      tx.get(idempotencyRef),
      tx.get(paymentRef)
    ]);

    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    const order = orderSnap.exists ? orderSnap.data() : null;

    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(input.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { success: false, error: 'Compte inactif, session révoquée ou accès au restaurant refusé.' };
    }

    const isOwner = member.role === 'owner' && restaurant.ownerUid === actorUid;
    const canManageCash = isOwner ||
      member.role === 'manager' ||
      (member.role === 'cashier' && Array.isArray(member.permissions) && member.permissions.includes('cash.manage'));
    if (!canManageCash) {
      return { success: false, error: 'Votre rôle ne permet pas d’encaisser des paiements en espèces.' };
    }

    if (idempotencySnap.exists) {
      const previous = idempotencySnap.data();
      if (previous.signature !== signature || previous.orderId !== orderId || previous.actorUid !== actorUid) {
        return { success: false, conflict: true, error: 'Clé de paiement déjà utilisée pour une opération différente.' };
      }
      if (!paymentSnap.exists || !order) {
        return { success: false, conflict: true, error: 'Registre de paiement incomplet. Encaissement bloqué par sécurité.' };
      }
      return {
        success: true,
        idempotentReplay: true,
        payment: paymentSnap.data(),
        order
      };
    }

    if (!order || order.restaurantSlug !== slug || order.status === 'cancelled') {
      return { success: false, error: 'Commande introuvable, annulée ou rattachée à un autre restaurant.' };
    }

    const totalAmount = Number(order.totalAmount);
    const alreadyPaid = Number(order.paidAmount || 0);
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 ||
        !Number.isSafeInteger(alreadyPaid) || alreadyPaid < 0 || alreadyPaid > totalAmount) {
      return { success: false, error: 'Montant de commande incohérent. Encaissement refusé.' };
    }

    const remainingBefore = totalAmount - alreadyPaid;
    if (remainingBefore <= 0) {
      return { success: false, error: 'Cette commande est déjà intégralement réglée.' };
    }

    const acceptedAmount = Math.min(amountTendered, remainingBefore);
    const changeAmount = Math.max(0, amountTendered - remainingBefore);
    const paidAmount = alreadyPaid + acceptedAmount;
    const remainingAmount = totalAmount - paidAmount;
    const paymentStatus = remainingAmount === 0 ? 'paid' : 'partial';
    const now = Date.now();

    const payment = {
      id: paymentId,
      restaurantSlug: slug,
      orderId,
      orderNumber: order.orderNumber || orderId,
      tableNumber: order.tableNumber || null,
      actorUid,
      actorName: String(input.actorName || actorUid),
      actorRole: member.role,
      method: 'especes',
      currency: order.currency || 'FCFA',
      amountTendered,
      paidAmount: acceptedAmount,
      changeAmount,
      totalAmount,
      previouslyPaidAmount: alreadyPaid,
      remainingBefore,
      remainingAfter: remainingAmount,
      paymentStatus,
      items: Array.isArray(order.items) ? order.items : [],
      createdAt: now
    };

    const updatedOrder = {
      ...order,
      paidAmount,
      remainingAmount,
      paymentStatus,
      lastPaymentAt: now,
      lastPaymentId: paymentId
    };

    tx.create(paymentRef, payment);
    tx.create(idempotencyRef, {
      signature,
      restaurantSlug: slug,
      orderId,
      actorUid,
      paymentId,
      createdAt: now
    });
    tx.update(orderRef, {
      paidAmount,
      remainingAmount,
      paymentStatus,
      lastPaymentAt: now,
      lastPaymentId: paymentId
    });

    return { success: true, payment, order: updatedOrder, idempotentReplay: false };
  });
}

export async function listRecentCashPaymentsWithDb(db: any, restaurantSlug: string, limit = 100): Promise<Record<string, any>[]> {
  if (!db) throw new Error('Firestore indisponible.');
  const slug = String(restaurantSlug || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) throw new Error('Restaurant invalide.');
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const snapshot = await db.collection('restaurants').doc(slug)
    .collection('payments').orderBy('createdAt', 'desc').limit(safeLimit).get();
  return snapshot.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));
}
