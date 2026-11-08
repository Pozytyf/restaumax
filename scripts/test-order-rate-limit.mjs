import assert from 'node:assert/strict';
import { consumePublicOrderRateLimit } from '../src/server/orderRateLimit.ts';

class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new Col(this.db, this.path + '/' + name); }
  async get() {
    const value = this.db.store.get(this.path);
    return { exists: value !== undefined, data: () => value };
  }
}
class Col {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, this.path + '/' + id); }
}
class FakeDb {
  constructor() { this.store = new Map(); }
  collection(name) { return new Col(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({
      get: ref => ref.get(),
      set: (ref, value, options) => writes.push([ref.path, value, options])
    });
    for (const [path, value] of writes) {
      this.store.set(path, { ...(this.store.get(path) || {}), ...value });
    }
    return result;
  }
}

const db = new FakeDb();
const base = { restaurantSlug: 'chez-awa', clientIp: '203.0.113.10', secret: 's'.repeat(64), now: 1_800_000_000_000 };
for (let i = 0; i < 5; i++) {
  const result = await consumePublicOrderRateLimit(db, base);
  assert.equal(result.allowed, true, 'first five takeaway orders are accepted');
}
const blocked = await consumePublicOrderRateLimit(db, base);
assert.equal(blocked.allowed, false, 'sixth request in the fixed window is rate-limited');
assert(blocked.retryAfterSeconds > 0, 'rate-limit response includes a retry delay');
assert.equal((await consumePublicOrderRateLimit(db, { ...base, clientIp: '203.0.113.11' })).allowed, true,
  'a different client IP has a separate quota');
assert.equal((await consumePublicOrderRateLimit(db, { ...base, restaurantSlug: 'restaurant-b' })).allowed, true,
  'each restaurant has an independent quota');
assert.equal((await consumePublicOrderRateLimit(db, { ...base, now: base.now + 600_000 })).allowed, true,
  'quota resets after the ten-minute window');
for (const value of db.store.values()) {
  assert(!JSON.stringify(value).includes('203.0.113.10'), 'raw client IP is never stored');
}
console.log('Public takeaway order rate-limit tests passed.');
