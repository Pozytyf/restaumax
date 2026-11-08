import assert from 'node:assert/strict';
import { uploadMenuImageWithDb } from '../src/server/menuImageService.ts';

const records = new Map([
  ['restaurants/restaurant-a', { status: 'active', ownerUid: 'owner-a' }],
  ['restaurants/restaurant-b', { status: 'active', ownerUid: 'owner-b' }],
  ['managers/owner-a', { active: true, restaurantSlug: 'restaurant-a', role: 'owner', sessionVersion: 4 }],
  ['managers/manager-a', { active: true, restaurantSlug: 'restaurant-a', role: 'manager', permissions: ['menu.manage'], sessionVersion: 4 }],
  ['managers/manager-no-menu', { active: true, restaurantSlug: 'restaurant-a', role: 'manager', permissions: ['inventory.manage'], sessionVersion: 4 }],
  ['managers/owner-wrong', { active: true, restaurantSlug: 'restaurant-a', role: 'owner', sessionVersion: 4 }]
]);
const db = {
  collection(name) {
    return { doc(id) {
      const path = name + '/' + id;
      return { async get() { const value = records.get(path); return { exists: value !== undefined, data: () => value }; } };
    } };
  }
};
const saved = [];
const bucket = {
  name: 'restaumax-demo.firebasestorage.app',
  file(path) {
    return { async save(buffer, options) { saved.push({ path, buffer, options }); } };
  }
};
const auth = { async verifyIdToken(token, checkRevoked) {
  assert.equal(token, 'valid-test-token');
  assert.equal(checkRevoked, true);
  return { uid: 'manager-a', sessionVersion: 4 };
} };
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const request = (uid='manager-a') => ({
  method: 'POST', headers: { authorization: 'Bearer valid-test-token', origin: 'https://restaumax.vercel.app' },
  uid
});
const payload = (restaurantSlug='restaurant-a', mimeType='image/png', bytes=png) => ({
  restaurantSlug, dishId: 'dish-42', mimeType, base64: bytes.toString('base64')
});
const deps = (uid='manager-a', slug='restaurant-a', bytes=png, mimeType='image/png', origin=true) => ({
  db, auth: { verifyIdToken: async () => ({ uid, sessionVersion: 4 }) }, bucket,
  payload: payload(slug,mimeType,bytes), req: request(uid), originValidator: () => origin
});

const success = await uploadMenuImageWithDb(deps());
assert.equal(success.statusCode, 200);
assert.equal(success.body.success, true);
assert.match(success.body.path, /^restaurants\/restaurant-a\/menu\/dish-42\//);
assert.match(success.body.url, /^https:\/\/firebasestorage\.googleapis\.com\//);
assert.equal(saved.length, 1);
assert.equal(saved[0].options.metadata.metadata.restaurantSlug, 'restaurant-a');
assert.ok(saved[0].options.metadata.metadata.firebaseStorageDownloadTokens, 'Public download is tokenized, not bucket-wide');
const crossTenant = await uploadMenuImageWithDb(deps('manager-a','restaurant-b'));
assert.equal(crossTenant.statusCode, 403);
assert.equal(saved.length, 1, 'Cross-tenant upload must not write any object');
const noPermission = await uploadMenuImageWithDb({ ...deps('manager-no-menu'), auth: { verifyIdToken: async()=>({uid:'manager-no-menu',sessionVersion:4}) } });
assert.equal(noPermission.statusCode, 403);
const wrongOwner = await uploadMenuImageWithDb({ ...deps('owner-wrong'), auth: { verifyIdToken: async()=>({uid:'owner-wrong',sessionVersion:4}) } });
assert.equal(wrongOwner.statusCode, 403, 'Owner role is insufficient without matching restaurant.ownerUid');
const badOrigin = await uploadMenuImageWithDb(deps('manager-a','restaurant-a',png,'image/png',false));
assert.equal(badOrigin.statusCode, 403);
const fakePng = await uploadMenuImageWithDb(deps('manager-a','restaurant-a',Buffer.from('not-a-png'),'image/png'));
assert.equal(fakePng.statusCode, 400, 'MIME spoofing is rejected by signature validation');
const wrongMime = await uploadMenuImageWithDb(deps('manager-a','restaurant-a',png,'image/jpeg'));
assert.equal(wrongMime.statusCode, 400);
const tooLarge = await uploadMenuImageWithDb(deps('manager-a','restaurant-a',Buffer.alloc(3*1024*1024+1,1),'image/png'));
assert.equal(tooLarge.statusCode, 413);
const noBucket = await uploadMenuImageWithDb({ ...deps(), bucket: null });
assert.equal(noBucket.statusCode, 503);
console.log('Tenant-scoped menu image upload tests passed: manager scope, owner binding, origin, MIME, signature and size.');
