import { handleResolveTableQr } from '../../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }
  const token = String(req.query?.token || '');
  const result = await handleResolveTableQr(token);
  if (result.cookies) res.setHeader('Set-Cookie', result.cookies);
  if (result.location) return res.redirect(result.statusCode, result.location);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const message = result.statusCode === 503
    ? 'Le service de vérification est momentanément indisponible. Réessayez dans quelques instants ou contactez le personnel.'
    : 'Ce QR code est invalide, révoqué ou associé à une table indisponible. Demandez un nouveau QR au personnel.';
  return res.status(result.statusCode).send('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR RestauMax indisponible</title><body style="font-family:system-ui,sans-serif;background:#f4f7fb;color:#172033;display:grid;min-height:100vh;place-items:center;margin:0;padding:24px"><main style="max-width:440px;background:white;border-radius:20px;padding:28px;box-shadow:0 12px 40px #10203018"><h1 style="font-size:22px">QR de table indisponible</h1><p style="line-height:1.6">' + message + '</p><p style="font-size:13px;color:#64748b">RestauMax — Sécurité des commandes</p></main></body></html>');
}