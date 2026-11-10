import { createHash } from 'node:crypto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

export function normalizeCustomerPhone(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('225') && digits.length === 13 ? digits.slice(3) : digits;
  return /^[0-9]{10}$/.test(local) ? local : null;
}

export interface LoyaltyAwardInput {
  tx: any;
  restaurantRef: any;
  restaurant: Record<string, any>;
  orderRef: any;
  order: Record<string, any>;
  actorUid: string;
  now: number;
}

export interface LoyaltyAwardResult {
  success: boolean;
  awarded: number;
  idempotentReplay?: boolean;
  orderFields?: Record<string, any>;
}

/**
 * Award points once, only when the full order balance is paid. The award,
 * customer balance and append-only ledger share the payment transaction.
 */
export async function awardLoyaltyPointsInTransaction(input: LoyaltyAwardInput): Promise<LoyaltyAwardResult> {
  const { tx, restaurantRef, restaurant, orderRef, order, actorUid, now } = input;
  const phone = normalizeCustomerPhone(order.customerPhoneNormalized || order.customerPhone);
  if (!phone) return { success: true, awarded: 0 };
  const totalAmount = Number(order.totalAmount);
  const taxAmount = Number(order.taxAmount || 0);
  const subtotal = totalAmount - taxAmount;
  const fcfaPerPoint = Number(restaurant.loyaltyFcfaPerPoint ?? 1000);
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 0 || !Number.isSafeInteger(taxAmount) || taxAmount < 0 ||
      !Number.isSafeInteger(subtotal) || subtotal < 0 ||
      !Number.isSafeInteger(fcfaPerPoint) || fcfaPerPoint < 1 || fcfaPerPoint > 100000000) {
    return { success: true, awarded: 0, orderFields: { loyaltyAwardStatus: 'skipped_invalid_amount_or_configuration' } };
  }
  const points = Math.floor(subtotal / fcfaPerPoint);
  if (points <= 0) return { success: true, awarded: 0 };

  const customersRef = restaurantRef.collection('customers');
  const ledgerRef = restaurantRef.collection('loyaltyLedger').doc(`order_${hash(String(order.id || orderRef.id))}`);
  const deterministicCustomerRef = customersRef.doc(`loyalty_${hash(phone)}`);
  const customerQuery = customersRef.where('phoneNormalized', '==', phone).limit(1);
  const rawPhoneQuery = customersRef.where('phone', '==', String(order.customerPhone || phone)).limit(1);
  const digitsPhoneQuery = customersRef.where('phone', '==', phone).limit(1);
  const [ledgerSnap, matchingCustomers, rawPhoneMatches, digitsPhoneMatches, fallbackCustomerSnap] = await Promise.all([
    tx.get(ledgerRef), tx.get(customerQuery), tx.get(rawPhoneQuery),
    tx.get(digitsPhoneQuery), tx.get(deterministicCustomerRef)
  ]);
  if (ledgerSnap.exists) {
    const previous = ledgerSnap.data() || {};
    return {
      success: true, awarded: 0, idempotentReplay: true,
      orderFields: {
        loyaltyPointsAwarded: Number(previous.points || 0),
        loyaltyCustomerId: String(previous.customerId || ''),
        loyaltyAwardedAt: Number(previous.createdAt || now)
      }
    };
  }

  const matchedCustomer = matchingCustomers.docs?.[0] || rawPhoneMatches.docs?.[0] || digitsPhoneMatches.docs?.[0];
  const customerRef = matchedCustomer?.ref || deterministicCustomerRef;
  const customerSnap = matchedCustomer || fallbackCustomerSnap;
  const existing = customerSnap?.exists ? customerSnap.data() || {} : null;
  const previousPoints = Number(existing?.loyaltyPoints || 0);
  if (!Number.isSafeInteger(previousPoints) || previousPoints < 0) {
    return { success: true, awarded: 0, orderFields: { loyaltyAwardStatus: 'manual_review' } };
  }
  const customerId = customerRef.id;
  const customerName = String(order.customerName || existing?.name || 'Client').trim().slice(0, 80) || 'Client';
  const customerPhone = String(order.customerPhone || existing?.phone || phone).trim().slice(0, 32);
  if (existing) {
    tx.update(customerRef, {
      name: existing.name || customerName,
      phone: existing.phone || customerPhone,
      phoneNormalized: phone,
      loyaltyPoints: previousPoints + points,
      updatedAt: now,
      lastLoyaltyOrderId: String(order.id || orderRef.id)
    });
  } else {
    tx.create(customerRef, {
      id: customerId, name: customerName, phone: customerPhone,
      phoneNormalized: phone, email: '', notes: '',
      loyaltyPoints: points, createdAt: now, updatedAt: now,
      createdFrom: 'paid_order', lastLoyaltyOrderId: String(order.id || orderRef.id)
    });
  }
  tx.create(ledgerRef, {
    id: ledgerRef.id, restaurantSlug: restaurantRef.id,
    orderId: String(order.id || orderRef.id), customerId, phoneNormalized: phone,
    points, eligibleAmountFcfa: subtotal, fcfaPerPoint,
    source: 'order_fully_paid', createdAt: now, createdBy: actorUid
  });
  return {
    success: true, awarded: points,
    orderFields: { loyaltyPointsAwarded: points, loyaltyCustomerId: customerId, loyaltyAwardedAt: now }
  };
}

