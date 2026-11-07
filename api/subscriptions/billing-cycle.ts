import { handleSubscriptionBillingCycleRequest } from '../../server.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleSubscriptionBillingCycleRequest(req);
  return res.status(result.statusCode).json(result.body);
}
