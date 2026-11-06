export const CORE_API_ROUTES = {
  health: ['GET'],
  inventory: ['POST'],
  'kitchen-item': ['POST'],
  orders: ['POST'],
  'platform-admin': null,
  'pos-orders': ['POST'],
  'table-session': ['GET'],
  'tables/qr': ['POST', 'DELETE'],
  'tables/resolve-qr': ['GET']
} as const satisfies Record<string, readonly string[] | null>;

export type CoreApiRoute = keyof typeof CORE_API_ROUTES;

export function resolveCoreApiRoute(value: unknown): CoreApiRoute | null {
  if (typeof value !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(CORE_API_ROUTES, value)
    ? value as CoreApiRoute
    : null;
}

export function getCoreApiAllowedMethods(route: CoreApiRoute): readonly string[] | null {
  return CORE_API_ROUTES[route];
}

export function isCoreApiMethodAllowed(route: CoreApiRoute, method: unknown): boolean {
  const allowedMethods = getCoreApiAllowedMethods(route);
  return allowedMethods === null
    || (typeof method === 'string' && allowedMethods.includes(method));
}
