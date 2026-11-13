export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';

function expectedPeriodEndDate(startsAt: number, cycle: SubscriptionBillingCycle) {
  if (cycle === 'custom') return null;
  const date = new Date(startsAt);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}
export type SubscriptionBillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface NormalizedSubscriptionInput {
  planName: string;
  priceFcfa: number;
  currency: 'XOF';
  billingCycle: SubscriptionBillingCycle;
  status: SubscriptionStatus;
  startsAt: number;
  endsAt: number;
  notes: string;
  autoRenew: boolean;
  gracePeriodDays: number;
  nextBillingAt: number;
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
  const autoRenew = value.autoRenew !== false;
  const gracePeriodDays = value.gracePeriodDays === undefined ? 7 : Number(value.gracePeriodDays);
  const nextBillingAt = value.nextBillingAt === undefined ? endsAt : Number(value.nextBillingAt);

  if (planName.length < 2 || planName.length > 80 ||
      !Number.isSafeInteger(priceFcfa) || priceFcfa < 0 || priceFcfa > 1_000_000_000 ||
      !['monthly', 'quarterly', 'yearly', 'custom'].includes(billingCycle) ||
      !['trial', 'active', 'past_due', 'suspended', 'cancelled'].includes(status) ||
      !Number.isSafeInteger(startsAt) || startsAt <= 0 ||
      !Number.isSafeInteger(endsAt) || endsAt <= startsAt ||
      !Number.isSafeInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 60 ||
      !Number.isSafeInteger(nextBillingAt) || nextBillingAt <= 0 || nextBillingAt !== endsAt ||
      (billingCycle !== 'custom' && new Date(endsAt).toISOString().slice(0, 10) !== expectedPeriodEndDate(startsAt, billingCycle as SubscriptionBillingCycle)) ||
      (billingCycle === 'custom' && autoRenew)) {
    return {
      success: false,
      error: 'Informations d’abonnement invalides. Vérifiez le plan, le tarif FCFA, le statut et la cohérence des dates avec la périodicité choisie.'
    };
  }

  return {
    success: true,
    subscription: {
      planName, priceFcfa, currency: 'XOF',
      billingCycle: billingCycle as SubscriptionBillingCycle,
      status: status as SubscriptionStatus,
      startsAt, endsAt, notes, autoRenew, gracePeriodDays, nextBillingAt
    }
  };
}
