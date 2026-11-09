import assert from 'node:assert/strict';
import { createRestaurantImageHandler } from '../src/server/restaurantImageService.ts';

const restaurantData = {
  'rest-a': { status: 'active', ownerUid: 'owner-1' },
  'rest-suspended': { status: 'suspended', ownerUid: 'owner-1' }
};
const members = {
  'owner-1': { active: true, role: 'owner', restaurantSlug: 'rest-a', sessionVersion: 2 },
  'owner-2': { active: true, role: 'owner', restaurantSlug: 'rest-a', sessionVersion: 1 },
  'manager-1': { active: true, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 4, permissions: ['menu.manage'] },
  'manager-2': { active: true, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 1, permissions: [] },
  'suspended-1': { active: false, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 1, permissions: ['menu.manage'] },
  'owner-suspended': { active: true, role: 'owner', restaurantSlug: 'rest-suspended', sessionVersion: 1 }
};
const tokens = {
  'owner-token': { uid: 'owner-1', sessionVersion: 2 },
  'manager-token': { uid: 'manager-1', sessionVersion: 4 },
  'manager-no-permission-token': { uid: 'manager-2', sessionVersion: 1 },
  'suspended-token': { uid: 'suspended-1', sessionVersion: 1 },
  'stale-session-token': { uid: 'manager-1', sessionVersion: 3 },
  'wrong-owner-token': { uid: 'owner-2', sessionVersion: 1 },
  'revoked-token': new Error('revoked'),
  'owner-suspended-token': { uid: 'owner-suspended', sessionVersion: 1 }
};
const saved = new Map();
const deleted = [];
const db = {
  collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            const data = name === 'restaurants' ? restaurantData[id] : name === 'managers' ? members[id] : null;
            return { exists: Boolean(data), data: () => data };
          }
        };
      }
    };
  }
};
const storage = {
  file(path) {
    return {
      async save(bytes, options) { saved.set(path, { bytes, options }); },
      async delete(options) { deleted.push({ path, options }); }
    };
  }
};
const handler = createRestaurantImageHandler({
  adminDb: db,
  adminStorage: storage,
  adminAuth: {
    async verifyIdToken(token, checkRevoked) {
      assert.equal(checkRevoked, true, 'revocation must be checked');
      const value = tokens[token];
      if (value instanceof Error) throw Object.assign(value, { code: 'auth/id-token-revoked' });
      if (!value) throw Object.assign(new Error('invalid token'), { code: 'auth/invalid-id-token' });
      return value;
    }
  },
  requestHasValidOrigin: req => req.headers?.origin === 'https://restaumax.test',
  getRestaurantOwnerUid: async (_db, _slug, _tx, restaurant) => restaurant?.ownerUid || null,
  logger: { error() {} }
});
const request = (token, method = 'POST', origin = 'https://restaumax.test') => ({
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin }
});
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const base = { restaurantSlug: 'rest-a', kind: 'menu', contentType: 'image/jpeg', size: jpeg.length, dataBase64: jpeg.toString('base64') };

assert.equal((await handler(base, request(null))).statusCode, 401);
assert.equal((await handler(base, request('owner-token', 'POST', 'https://evil.test'))).statusCode, 403);

const ownerUpload = await handler(base, request('owner-token'));
assert.equal(ownerUpload.statusCode, 201);
assert.match(ownerUpload.body.path, /^restaurants\/rest-a\/menu\/[A-Za-z0-9_-]{1,80}\.jpg$/);
assert.equal(saved.get(ownerUpload.body.path).bytes.toString('hex'), jpeg.toString('hex'));
assert.ok(saved.get(ownerUpload.body.path).options.metadata.metadata.firebaseStorageDownloadTokens);

const webp = Buffer.from('RIFF0000WEBP');
assert.equal((await handler({
  ...base, contentType: 'image/webp', size: webp.length, dataBase64: webp.toString('base64')
}, request('manager-token'))).statusCode, 201);

assert.equal((await handler(base, request('manager-no-permission-token'))).statusCode, 403);
assert.equal((await handler(base, request('suspended-token'))).statusCode, 403);
assert.equal((await handler(base, request('stale-session-token'))).statusCode, 403);
assert.equal((await handler(base, request('wrong-owner-token'))).statusCode, 403);
assert.equal((await handler({ ...base, restaurantSlug: 'rest-suspended' }, request('owner-suspended-token'))).statusCode, 403);
assert.equal((await handler({ ...base, contentType: 'image/gif' }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, dataBase64: Buffer.from('not an image').toString('base64'), size: 12 }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, size: 3 * 1024 * 1024 + 1 }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, kind: 'branding' }, request('manager-token'))).statusCode, 403);
assert.equal((await handler({ ...base, path: 'restaurants/rest-a/menu/old-photo.jpg' }, request('owner-token', 'DELETE'))).statusCode, 200);
assert.equal(deleted.length, 1);
assert.equal((await handler({ ...base, path: 'restaurants/rest-b/menu/other.jpg' }, request('owner-token', 'DELETE'))).statusCode, 400);
assert.equal((await handler(base, request('revoked-token'))).statusCode, 401);
assert.equal((await handler(base, { method: 'GET', headers: { origin: 'https://restaumax.test' } })).statusCode, 405);

console.log('Restaurant image API authorization tests: 21 assertions passed.');
