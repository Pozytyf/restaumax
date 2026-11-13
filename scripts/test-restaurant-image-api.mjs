import assert from 'node:assert/strict';
import { createRestaurantImageHandler } from '../src/server/restaurantImageService.ts';

const restaurants = { 'rest-a': { status: 'active', ownerUid: 'owner-1' }, 'rest-suspended': { status: 'suspended', ownerUid: 'owner-1' } };
const members = {
  'owner-1': { active: true, role: 'owner', restaurantSlug: 'rest-a', sessionVersion: 2 },
  'owner-2': { active: true, role: 'owner', restaurantSlug: 'rest-a', sessionVersion: 1 },
  'manager-1': { active: true, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 4, permissions: ['menu.manage'] },
  'manager-2': { active: true, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 1, permissions: [] },
  'suspended-1': { active: false, role: 'manager', restaurantSlug: 'rest-a', sessionVersion: 1, permissions: ['menu.manage'] },
  'owner-suspended': { active: true, role: 'owner', restaurantSlug: 'rest-suspended', sessionVersion: 1 }
};
const tokens = {
  'owner-token': { uid: 'owner-1', sessionVersion: 2 }, 'manager-token': { uid: 'manager-1', sessionVersion: 4 },
  'manager-no-permission-token': { uid: 'manager-2', sessionVersion: 1 }, 'suspended-token': { uid: 'suspended-1', sessionVersion: 1 },
  'stale-session-token': { uid: 'manager-1', sessionVersion: 3 }, 'wrong-owner-token': { uid: 'owner-2', sessionVersion: 1 },
  'revoked-token': new Error('revoked'), 'owner-suspended-token': { uid: 'owner-suspended', sessionVersion: 1 }
};
const db = { collection(name) { return { doc(id) { return { async get() { const data = name === 'restaurants' ? restaurants[id] : name === 'managers' ? members[id] : null; return { exists: Boolean(data), data: () => data }; } }; } }; } };
const files = new Map([['image-file-id-12345', { filePath: '/restaurants/rest-a/menu/image-file-id-12345.jpg' }]]);
const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  if (url === 'https://upload.imagekit.io/api/v1/files/upload') {
    const file = options.body.get('file');
    assert.equal(file.type, 'image/jpeg');
    assert.equal(options.body.get('folder'), '/restaurants/rest-a/menu');
    const item = { fileId: 'image-file-id-12345', url: 'https://ik.imagekit.io/restaumaxdemo/restaurants/rest-a/menu/image.jpg', filePath: '/restaurants/rest-a/menu/image.jpg' };
    files.set(item.fileId, item);
    return { ok: true, status: 200, async json() { return item; } };
  }
  const id = decodeURIComponent(url.split('/').pop());
  if (options.method === 'DELETE') { files.delete(id); return { ok: true, status: 204, async json() { return {}; } }; }
  const item = files.get(id);
  return item ? { ok: true, status: 200, async json() { return item; } } : { ok: false, status: 404, async json() { return {}; } };
};
const handler = createRestaurantImageHandler({
  adminDb: db, imageKitPrivateKey: 'private_test_key', imageKitUrlEndpoint: 'https://ik.imagekit.io/restaumaxdemo',
  fetchImpl, adminAuth: { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    const value = tokens[token];
    if (value instanceof Error) throw Object.assign(value, { code: 'auth/id-token-revoked' });
    if (!value) throw Object.assign(new Error('invalid token'), { code: 'auth/invalid-id-token' });
    return value;
  } },
  requestHasValidOrigin: req => req.headers?.origin === 'https://restaumax.test',
  getRestaurantOwnerUid: async (_db, _slug, _tx, restaurant) => restaurant?.ownerUid || null,
  logger: { error() {} }
});
const request = (token, method = 'POST', origin = 'https://restaumax.test') => ({ method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin } });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const base = { restaurantSlug: 'rest-a', kind: 'menu', contentType: 'image/jpeg', size: jpeg.length, dataBase64: jpeg.toString('base64') };

assert.equal((await handler(base, request(null))).statusCode, 401);
assert.equal((await handler(base, request('owner-token', 'POST', 'https://evil.test'))).statusCode, 403);
const ownerUpload = await handler(base, request('owner-token'));
assert.equal(ownerUpload.statusCode, 201);
assert.equal(ownerUpload.body.path, 'image-file-id-12345');
assert.equal(ownerUpload.body.url, 'https://ik.imagekit.io/restaumaxdemo/restaurants/rest-a/menu/image.jpg');
assert.equal(calls.at(-1).options.headers.Authorization, 'Basic ' + Buffer.from('private_test_key:').toString('base64'));
assert.equal((await handler(base, request('manager-token'))).statusCode, 201);
assert.equal((await handler(base, request('manager-no-permission-token'))).statusCode, 403);
assert.equal((await handler(base, request('suspended-token'))).statusCode, 403);
assert.equal((await handler(base, request('stale-session-token'))).statusCode, 403);
assert.equal((await handler(base, request('wrong-owner-token'))).statusCode, 403);
assert.equal((await handler({ ...base, restaurantSlug: 'rest-suspended' }, request('owner-suspended-token'))).statusCode, 403);
assert.equal((await handler({ ...base, contentType: 'image/gif' }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, dataBase64: Buffer.from('not an image').toString('base64'), size: 12 }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, size: 3 * 1024 * 1024 + 1 }, request('owner-token'))).statusCode, 400);
assert.equal((await handler({ ...base, kind: 'branding' }, request('manager-token'))).statusCode, 403);
assert.equal((await handler({ ...base, path: 'image-file-id-12345' }, request('owner-token', 'DELETE'))).statusCode, 200);
assert.equal(files.has('image-file-id-12345'), false);
files.set('foreign-file-id-12345', { filePath: '/restaurants/rest-b/menu/photo.jpg' });
assert.equal((await handler({ ...base, path: 'foreign-file-id-12345' }, request('owner-token', 'DELETE'))).statusCode, 403);
assert.equal((await handler(base, request('revoked-token'))).statusCode, 401);
assert.equal((await handler(base, { method: 'GET', headers: { origin: 'https://restaumax.test' } })).statusCode, 405);
console.log('Restaurant ImageKit API authorization tests: 21 assertions passed.');
