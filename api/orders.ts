import { handleOrderSubmission } from '../server.ts';

// Keep Vercel's request parser limit aligned with the Express development server.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Méthode non autorisée.' });
  }

  const result = await handleOrderSubmission(req.body, req);
  return res.status(result.statusCode).json(result.body);
}