export interface ManualLoyaltyAdjustmentInput {
  restaurantSlug: string;
  customerId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  actorUid: string;
  sessionVersion: number;
  now?: number;
}

/**
 * Manually adjusts a customer's points through a tenant-scoped, idempotent
 * server transaction. Every adjustment is recorded in the private loyalty ledger.
 */
export async function adjustCustomerLoyaltyPointsWithDb(
  db: any,
  input: ManualLoyaltyAdjustmentInput
) {
  const slug = String(input.restaurantSlug || '').trim();
  const customerId = String(input.customerId || '').trim();
  const reason = String(input.reason || '').trim().slice(0, 200);
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const actorUid = String(input.actorUid || '').trim();
  const delta = Number(input.delta);
  const now = Number(input.now || Date.now());

  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(customerId) ||
      !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1000 ||
      reason.length < 3 || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey) ||
      !actorUid || !Number.isSafeInteger(now)) {
    return { success: false, error: 'Ajustement de fidélité invalide.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const customerRef = restaurantRef.collection('customers').doc(customerId);
  const ownershipRef = restaurantRef.collection('private').doc('ownership');
  const ledgerRef = restaurantRef.collection('loyaltyLedger')
    .doc('manual_' + hash(slug + ':' + idempotencyKey));

  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, customerSnap, ownershipSnap, ledgerSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(customerRef),
      tx.get(ownershipRef), tx.get(ledgerRef)
    ]);
    if (!restaurantSnap.exists || !customerSnap.exists) {
      return { success: false, error: 'Restaurant ou fiche client introuvable.' };
    }
    const restaurant = restaurantSnap.data() || {};
    const member = memberSnap.exists ? memberSnap.data() || {} : null;
    if (!member || member.active !== true || member.restaurantSlug !== slug ||
        Number(member.sessionVersion || 0) !== Number(input.sessionVersion || 0) ||
        String(restaurant.status || 'active') !== 'active' || restaurant.deletedAt) {
      return { success: false, error: 'Compte inactif ou accès à ce restaurant refusé.' };
    }
    const ownerUid = String((ownershipSnap.exists ? ownershipSnap.data()?.ownerUid : '') || restaurant.ownerUid || '');
    const authorized = member.role === 'owner'
      ? ownerUid === actorUid
      : member.role === 'manager' && Array.isArray(member.permissions) && member.permissions.includes('customers.manage');
    if (!authorized) {
      return { success: false, error: 'Votre rôle ne permet pas de modifier les points de fidélité.' };
    }

    if (ledgerSnap.exists) {
      const previous = ledgerSnap.data() || {};
      if (previous.actorUid === actorUid && previous.customerId === customerId &&
          previous.pointsDelta === delta && previous.reason === reason) {
        return { success: true, idempotentReplay: true, points: Number(previous.pointsAfter || 0) };
      }
      return { success: false, conflict: true, error: 'Cette clé de demande a déjà été utilisée pour un autre ajustement.' };
    }

    const customer = customerSnap.data() || {};
    const pointsBefore = Number(customer.loyaltyPoints || 0);
    const pointsAfter = pointsBefore + delta;
    if (!Number.isSafeInteger(pointsBefore) || pointsBefore < 0 ||
        !Number.isSafeInteger(pointsAfter) || pointsAfter < 0 || pointsAfter > 1000000000) {
      return { success: false, error: 'Le solde de points ne permet pas cet ajustement.' };
    }

    tx.update(customerRef, { loyaltyPoints: pointsAfter, updatedAt: now });
    tx.create(ledgerRef, {
      id: ledgerRef.id, restaurantSlug: slug, customerId,
      pointsDelta: delta, pointsBefore, pointsAfter, reason,
      source: 'manual_adjustment', actorUid, createdAt: now,
      idempotencyKey
    });
    return { success: true, idempotentReplay: false, points: pointsAfter };
  });
}



