import { getServerHealth } from '../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', error: 'Méthode non autorisée.' });
  }

  const health = getServerHealth();
  return res.status(health.hasAdminDb ? 200 : 503).json(health);
}
