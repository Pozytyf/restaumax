import {
  adminDb,
  getServerHealth,
  handleCustomerPayDunyaInvoiceRequest,
  handleCustomerPayDunyaReconcileRequest,
  handleGetTableSession,
  handleInventoryRequest,
  handleKitchenItemRequest,
  handleOrderStatusRequest,
  handleOrderSubmission,
  handlePaymentsRequest,
  handlePayDunyaCallbackRequest,
  handlePayDunyaDisbursementCallbackRequest,
  handlePlatformAdmin,
  handlePublicMenuRequest,
  handlePosOrderSubmission,
  handleRestaurantReportsRequest,
  handleResolveTableQr,
  handleRestaurantServiceStatus,
  handleSubscriptionBillingCycleRequest,
  handleTableQrManagement
} from '../server.ts';
import { getRestauMaxRequestQueryParam, resolveRestauMaxApiRouteFromRequest } from '../src/server/apiRouteMap.ts';

function setPrivateApiHeaders(res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function methodNotAllowed(res: any, methods: readonly string[]) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
}

export default async function handler(req: any, res: any) {
  const route = resolveRestauMaxApiRouteFromRequest(req);

  if (!route) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ success: false, error: 'Point d’entrée API introuvable.' });
  }

  const method = String(req.method || '').toUpperCase();
  if (!(route.methods as readonly string[]).includes(method)) {
    return methodNotAllowed(res, route.methods);
  }

  if (route.id === 'health') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!adminDb) return res.status(503).json({ status: 'unavailable' });
    // Public health exposes only service availability and a timestamp. Infrastructure
    // identifiers and Firestore collection metadata are never returned anonymously.
    return res.status(200).json(getServerHealth());
  }

  if (route.id === 'platform-admin') {
    return handlePlatformAdmin(req, res, adminDb);
  }

  setPrivateApiHeaders(res);

  switch (route.id) {
    case 'public-menu': {
      const result = await handlePublicMenuRequest(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'inventory': {
      const result = await handleInventoryRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'kitchen-item': {
      const result = await handleKitchenItemRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'order-status': {
      const result = await handleOrderStatusRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'orders': {
      const result = await handleOrderSubmission(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'payments': {
      const result = await handlePaymentsRequest(method === 'GET' ? undefined : req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'pos-orders': {
      const result = await handlePosOrderSubmission(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'reports': {
      const result = await handleRestaurantReportsRequest(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'restaurant-service': {
      const result = await handleRestaurantServiceStatus(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'table-session': {
      const result = await handleGetTableSession(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'customer-paydunya': {
      const result = await handleCustomerPayDunyaInvoiceRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'customer-paydunya-reconcile': {
      const result = await handleCustomerPayDunyaReconcileRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'paydunya-callback': {
      const result = await handlePayDunyaCallbackRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'paydunya-disbursement-callback': {
      const result = await handlePayDunyaDisbursementCallbackRequest(req.body, req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'subscription-billing-cycle': {
      const result = await handleSubscriptionBillingCycleRequest(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'tables-qr': {
      const result = await handleTableQrManagement(req);
      return res.status(result.statusCode).json(result.body);
    }
    case 'tables-resolve-qr': {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
      const token = getRestauMaxRequestQueryParam(req, 'token') || '';
      const result = await handleResolveTableQr(token, req);
      if (result.cookies) res.setHeader('Set-Cookie', result.cookies);
      if (result.location) return res.redirect(result.statusCode, result.location);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const message = result.statusCode === 503
        ? 'Le service de vérification est momentanément indisponible. Réessayez dans quelques instants ou contactez le personnel.'
        : 'Ce QR code est invalide, révoqué ou associé à une table indisponible. Demandez un nouveau QR au personnel.';
      return res.status(result.statusCode).send('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR RestauMax indisponible</title><body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;display:grid;min-height:100vh;place-items:center;margin:0;padding:24px"><main style="max-width:440px;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 40px #10203018"><h1 style="font-size:22px">QR de table indisponible</h1><p style="line-height:1.6">' + message + '</p><p style="font-size:13px;color:#64748b">RestauMax — Sécurité des commandes</p></main></body></html>');
    }
    default:
      return res.status(404).json({ success: false, error: 'Point d’entrée API introuvable.' });
  }
}
