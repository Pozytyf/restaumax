export const RESTAUMAX_API_ROUTES = [
  { id: 'health', path: 'health', methods: ['GET'] },
  { id: 'inventory', path: 'inventory', methods: ['POST'] },
  { id: 'kitchen-item', path: 'kitchen-item', methods: ['POST'] },
  { id: 'order-status', path: 'order-status', methods: ['POST'] },
  { id: 'orders', path: 'orders', methods: ['POST'] },
  { id: 'payments', path: 'payments', methods: ['GET', 'POST'] },
  { id: 'platform-admin', path: 'platform-admin', methods: ['GET', 'POST'] },
  { id: 'pos-orders', path: 'pos-orders', methods: ['POST'] },
  { id: 'reports', path: 'reports', methods: ['GET'] },
  { id: 'table-session', path: 'table-session', methods: ['GET'] },
  { id: 'customer-paydunya', path: 'payments/customer-paydunya', methods: ['POST'] },
  { id: 'customer-paydunya-reconcile', path: 'payments/customer-paydunya-reconcile', methods: ['POST'] },
  { id: 'paydunya-callback', path: 'payments/paydunya-callback', methods: ['POST'] },
  { id: 'paydunya-disbursement-callback', path: 'payments/paydunya-disbursement-callback', methods: ['POST'] },
  { id: 'subscription-billing-cycle', path: 'subscriptions/billing-cycle', methods: ['GET'] },
  { id: 'tables-qr', path: 'tables/qr', methods: ['POST', 'DELETE'] },
  { id: 'tables-resolve-qr', path: 'tables/resolve-qr', methods: ['GET'] }
] as const;

export type RestauMaxApiRoute = typeof RESTAUMAX_API_ROUTES[number];
export type RestauMaxApiRouteId = RestauMaxApiRoute['id'];

const ROUTES_BY_PATH = new Map<string, RestauMaxApiRoute>(
  RESTAUMAX_API_ROUTES.map((route) => [route.path, route])
);

export function resolveRestauMaxApiRoute(value: unknown): RestauMaxApiRoute | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\\/+|\\/+$/g, '');
  return ROUTES_BY_PATH.get(normalized) ?? null;
}
