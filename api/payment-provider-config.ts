import { handleJekoPaymentConfigRequest } from '../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }

  const result = await handleJekoPaymentConfigRequest(req.method === 'GET' ? undefined : req.body, req);
  return res.status(result.statusCode).json(result.body);
}
