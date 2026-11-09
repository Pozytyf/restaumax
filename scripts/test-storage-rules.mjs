import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({
  projectId: 'demo-restaumax',
  storage: { rules, host: '127.0.0.1', port: 9199 }
});

const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const upload = (storage, path, bytes = image, contentType = 'image/jpeg') =>
  uploadBytes(ref(storage, path), bytes, { contentType });

try {
  const ownerA = env.authenticatedContext('owner-a', {
    role: 'owner', restaurantSlug: 'rest-a'
  }).storage();
  const managerA = env.authenticatedContext('manager-a', {
    role: 'manager', restaurantSlug: 'rest-a', permissions: ['menu.manage']
  }).storage();
  const cashierA = env.authenticatedContext('cashier-a', {
    role: 'cashier', restaurantSlug: 'rest-a', permissions: ['pos.access']
  }).storage();
  const managerB = env.authenticatedContext('manager-b', {
    role: 'manager', restaurantSlug: 'rest-b', permissions: ['menu.manage']
  }).storage();
  const anonymous = env.unauthenticatedContext().storage();

  await assertSucceeds(upload(ownerA, 'restaurants/rest-a/menu/owner-dish.jpg'));
  await assertSucceeds(upload(managerA, 'restaurants/rest-a/menu/manager-dish.webp', image, 'image/webp'));
  await assertSucceeds(upload(ownerA, 'restaurants/rest-a/branding/logo.png', image, 'image/png'));

  await assertFails(upload(cashierA, 'restaurants/rest-a/menu/cashier-dish.jpg'));
  await assertFails(upload(managerB, 'restaurants/rest-a/menu/cross-tenant.jpg'));
  await assertFails(upload(managerA, 'restaurants/rest-a/branding/manager-logo.jpg'));
  await assertFails(upload(anonymous, 'restaurants/rest-a/menu/anonymous.jpg'));
  await assertFails(upload(ownerA, 'restaurants/rest-a/menu/not-an-image.pdf', image, 'application/pdf'));
  await assertFails(upload(ownerA, 'restaurants/rest-a/menu/too-large.jpg', new Uint8Array(5 * 1024 * 1024 + 1)));

  await assertSucceeds(getBytes(ref(anonymous, 'restaurants/rest-a/menu/owner-dish.jpg')));
  await assertFails(upload(ownerA, 'other/rest-a/menu/outside.jpg'));

  console.log('Firebase Storage tenant rules: 11 emulator assertions passed.');
} finally {
  await env.cleanup();
}
