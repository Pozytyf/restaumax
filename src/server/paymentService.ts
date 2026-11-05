import crypto from 'node:crypto';

export interface CashPaymentInput {
  restaurantSlug: string;
  orderId: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  amountTendered: number;
  splitGuests?: number;
  guestNumber?: number;
  guestName?: string;
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

export interface CashSessionInput {
  restaurantSlug: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  openingBalance?: number;
  closingCount?: number;
  idempotencyKey: string;
}

export interface CashSessionResult {
  success: boolean;
  conflict?: boolean;
  idempotentReplay?: boolean;
  error?: string;
  session?: Record<string, any> | null;
}

export interface CashMovementInput {
  restaurantSlug: string;
  actorUid: string;
  actorName?: string;
  sessionVersion: number;
  movementType: 'expense' | 'withdrawal';
  amount: number;
  category: string;
  note?: string;
  idempotencyKey: string;
}

export interface CashMovementResult {
  success: boolean;
  conflict?: boolean;
  idempotentReplay?: boolean;
  error?: string;
  movement?: Record<string, any>;
  session?: Record<string, any>;
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
  const splitGuests = Number(input.splitGuests ?? 1);
  const guestNumber = Number(input.guestNumber ?? 1);
  const guestName = String(input.guestName || '').trim();

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId) ||
      !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !Number.isSafeInteger(amountTendered) || amountTendered <= 0 || amountTendered > 100_000_000 ||
      !Number.isSafeInteger(splitGuests) || splitGuests < 1 || splitGuests > 20 ||
      !Number.isSafeInteger(guestNumber) || guestNumber < 1 || guestNumber > splitGuests ||
      guestName.length > 80) {
    return { success: false, error: 'Paramètres de paiement ou de répartition par convive invalides.' };
  }

  const namespace = `${slug}::${orderId}::${key}`;
  const paymentId = `pay_${sha256(namespace).slice(0, 32)}`;
  const signature = sha256(JSON.stringify({
    restaurantSlug: slug, orderId, amountTendered, method: 'especes',
    splitGuests, guestNumber, guestName
  }));
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

    const activeSessionRef = restaurantRef.collection('cashSessionActive').doc(actorUid);
    const activeSessionSnap = await tx.get(activeSessionRef);
    const activeSessionId = activeSessionSnap.exists ? String(activeSessionSnap.data()?.sessionId || '') : '';
    if (!activeSessionId || activeSessionSnap.data()?.status !== 'active') {
      return { success: false, error: 'Ouvrez une session de caisse avant tout encaissement.' };
    }
    const cashSessionRef = restaurantRef.collection('cashSessions').doc(activeSessionId);
    const cashSessionSnap = await tx.get(cashSessionRef);
    const cashSession = cashSessionSnap.exists ? cashSessionSnap.data() : null;
    if (!cashSession || cashSession.status !== 'active' || cashSession.openedByUid !== actorUid ||
        Number(cashSession.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { success: false, error: 'La session de caisse est invalide, clôturée ou rattachée à une autre session du personnel.' };
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
    if (splitGuests > totalAmount) {
      return { success: false, error: 'Le nombre de convives dépasse le nombre de parts FCFA disponibles.' };
    }
    if (order.splitGuests !== undefined && Number(order.splitGuests) !== splitGuests) {
      return { success: false, conflict: true, error: 'Le nombre de convives ne peut plus être modifié après le premier encaissement.' };
    }

    let guestAccounts: Array<Record<string, any>>;
    if (Array.isArray(order.guestAccounts)) {
      guestAccounts = order.guestAccounts.map((account: any) => ({ ...account }));
      if (guestAccounts.length !== splitGuests ||
          guestAccounts.reduce((sum, account) => sum + Number(account.paidAmount || 0), 0) !== alreadyPaid ||
          guestAccounts.reduce((sum, account) => sum + Number(account.shareAmount || 0), 0) !== totalAmount) {
        return { success: false, conflict: true, error: 'Les sous-comptes de convives ne correspondent plus au total de la commande.' };
      }
    } else {
      if (alreadyPaid > 0 && splitGuests > 1) {
        return { success: false, conflict: true, error: 'La répartition individuelle doit être définie avant le premier encaissement.' };
      }
      const baseShare = Math.floor(totalAmount / splitGuests);
      const remainder = totalAmount % splitGuests;
      guestAccounts = Array.from({ length: splitGuests }, (_, index) => {
        const shareAmount = baseShare + (index < remainder ? 1 : 0);
        return {
          id: `guest_${index + 1}`,
          guestNumber: index + 1,
          guestName: `Convive ${index + 1}`,
          shareAmount,
          paidAmount: splitGuests === 1 ? alreadyPaid : 0,
          remainingAmount: shareAmount - (splitGuests === 1 ? alreadyPaid : 0),
          paymentStatus: alreadyPaid >= shareAmount ? 'paid' : alreadyPaid > 0 ? 'partial' : 'unpaid'
        };
      });
    }

    const guestIndex = guestNumber - 1;
    const selectedGuest = guestAccounts[guestIndex];
    if (!selectedGuest || Number(selectedGuest.guestNumber) !== guestNumber) {
      return { success: false, conflict: true, error: 'Sous-compte du convive introuvable.' };
    }
    const guestShareAmount = Number(selectedGuest.shareAmount);
    const guestPreviouslyPaidAmount = Number(selectedGuest.paidAmount || 0);
    const guestRemainingBefore = guestShareAmount - guestPreviouslyPaidAmount;
    if (!Number.isSafeInteger(guestShareAmount) || guestShareAmount <= 0 ||
        !Number.isSafeInteger(guestPreviouslyPaidAmount) || guestPreviouslyPaidAmount < 0 ||
        guestPreviouslyPaidAmount > guestShareAmount || guestRemainingBefore <= 0) {
      return { success: false, error: 'La part de ce convive est déjà réglée ou incohérente.' };
    }

    const acceptedAmount = Math.min(amountTendered, guestRemainingBefore);
    const changeAmount = Math.max(0, amountTendered - guestRemainingBefore);
    const paidAmount = alreadyPaid + acceptedAmount;
    const remainingAmount = totalAmount - paidAmount;
    const paymentStatus = remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    const guestPaidAmount = guestPreviouslyPaidAmount + acceptedAmount;
    const guestRemainingAfter = guestShareAmount - guestPaidAmount;
    const updatedGuestAccount = {
      ...selectedGuest,
      guestName: selectedGuest.guestName && selectedGuest.guestName !== `Convive ${guestNumber}`
        ? selectedGuest.guestName
        : guestName || selectedGuest.guestName || `Convive ${guestNumber}`,
      paidAmount: guestPaidAmount,
      remainingAmount: guestRemainingAfter,
      paymentStatus: guestRemainingAfter === 0 ? 'paid' : 'partial'
    };
    guestAccounts[guestIndex] = updatedGuestAccount;
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
      cashSessionId: activeSessionId,
      currency: order.currency || 'FCFA',
      amountTendered,
      paidAmount: acceptedAmount,
      changeAmount,
      totalAmount,
      previouslyPaidAmount: alreadyPaid,
      remainingBefore,
      remainingAfter: remainingAmount,
      paymentStatus,
      splitGuests,
      guestAccountId: updatedGuestAccount.id,
      guestNumber,
      guestName: updatedGuestAccount.guestName,
      guestShareAmount,
      guestPreviouslyPaidAmount,
      guestRemainingBefore,
      guestRemainingAfter,
      items: Array.isArray(order.items) ? order.items : [],
      createdAt: now
    };

    const updatedOrder = {
      ...order,
      splitGuests,
      guestAccounts,
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
      splitGuests,
      guestAccounts,
      paidAmount,
      remainingAmount,
      paymentStatus,
      lastPaymentAt: now,
      lastPaymentId: paymentId
    });
    tx.update(cashSessionRef, {
      cashCollected: Number(cashSession.cashCollected || 0) + acceptedAmount,
      paymentCount: Number(cashSession.paymentCount || 0) + 1,
      lastPaymentAt: now
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

function canManageCashSession(member: any, restaurant: any, actorUid: string): boolean {
  return (member?.role === 'owner' && restaurant?.ownerUid === actorUid) ||
    member?.role === 'manager' ||
    (member?.role === 'cashier' && Array.isArray(member.permissions) && member.permissions.includes('cash.manage'));
}

export async function getCashSessionWithDb(db: any, restaurantSlug: string, actorUid: string): Promise<Record<string, any> | null> {
  if (!db) throw new Error('Firestore indisponible.');
  const slug = String(restaurantSlug || '').trim();
  const uid = String(actorUid || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !uid) throw new Error('Restaurant ou utilisateur invalide.');
  const restaurantRef = db.collection('restaurants').doc(slug);
  const activeSnap = await restaurantRef.collection('cashSessionActive').doc(uid).get();
  if (!activeSnap.exists || activeSnap.data()?.status !== 'active') return null;
  const sessionId = String(activeSnap.data()?.sessionId || '');
  if (!sessionId) return null;
  const sessionSnap = await restaurantRef.collection('cashSessions').doc(sessionId).get();
  if (!sessionSnap.exists || sessionSnap.data()?.status !== 'active' || sessionSnap.data()?.openedByUid !== uid) return null;
  const sessionData = sessionSnap.data();
  const movementsSnap = await restaurantRef.collection('cashMovements')
    .where('sessionId', '==', sessionId).limit(50).get();
  const cashMovements = movementsSnap.docs
    .map((doc: any) => ({ ...doc.data(), id: doc.id }))
    .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return {
    ...sessionData,
    id: sessionSnap.id,
    cashOut: Number(sessionData.cashOut || 0),
    cashMovementCount: Number(sessionData.cashMovementCount || 0),
    cashMovements
  };
}

export async function openCashSessionWithDb(db: any, input: CashSessionInput): Promise<CashSessionResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const slug = String(input.restaurantSlug || '').trim();
  const actorUid = String(input.actorUid || '').trim();
  const key = String(input.idempotencyKey || '').trim();
  const openingBalance = input.openingBalance;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !Number.isSafeInteger(openingBalance) || Number(openingBalance) < 0 || Number(openingBalance) > 100_000_000) {
    return { success: false, error: 'Paramètres d’ouverture de caisse invalides.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const activeRef = restaurantRef.collection('cashSessionActive').doc(actorUid);
  const sessionId = `cash_${sha256(`${slug}::${actorUid}::${key}`).slice(0, 32)}`;
  const sessionRef = restaurantRef.collection('cashSessions').doc(sessionId);
  const signature = sha256(JSON.stringify({ slug, actorUid, openingBalance }));
  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, activeSnap, sessionSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(activeRef), tx.get(sessionRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(input.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { success: false, error: 'Compte inactif, session du personnel révoquée ou accès au restaurant refusé.' };
    }
    if (!canManageCashSession(member, restaurant, actorUid)) {
      return { success: false, error: 'Votre rôle ne permet pas d’ouvrir une session de caisse.' };
    }
    if (sessionSnap.exists) {
      const previous = sessionSnap.data();
      if (previous.openingSignature !== signature || previous.openedByUid !== actorUid) {
        return { success: false, conflict: true, error: 'Clé d’ouverture déjà utilisée pour une autre session.' };
      }
      if (previous.status !== 'active' || activeSnap.data()?.sessionId !== sessionId || activeSnap.data()?.status !== 'active') {
        return { success: false, conflict: true, error: 'Cette session a déjà été clôturée. Utilisez une nouvelle clé pour ouvrir une nouvelle session.' };
      }
      return { success: true, idempotentReplay: true, session: { ...previous, id: sessionId } };
    }
    if (activeSnap.exists && activeSnap.data()?.status === 'active') {
      return { success: false, conflict: true, error: 'Une session de caisse est déjà ouverte pour ce compte.' };
    }
    const now = Date.now();
    const session = {
      id: sessionId, restaurantSlug: slug, openedByUid: actorUid,
      openedByName: String(input.actorName || actorUid), role: member.role,
      sessionVersion: Number(input.sessionVersion || 0),
      openingBalance: Number(openingBalance), cashCollected: 0, paymentCount: 0,
      cashOut: 0, cashMovementCount: 0,
      status: 'active', openedAt: now, openingSignature: signature
    };
    tx.create(sessionRef, session);
    tx.set(activeRef, { sessionId, status: 'active', openedByUid: actorUid, openedAt: now });
    return { success: true, session };
  });
}

export async function closeCashSessionWithDb(db: any, input: CashSessionInput): Promise<CashSessionResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const slug = String(input.restaurantSlug || '').trim();
  const actorUid = String(input.actorUid || '').trim();
  const key = String(input.idempotencyKey || '').trim();
  const closingCount = input.closingCount;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !Number.isSafeInteger(closingCount) || Number(closingCount) < 0 || Number(closingCount) > 100_000_000) {
    return { success: false, error: 'Paramètres de clôture de caisse invalides.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const activeRef = restaurantRef.collection('cashSessionActive').doc(actorUid);
  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, activeSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(activeRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(input.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { success: false, error: 'Compte inactif, session du personnel révoquée ou accès au restaurant refusé.' };
    }
    if (!canManageCashSession(member, restaurant, actorUid)) {
      return { success: false, error: 'Votre rôle ne permet pas de clôturer une session de caisse.' };
    }
    const sessionId = activeSnap.exists ? String(activeSnap.data()?.sessionId || '') : '';
    if (!sessionId) return { success: false, error: 'Aucune session de caisse à clôturer.' };
    const sessionRef = restaurantRef.collection('cashSessions').doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);
    const session = sessionSnap.exists ? sessionSnap.data() : null;
    const closingSignature = sha256(JSON.stringify({ slug, actorUid, sessionId, closingCount }));
    if (activeSnap.data()?.status !== 'active') {
      if (session?.status === 'closed' && session.openedByUid === actorUid &&
          session.closingIdempotencyKey === key && session.closingSignature === closingSignature) {
        return { success: true, idempotentReplay: true, session: { ...session, id: sessionId } };
      }
      if (session?.status === 'closed' && session.closingIdempotencyKey === key) {
        return { success: false, conflict: true, error: 'Clé de clôture réutilisée avec un comptage différent.' };
      }
      return { success: false, error: 'Aucune session de caisse active à clôturer.' };
    }
    if (!session || session.status !== 'active' || session.openedByUid !== actorUid ||
        Number(session.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { success: false, error: 'La session active est invalide ou ne vous appartient pas.' };
    }
    const expectedCash = Number(session.openingBalance || 0) + Number(session.cashCollected || 0) - Number(session.cashOut || 0);
    const variance = Number(closingCount) - expectedCash;
    const now = Date.now();
    const closed = {
      ...session, status: 'closed', closingCount: Number(closingCount),
      expectedCash, variance, closedAt: now, closedByUid: actorUid,
      closedByName: String(input.actorName || actorUid), closingIdempotencyKey: key,
      closingSignature
    };
    tx.update(sessionRef, {
      status: 'closed', closingCount: Number(closingCount), expectedCash, variance,
      closedAt: now, closedByUid: actorUid, closedByName: String(input.actorName || actorUid),
      closingIdempotencyKey: key, closingSignature
    });
    tx.update(activeRef, { status: 'closed', closedAt: now, sessionId });
    return { success: true, session: closed };
  });
}

