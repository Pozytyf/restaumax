import {
  adminDb,
  getServerHealth,
  handleGetTableSession,
  handleInventoryRequest,
  handleKitchenItemRequest,
  handleOrderSubmission,
  handlePlatformAdmin,
  handlePosOrderSubmission,
  handleResolveTableQr,
  handleTableQrManagement
} from '../server.ts';
import {
  getCoreApiAllowedMethods,
  isCoreApiMethodAllowed,
  resolveCoreApiRoute
} from '../src/utils/apiRoute.ts';

function setPrivateApiHeaders(res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(req: any, res: any) {
  const route = resolveCoreApiRoute(req.query?.route);

  if (!route) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ success: false, error: 'Route API inconnue.' });
  }

  if (route === 'health') {
    res.setHeader('Cache-Control', 'no-store');
  } else if (route !== 'platform-admin') {
    setPrivateApiHeaders(res);
  }

  if (route === 'tables/resolve-qr') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
    );
  }

  if (!isCoreApiMethodAllowed(route, req.method)) {
    const allowedMethods = getCoreApiAllowedMethods(route);
    if (allowedMethods) res.setHeader('Allow', allowedMethods.join(', '));

    if (route === 'health') {
      return res.status(405).json({ status: 'error', error: 'Méthode non autorisée.' });
    }
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }

  switch (route) {
    case 'health': {
      const health = getServerHealth();
      return res.status(health.hasAdminDb ? 200 : 503).json(health);
    }
    case 'inventory': {
      const result = await handleInventoryRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'kitchen-item': {
      const result = await handleKitchenItemRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'orders': {
      const result = await handleOrderSubmission(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'platform-admin':
      return handlePlatformAdmin(req, res, adminDb);
    case 'pos-orders': {
      const result = await handlePosOrderSubmission(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'table-session': {
      const result = await handleGetTableSession(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'tables/qr': {
      const result = await handleTableQrManagement(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'tables/resolve-qr': {
      const token = String(req.query?.token || '');
      const result = await handleResolveTableQr(token, req);
      if (result.cookies) res.setHeader('Set-Cookie', result.cookies);
      if (result.location) return res.redirect(result.statusCode, result.location);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const message = result.statusCode === 503
        ? 'Le service de vérification est momentanément indisponible. Réessayez dans quelques instants ou contactez le personnel.'
        : 'Ce QR code est invalide, révoqué ou associé à une table indisponible. Demandez un nouveau QR au personnel.';
      return res.status(result.statusCode).send('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR RestauMax indisponible</title><body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;display:grid;min-height:100vh;place-items:center;margin:0;padding:24px"><main style="max-width:440px;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 40px #10203018"><h1 style="font-size:22px">QR de table indisponible</h1><p style="line-height:1.6">' + message + '</p><p style="font-size:13px;color:#64748b">RestauMax — Sécurité des commandes</p></main></body></html>');
    }
  }
}
