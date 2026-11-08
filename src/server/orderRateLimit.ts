import { createHmac } from 'node:crypto';

export interface PublicOrderRateLimitInput {
  restaurantSlug: string;
  clientIp: string;
  secret: string;
  now?: number;
  windowMs?: number;
  maxRequests?: number;
}

export interface PublicOrderRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Persistent per-restaurant/per-IP fixed-window limiter.
 * Only a keyed digest is stored; raw client IP addresses are never persisted.
 */
export async function consumePublicOrderRateLimit(db: any, input: PublicOrderRateLimitInput): Promise<PublicOrderRateLimitResult> {
  const slug = String(input.restaurantSlug || '').trim();
  const ip = String(input.clientIp || '').trim();
  const secret = String(input.secret || '');
  const now = Number(input.now ?? Date.now());
  const windowMs = Number(input.windowMs ?? 10 * 60 * 1000);
  const maxRequests = Number(input.maxRequests ?? 5);

  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !ip || secret.length < 32 ||
      !Number.isFinite(now) || !Number.isInteger(windowMs) || windowMs < 60_000 ||
      !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100) {
    throw new Error('Configuration de limitation de commandes invalide.');
  }

  const digest = createHmac('sha256', secret)
    .update('restaumax:public-order-rate-limit:v1:')
    .update(slug)
    .update(':')
    .update(ip)
    .digest('hex');
  const ref = db.collection('restaurants').doc(slug).collection('orderRateLimits').doc(digest);

  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const data = snap?.exists ? snap.data() : null;
    const startedAt = Number(data?.windowStartedAt || 0);
    const currentCount = Number(data?.requestCount || 0);
    const expired = !Number.isFinite(startedAt) || now < startedAt || now - startedAt >= windowMs;

    if (expired) {
      tx.set(ref, {
        windowStartedAt: now,
        requestCount: 1,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000
      }, { merge: true });
      return { allowed: true, retryAfterSeconds: 0, remaining: maxRequests - 1 };
    }

    if (!Number.isInteger(currentCount) || currentCount < 0 || currentCount >= maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((startedAt + windowMs - now) / 1000)),
        remaining: 0
      };
    }

    tx.set(ref, {
      windowStartedAt: startedAt,
      requestCount: currentCount + 1,
      updatedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    }, { merge: true });
    return { allowed: true, retryAfterSeconds: 0, remaining: maxRequests - currentCount - 1 };
  });
}
