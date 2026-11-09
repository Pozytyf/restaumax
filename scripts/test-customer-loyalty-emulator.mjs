import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adjustCustomerLoyaltyPointsWithDb } from '../src/server/loyaltyService.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('ÉCHEC : Firestore Emulator requis pour les tests de fidélité client.');
  process.exit(1);
}
const app = initializeApp({ projectId: 'demo-restaumax' }, 'customer-loyalty-emulator-test');
const db = getFirestore(app);
const slug = 'customer-loyalty-emulator';
const ownerUid = 'customer-loyalty-owner';
const managerUid = 'customer-loyalty-manager';
const cashierUid = 'customer-loyalty-cashier';
const managerWithoutGrantUid = 'customer-loyalty-manager-no-grant';
const otherTenantManagerUid = 'customer-loyalty-other-tenant';
const customerId = 'customer-loyalty-target';
const restaurantRef = db.collection('restaurants').doc(slug);
const customerRef = restaurantRef.collection('customers').doc(customerId);

const input = (actorUid, delta, idempotencyKey, sessionVersion = 1, reason = 'Bonus service client') => ({
  restaurantSlug: slug, customerId, delta, reason, idempotencyKey,
  actorUid, sessionVersion, now: 1794000000000
});

try {
  await Promise.all([
    restaurantRef.set({ slug, status: 'active', ownerUid }),
    restaurantRef.collection('private').doc('ownership').set({ ownerUid }),
    db.collection('managers').doc(ownerUid).set({
      uid: ownerUid, role: 'owner', restaurantSlug: slug, active: true, sessionVersion: 1
    }),
    db.collection('managers').doc(managerUid).set({
      uid: managerUid, role: 'manager', restaurantSlug: slug, active: true,
      sessionVersion: 1, permissions: ['customers.view', 'customers.manage']
    }),
    db.collection('managers').doc(cashierUid).set({
      uid: cashierUid, role: 'cashier', restaurantSlug: slug, active: true,
      sessionVersion: 1, permissions: ['customers.manage']
    }),
    db.collection('managers').doc(managerWithoutGrantUid).set({
      uid: managerWithoutGrantUid, role: 'manager', restaurantSlug: slug, active: true,
      sessionVersion: 1, permissions: ['customers.view']
    }),
    db.collection('managers').doc(otherTenantManagerUid).set({
      uid: otherTenantManagerUid, role: 'manager', restaurantSlug: 'another-tenant', active: true,
      sessionVersion: 1, permissions: ['customers.manage']
    }),
    customerRef.set({ id: customerId, name: 'Client Test', phone: '+2250700000000', phoneNormalized: '0700000000', loyaltyPoints: 4 })
  ]);

  const [first, concurrentReplay] = await Promise.all([
    adjustCustomerLoyaltyPointsWithDb(db, input(ownerUid, 1, 'customer-loyalty-request-0001')),
    adjustCustomerLoyaltyPointsWithDb(db, input(ownerUid, 1, 'customer-loyalty-request-0001'))
  ]);
  assert.equal(first.success, true, 'Le propriétaire peut attribuer un point via le serveur');
  assert.equal(concurrentReplay.success, true, 'Le second appel concurrent est accepté comme rejeu idempotent');
  const balanceAfterReplay = (await customerRef.get()).data().loyaltyPoints;
  assert.equal(balanceAfterReplay, 5, 'Deux appels simultanés avec la même clé ne créditent qu’une fois');

  const conflict = await adjustCustomerLoyaltyPointsWithDb(db, input(ownerUid, 2, 'customer-loyalty-request-0001'));
  assert.equal(conflict.success, false, 'Une clé idempotente réutilisée avec un autre delta est refusée');
  assert.equal(conflict.conflict, true);

  const managerGrant = await adjustCustomerLoyaltyPointsWithDb(db, input(managerUid, 2, 'customer-loyalty-request-0002'));
  assert.equal(managerGrant.success, true, 'Un manager avec customers.manage peut attribuer des points');
  assert.equal(managerGrant.points, 7);

  const cashierGrant = await adjustCustomerLoyaltyPointsWithDb(db, input(cashierUid, 1, 'customer-loyalty-request-0003'));
  assert.equal(cashierGrant.success, false, 'Un caissier ne peut pas ajuster les points même si une permission est falsifiée');

  const managerWithoutGrant = await adjustCustomerLoyaltyPointsWithDb(db, input(managerWithoutGrantUid, 1, 'customer-loyalty-request-0006'));
  assert.equal(managerWithoutGrant.success, false, 'Un manager sans customers.manage ne peut pas ajuster les points');

  const otherTenant = await adjustCustomerLoyaltyPointsWithDb(db, input(otherTenantManagerUid, 1, 'customer-loyalty-request-0007'));
  assert.equal(otherTenant.success, false, 'Un manager d’un autre restaurant ne peut pas modifier ce client');

  const staleSession = await adjustCustomerLoyaltyPointsWithDb(db, input(managerUid, 1, 'customer-loyalty-request-0004', 0));
  assert.equal(staleSession.success, false, 'Une session avec sessionVersion obsolète est refusée');

  const belowZero = await adjustCustomerLoyaltyPointsWithDb(db, input(ownerUid, -100, 'customer-loyalty-request-0005'));
  assert.equal(belowZero.success, false, 'Le solde ne peut pas devenir négatif');
  assert.equal((await customerRef.get()).data().loyaltyPoints, 7, 'Les opérations refusées ne modifient pas le solde');

  const ledger = await restaurantRef.collection('loyaltyLedger').get();
  assert.equal(ledger.size, 2, 'Chaque ajustement réussi crée une seule entrée de journal');
  assert.equal(ledger.docs.every(doc => doc.data().source === 'manual_adjustment'), true,
    'Le journal distingue les ajustements manuels des points gagnés sur commande');

  console.log('Customer loyalty Firestore Emulator tests passed: 15 assertions.');
} finally {
  await app.delete();
}
