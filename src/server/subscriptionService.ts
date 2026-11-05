export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type SubscriptionBillingCycle = 'monthly' | 'yearly' | 'custom';

export interface NormalizedSubscriptionInput {
  planName: string;
  priceFcfa: number;
  currency: 'XOF';
  billingCycle: SubscriptionBillingCycle;
  status: SubscriptionStatus;
  startsAt: number;
  endsAt: number;
  notes: string;
}

export type SubscriptionValidationResult =
  | { success: true; subscription: NormalizedSubscriptionInput }
  | { success: false; error: string };

export function validateSubscriptionInput(input: unknown): SubscriptionValidationResult {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const planName = String(value.planName || '').trim();
  const priceFcfa = Number(value.priceFcfa);
  const billingCycle = String(value.billingCycle || '');
  const status = String(value.status || '');
  const startsAt = Number(value.startsAt);
  const endsAt = Number(value.endsAt);
  const notes = String(value.notes || '').trim().slice(0, 500);

  if (planName.length < 2 || planName.length > 80 ||
      !Number.isSafeInteger(priceFcfa) || priceFcfa < 0 || priceFcfa > 1_000_000_000 ||
      !['monthly', 'yearly', 'custom'].includes(billingCycle) ||
      !['trial', 'active', 'past_due', 'suspended', 'cancelled'].includes(status) ||
      !Number.isSafeInteger(startsAt) || startsAt <= 0 ||
      !Number.isSafeInteger(endsAt) || endsAt <= startsAt) {
    return {
      success: false,
      error: 'Informations d’abonnement invalides. Vérifiez le plan, le tarif FCFA, la périodicité, le statut et les dates.'
    };
  }

  return {
    success: true,
    subscription: {
      planName, priceFcfa, currency: 'XOF',
      billingCycle: billingCycle as SubscriptionBillingCycle,
      status: status as SubscriptionStatus,
      startsAt, endsAt, notes
    }
  };
}
