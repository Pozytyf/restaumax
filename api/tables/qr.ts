import { handleTableQrManagement } from '../../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }
  const result = await handleTableQrManagement(req);
  return res.status(result.statusCode).json(result.body);
}