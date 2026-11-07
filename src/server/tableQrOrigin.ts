/**
 * Chooses the public origin for table QR links.
 *
 * Preview deployments target an isolated Firebase project/database. They must
 * never emit QR URLs pointing at the Production domain (APP_ORIGIN may be
 * configured globally for Production). The incoming host is the authoritative
 * origin for Preview requests; Production continues to use APP_ORIGIN.
 */
export function resolveTableQrOrigin(
  req: any,
  env: Record<string, string | undefined> = process.env
): string {
  const headers = req?.headers || {};
  const first = (value: unknown) => String(value || '').split(',')[0].trim();
  const host = first(headers['x-forwarded-host'] || headers.host);
  const protocol = first(headers['x-forwarded-proto'] || req?.protocol || 'https').toLowerCase();
  const originHeader = first(headers.origin);

  let requestOrigin = '';
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('Origin de requête non canonique.');
      }
      requestOrigin = parsed.origin;
    } catch {
      throw new Error('Origine de requête QR invalide.');
    }
  } else if (host) {
    requestOrigin = `${protocol}://${host}`;
  }

  if (env.VERCEL_ENV === 'preview') {
    if (!requestOrigin) {
      throw new Error('Hôte Preview introuvable : impossible de créer un QR dans le bon environnement.');
    }
    const parsed = new URL(requestOrigin);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) {
      throw new Error('Le domaine Preview du QR doit utiliser HTTPS.');
    }
    if (host && parsed.host !== host) {
      throw new Error('Le domaine du QR ne correspond pas à celui de la requête Preview.');
    }
    return parsed.origin;
  }

  const configuredOrigin = String(env.APP_ORIGIN || '').trim();
  const selectedOrigin = configuredOrigin || requestOrigin;
  if (!selectedOrigin) throw new Error('Origine applicative non configurée.');
  const parsed = new URL(selectedOrigin);
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !localHttp) ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('APP_ORIGIN doit être une origine HTTPS canonique, sans chemin.');
  }
  return parsed.origin;
}
