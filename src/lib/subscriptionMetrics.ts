export interface SubscriptionMetricRestaurant {
  status?: string;
  deletedAt?: number;
  subscription?: {
    status?: string;
    startsAt?: number;
    endsAt?: number;
    priceFcfa?: number;
    billingCycle?: string;
  };
}

export interface SubscriptionMetrics {
  restaurantCount: number;
  activeRestaurantCount: number;
  activeSubscriptionCount: number;
  trialSubscriptionCount: number;
  attentionSubscriptionCount: number;
  estimatedMonthlyRevenue: number;
}

export function calculateSubscriptionMetrics(
  restaurants: SubscriptionMetricRestaurant[],
  now = Date.now()
): SubscriptionMetrics {
  let activeSubscriptionCount = 0;
  let trialSubscriptionCount = 0;
  let attentionSubscriptionCount = 0;
  let estimatedMonthlyRevenue = 0;

  for (const restaurant of restaurants) {
    const subscription = restaurant.subscription;
    if (!subscription) continue;
    const status = subscription.status || '';
    const endsAt = Number(subscription.endsAt || 0);
    const current = ['active', 'trial'].includes(status) && endsAt > now;

    if (status === 'active' && current) {
      activeSubscriptionCount++;
      const price = Number(subscription.priceFcfa || 0);
      if (Number.isSafeInteger(price) && price > 0) {
        if (subscription.billingCycle === 'monthly') estimatedMonthlyRevenue += price;
        else if (subscription.billingCycle === 'quarterly') estimatedMonthlyRevenue += Math.round(price / 3);
        else if (subscription.billingCycle === 'yearly') estimatedMonthlyRevenue += Math.round(price / 12);
        else if (subscription.billingCycle === 'custom') {
          const startsAt = Number(subscription.startsAt || 0);
          const durationMonths = startsAt > 0 ? (endsAt - startsAt) / (30.4375 * 24 * 60 * 60 * 1000) : 0;
          if (durationMonths > 0) estimatedMonthlyRevenue += Math.round(price / durationMonths);
        }
      }
    } else if (status === 'trial' && current) {
      trialSubscriptionCount++;
    } else if (
      ['past_due', 'suspended', 'cancelled'].includes(status) ||
      (['active', 'trial'].includes(status) && !current)
    ) {
      attentionSubscriptionCount++;
    }
  }

  return {
    restaurantCount: restaurants.length,
    activeRestaurantCount: restaurants.filter(r =>
      r.status !== 'suspended' && r.status !== 'deleted' && !r.deletedAt
    ).length,
    activeSubscriptionCount,
    trialSubscriptionCount,
    attentionSubscriptionCount,
    estimatedMonthlyRevenue
  };
}
