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
  return res.status(result.statusCode).json(result.body);
}