export async function recordCashMovementWithDb(db: any, input: CashMovementInput): Promise<CashMovementResult> {
  if (!db) return { success: false, error: 'Firestore indisponible.' };
  const slug = String(input.restaurantSlug || '').trim();
  const actorUid = String(input.actorUid || '').trim();
  const key = String(input.idempotencyKey || '').trim();
  const movementType = input.movementType;
  const amount = input.amount;
  const category = String(input.category || '').trim().slice(0, 40);
  const note = String(input.note || '').trim().slice(0, 200);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !actorUid ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key) ||
      !['expense', 'withdrawal'].includes(movementType) ||
      !Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 100_000_000 ||
      category.length < 2) {
    return { success: false, error: 'Paramètres de sortie de caisse invalides.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const activeRef = restaurantRef.collection('cashSessionActive').doc(actorUid);
  const movementId = `move_${sha256(`${slug}::${actorUid}::${key}`).slice(0, 32)}`;
  const movementRef = restaurantRef.collection('cashMovements').doc(movementId);
  const signature = sha256(JSON.stringify({ slug, actorUid, movementType, amount, category, note }));

  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, activeSnap, movementSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(activeRef), tx.get(movementRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(input.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
      return { success: false, error: 'Compte inactif, session du personnel révoquée ou accès au restaurant refusé.' };
    }
    if (!canManageCashSession(member, restaurant, actorUid)) {
      return { success: false, error: 'Votre rôle ne permet pas d’enregistrer une sortie de caisse.' };
    }
    if (movementSnap.exists) {
      const previous = movementSnap.data();
      if (previous.signature !== signature || previous.actorUid !== actorUid) {
        return { success: false, conflict: true, error: 'Clé de sortie déjà utilisée pour une opération différente.' };
      }
      const previousSessionRef = restaurantRef.collection('cashSessions').doc(String(previous.sessionId || ''));
      const previousSessionSnap = await tx.get(previousSessionRef);
      return {
        success: true, idempotentReplay: true,
        movement: { ...previous, id: movementId },
        session: previousSessionSnap.exists ? { ...previousSessionSnap.data(), id: previousSessionSnap.id } : undefined
      };
    }
    const sessionId = activeSnap.exists ? String(activeSnap.data()?.sessionId || '') : '';
    if (!sessionId || activeSnap.data()?.status !== 'active') {
      return { success: false, error: 'Ouvrez une session de caisse avant d’enregistrer une sortie.' };
    }
    const sessionRef = restaurantRef.collection('cashSessions').doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);
    const session = sessionSnap.exists ? sessionSnap.data() : null;
    if (!session || session.status !== 'active' || session.openedByUid !== actorUid ||
        Number(session.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { success: false, error: 'La session active est invalide ou ne vous appartient pas.' };
    }
    const availableCash = Number(session.openingBalance || 0) +
      Number(session.cashCollected || 0) - Number(session.cashOut || 0);
    if (Number(amount) > availableCash) {
      return { success: false, error: 'La sortie dépasse le montant théorique disponible dans le tiroir.' };
    }
    const now = Date.now();
    const movement = {
      id: movementId, restaurantSlug: slug, sessionId, actorUid,
      actorName: String(input.actorName || actorUid),
      movementType, amount: Number(amount), category, note,
      signature, createdAt: now
    };
    const updatedSession = {
      ...session,
      cashOut: Number(session.cashOut || 0) + Number(amount),
      cashMovementCount: Number(session.cashMovementCount || 0) + 1,
      lastCashMovementAt: now
    };
    tx.create(movementRef, movement);
    tx.update(sessionRef, {
      cashOut: updatedSession.cashOut,
      cashMovementCount: updatedSession.cashMovementCount,
      lastCashMovementAt: now
    });
    return { success: true, movement, session: { ...updatedSession, id: sessionId } };
  });
}
