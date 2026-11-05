import { handlePaymentsRequest } from '../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }

  const result = await handlePaymentsRequest(req.method === 'GET' ? undefined : req.body, req);
  return res.status(result.statusCode).json(result.body);
}
