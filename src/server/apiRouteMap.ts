export const RESTAUMAX_API_ROUTES = [
  { id: 'health', path: 'health', methods: ['GET'] },
  { id: 'inventory', path: 'inventory', methods: ['POST'] },
  { id: 'customers', path: 'customers', methods: ['POST'] },
  { id: 'tables', path: 'tables', methods: ['POST'] },
  { id: 'customer-loyalty', path: 'customer-loyalty', methods: ['POST'] },
  { id: 'kitchen-item', path: 'kitchen-item', methods: ['POST'] },
  { id: 'order-status', path: 'order-status', methods: ['POST'] },
  { id: 'customer-orders', path: 'customer-orders', methods: ['POST'] },
  { id: 'public-menu', path: 'public-menu', methods: ['GET'] },
  { id: 'restaurant-images', path: 'restaurant-images', methods: ['POST', 'DELETE'] },
  { id: 'orders', path: 'orders', methods: ['POST'] },
  { id: 'payments', path: 'payments', methods: ['GET', 'POST'] },
  { id: 'platform-admin', path: 'platform-admin', methods: ['GET', 'POST'] },
  { id: 'pos-orders', path: 'pos-orders', methods: ['POST'] },
  { id: 'reports', path: 'reports', methods: ['GET'] },
  { id: 'restaurant-service', path: 'restaurant-service', methods: ['POST'] },
  { id: 'table-session', path: 'table-session', methods: ['GET'] },
  { id: 'customer-cash-preference', path: 'payments/customer-cash-preference', methods: ['POST'] },
  { id: 'customer-paydunya', path: 'payments/customer-paydunya', methods: ['POST'] },
  { id: 'customer-paydunya-reconcile', path: 'payments/customer-paydunya-reconcile', methods: ['POST'] },
  { id: 'paydunya-callback', path: 'payments/paydunya-callback', methods: ['POST'] },
  { id: 'paydunya-disbursement-callback', path: 'payments/paydunya-disbursement-callback', methods: ['POST'] },
  { id: 'subscription-billing-cycle', path: 'subscriptions/billing-cycle', methods: ['GET'] },
  { id: 'tables-qr', path: 'tables/qr', methods: ['GET', 'POST', 'DELETE'] },
  { id: 'tables-resolve-qr', path: 'tables/resolve-qr', methods: ['GET'] }
] as const;

export type RestauMaxApiRoute = typeof RESTAUMAX_API_ROUTES[number];

const ROUTES_BY_PATH = new Map<string, RestauMaxApiRoute>(
  RESTAUMAX_API_ROUTES.map((route) => [route.path, route])
);
const ROUTES_BY_ID = new Map<string, RestauMaxApiRoute>(
  RESTAUMAX_API_ROUTES.map((route) => [route.id, route])
);

export function resolveRestauMaxApiRoute(value: unknown): RestauMaxApiRoute | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().split('/').filter(Boolean).join('/');
  return ROUTES_BY_PATH.get(normalized) ?? ROUTES_BY_ID.get(normalized) ?? null;
}

/**
 * Resolve a route from Vercel's rewritten query, raw request URL, or original
 * public API path. Vercel adapters can expose rewritten query parameters in
 * req.url while omitting them from req.query; accepting the original path keeps
 * authenticated endpoints reachable without weakening the route allow-list.
 */
export function resolveRestauMaxApiRouteFromRequest(req: {
  query?: Record<string, unknown>;
  url?: string;
  originalUrl?: string;
}): RestauMaxApiRoute | null {
  const queryValue = req?.query?.__restaumax_route;
  const queryRoute = resolveRestauMaxApiRoute(queryValue);
  if (queryRoute) return queryRoute;

  for (const rawUrl of [req?.url, req?.originalUrl]) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) continue;
    try {
      const parsed = new URL(rawUrl, 'https://restaumax.invalid');
      const routeFromUrl = resolveRestauMaxApiRoute(parsed.searchParams.get('__restaumax_route'));
      if (routeFromUrl) return routeFromUrl;
      const pathname = parsed.pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '');
      const routeFromPath = resolveRestauMaxApiRoute(pathname);
      if (routeFromPath) return routeFromPath;
    } catch {
      // Ignore malformed URLs and try the next trusted request representation.
    }
  }
  return null;
}

/**
 * Read a rewritten query parameter from the parsed Vercel query or the raw
 * request URL. Vercel may expose the route marker in req.query while leaving
 * other rewritten parameters (notably the opaque QR token) only in req.url.
 */
export function getRestauMaxRequestQueryParam(
  req: { query?: Record<string, unknown>; url?: string; originalUrl?: string },
  name: string
): string | null {
  const direct = req?.query?.[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  if (Array.isArray(direct) && direct.length === 1 && typeof direct[0] === 'string' && direct[0].length > 0) {
    return direct[0];
  }

  for (const rawUrl of [req?.url, req?.originalUrl]) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) continue;
    try {
      const value = new URL(rawUrl, 'https://restaumax.invalid').searchParams.get(name);
      if (value) return value;
    } catch {
      // Ignore malformed URLs and try the next request representation.
    }
  }
  return null;
}