export interface CreateCustomerInput {
  restaurantSlug: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  actorUid: string;
  sessionVersion: number;
  now?: number;
}

/**
 * Create or complete one customer profile using a tenant-scoped deterministic
 * ID derived from the normalized phone. Concurrent requests for the same
 * phone therefore converge on the same Firestore document.
 */
export async function createCustomerWithDb(db: any, input: CreateCustomerInput) {
  const slug = String(input.restaurantSlug || '').trim();
  const name = String(input.name || '').trim().slice(0, 160);
  const phone = String(input.phone || '').trim().slice(0, 40);
  const phoneNormalized = normalizeCustomerPhone(phone);
  const email = String(input.email || '').trim().slice(0, 160);
  const notes = String(input.notes || '').trim().slice(0, 500);
  const actorUid = String(input.actorUid || '').trim();
  const now = Number(input.now || Date.now());
  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || name.length < 2 || !phoneNormalized ||
      (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) || !actorUid || !Number.isSafeInteger(now)) {
    return { success: false, error: 'Les informations du client sont invalides.' };
  }
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(actorUid);
  const ownershipRef = restaurantRef.collection('private').doc('ownership');
  const customerId = 'loyalty_' + hash(phoneNormalized);
  const customerRef = restaurantRef.collection('customers').doc(customerId);
  const matchingCustomers = restaurantRef.collection('customers').where('phoneNormalized', '==', phoneNormalized).limit(2);
  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, memberSnap, ownershipSnap, customerSnap, matchesSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(memberRef), tx.get(ownershipRef), tx.get(customerRef), tx.get(matchingCustomers)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() || {} : null;
    const member = memberSnap.exists ? memberSnap.data() || {} : null;
    if (!restaurant || String(restaurant.status || 'active') !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(member.sessionVersion || 0) !== Number(input.sessionVersion || 0)) {
      return { success: false, error: 'Compte inactif ou accès à ce restaurant refusé.' };
    }
    const ownerUid = String((ownershipSnap.exists ? ownershipSnap.data()?.ownerUid : '') || restaurant.ownerUid || '');
    const authorized = member.role === 'owner'
      ? ownerUid === actorUid
      : member.role === 'manager' && Array.isArray(member.permissions) && member.permissions.includes('customers.manage');
    if (!authorized) return { success: false, error: 'Votre rôle ne permet pas de gérer les fiches clients.' };
    const matches = Array.isArray(matchesSnap.docs) ? matchesSnap.docs : [];
    if (matches.some((doc: any) => doc.id !== customerId)) {
      return { success: false, conflict: true, error: 'Un client utilise déjà ce numéro de téléphone dans ce restaurant.' };
    }
    const existing = customerSnap.exists ? customerSnap.data() || {} : null;
    const loyaltyPoints = Number(existing?.loyaltyPoints || 0);
    if (!Number.isSafeInteger(loyaltyPoints) || loyaltyPoints < 0) {
      return { success: false, error: 'Le solde de fidélité de cette fiche est invalide.' };
    }
    const data = { id: customerId, name, phone, phoneNormalized, email, notes, loyaltyPoints,
      createdAt: Number(existing?.createdAt || now), updatedAt: now,
      ...(existing?.createdFrom ? { createdFrom: existing.createdFrom } : {}) };
    if (existing) tx.update(customerRef, data);
    else tx.create(customerRef, data);
    return { success: true, customerId, loyaltyPoints, alreadyExisted: Boolean(existing) };
  });
}
