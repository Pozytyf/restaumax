import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-restaumax',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
});
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'restaurants/rest-a'), {
      slug: 'rest-a', name: 'Restaurant A', isOpen: true, status: 'active'
    });
    await setDoc(doc(db, 'restaurants/rest-a/private/ownership'), { ownerUid: 'owner-a', ownerName: 'Owner A', ownerEmail: 'owner-a@example.test' });
    await setDoc(doc(db, 'managers/owner-a'), {
      uid: 'owner-a', role: 'owner', restaurantSlug: 'rest-a', active: true, sessionVersion: 0
    });
    await setDoc(doc(db, 'managers/owner-b'), {
      uid: 'owner-b', role: 'owner', restaurantSlug: 'rest-a', active: true, sessionVersion: 0
    });
    await setDoc(doc(db, 'restaurants/rest-a/orders/order-1'), {
      id: 'order-1', orderNumber: 'A-1', restaurantSlug: 'rest-a',
      orderMode: 'a_emporter', items: [{ id: 'line-1' }], totalAmount: 1000, status: 'pending'
    });
  });

  const anonymous = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous, 'restaurants/rest-a')));
  await assertFails(getDoc(doc(anonymous, 'restaurants/rest-a/private/ownership')));
  const ownerA = env.authenticatedContext('owner-a').firestore();
  const ownerB = env.authenticatedContext('owner-b').firestore();
  await assertSucceeds(getDoc(doc(ownerA, 'restaurants/rest-a')));
  await assertFails(getDoc(doc(ownerA, 'restaurants/rest-a/private/ownership')));
  await assertFails(updateDoc(doc(ownerA, 'restaurants/rest-a'), { ownerEmail: 'leak@example.test' }));
  await assertSucceeds(getDoc(doc(ownerB, 'restaurants/rest-a'))); // Restaurant profile is public; ownership metadata remains private.
  await assertSucceeds(updateDoc(doc(ownerA, 'restaurants/rest-a'), { name: 'Restaurant A modifié' }));
  await assertSucceeds(updateDoc(doc(ownerA, 'restaurants/rest-a'), {
    taxRatePercent: 18, taxMode: 'inclusive', loyaltyFcfaPerPoint: 500, receiptPaperWidth: '58mm'
  }));
  await assertFails(updateDoc(doc(ownerB, 'restaurants/rest-a'), {
    taxMode: 'exclusive', loyaltyFcfaPerPoint: 1000
  }));
  await assertFails(updateDoc(doc(ownerB, 'restaurants/rest-a'), { name: 'Tentative de prise de contrôle' }));
  await assertFails(updateDoc(doc(ownerA, 'restaurants/rest-a/orders/order-1'), { status: 'in_prep' }));
  await assertFails(updateDoc(doc(ownerB, 'restaurants/rest-a/orders/order-1'), { status: 'cancelled' }));
  console.log('Firestore ownerUid emulator tests passed.');
} finally {
  await env.cleanup();
}
