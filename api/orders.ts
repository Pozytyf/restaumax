import { handleOrderSubmission } from '../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');\n  res.setHeader('Referrer-Policy', 'no-referrer');\n  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }

  const result = await handleOrderSubmission(req.body, req);
  return res.status(result.statusCode).json(result.body);
}
