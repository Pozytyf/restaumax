import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

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

  await env.withSecurityRulesDisabled(async (context) => {
    await upload(context.storage(), 'restaurants/rest-a/menu/seed-dish.jpg');
    await upload(context.storage(), 'restaurants/rest-a/branding/seed-logo.jpg');
  });

  await assertSucceeds(getBytes(ref(anonymous, 'restaurants/rest-a/menu/seed-dish.jpg')));
  await assertSucceeds(getBytes(ref(anonymous, 'restaurants/rest-a/branding/seed-logo.jpg')));

  await assertFails(upload(ownerA, 'restaurants/rest-a/menu/owner-direct.jpg'));
  await assertFails(upload(managerA, 'restaurants/rest-a/menu/manager-direct.jpg'));
  await assertFails(upload(cashierA, 'restaurants/rest-a/menu/cashier-direct.jpg'));
  await assertFails(upload(managerB, 'restaurants/rest-a/menu/cross-tenant.jpg'));
  await assertFails(upload(ownerA, 'restaurants/rest-a/branding/owner-direct.jpg'));
  await assertFails(upload(anonymous, 'restaurants/rest-a/menu/anonymous.jpg'));
  await assertFails(upload(ownerA, 'restaurants/rest-a/menu/not-an-image.pdf', image, 'application/pdf'));
  await assertFails(upload(ownerA, 'restaurants/rest-a/menu/too-large.jpg', new Uint8Array(5 * 1024 * 1024 + 1)));
  await assertFails(deleteObject(ref(ownerA, 'restaurants/rest-a/menu/seed-dish.jpg')));
  await assertFails(upload(ownerA, 'other/rest-a/menu/outside.jpg'));

  console.log('Firebase Storage rules: 13 emulator assertions passed; clients cannot write directly.');
} finally {
  await env.cleanup();
}
