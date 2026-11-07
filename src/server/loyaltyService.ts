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
