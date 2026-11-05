import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordCashPaymentWithDb, listRecentCashPaymentsWithDb } from '../src/server/paymentService.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

async function run() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('CASH PAYMENTS : ignoré (Firestore Emulator non actif).');
    return;
  }

  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-cash-payment-tests');
  const db = getFirestore(app, config.firestoreDatabaseId);
  const slug = 'cash-test-' + Date.now();
  const uid = 'cashier-' + Date.now();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(uid);
  const orderRef = restaurantRef.collection('orders').doc('order-main');
  const concurrentOrderRef = restaurantRef.collection('orders').doc('order-concurrent');
  const cancelledOrderRef = restaurantRef.collection('orders').doc('order-cancelled');

  const input = (orderId, amountTendered, idempotencyKey, sessionVersion = 3, actorUid = uid) => ({
    restaurantSlug: slug, orderId, actorUid, sessionVersion, amountTendered, idempotencyKey
  });

  try {
    await restaurantRef.set({ slug, status: 'active', isActive: true, ownerUid: 'owner-test' });
    await memberRef.set({
      uid, role: 'cashier', restaurantSlug: slug, permissions: ['cash.manage', 'cash.view'],
      active: true, sessionVersion: 3
    });
    await orderRef.set({
      id: 'order-main', orderNumber: '#CMD-001', restaurantSlug: slug, orderMode: 'sur_place',
      tableNumber: '4', totalAmount: 9500, paidAmount: 0, currency: 'FCFA', status: 'pending',
      items: [{ name: 'Poulet test', quantity: 1, unitPrice: 9500 }]
    });
    await concurrentOrderRef.set({
      id: 'order-concurrent', orderNumber: '#CMD-002', restaurantSlug: slug, orderMode: 'a_emporter',
      tableNumber: null, totalAmount: 10000, paidAmount: 0, currency: 'FCFA', status: 'pending',
      items: [{ name: 'Garba test', quantity: 1, unitPrice: 10000 }]
    });
    await cancelledOrderRef.set({
      id: 'order-cancelled', orderNumber: '#CMD-003', restaurantSlug: slug,
      totalAmount: 5000, paidAmount: 0, currency: 'FCFA', status: 'cancelled', items: []
    });

    console.log('\n--- Encaissement partiel et idempotence ---');
    const partial = await recordCashPaymentWithDb(db, input('order-main', 3000, 'cash-partial-0001'));
    assert(partial.success === true && partial.payment?.paidAmount === 3000 &&
      partial.order?.remainingAmount === 6500 && partial.order?.paymentStatus === 'partial',
      'Un encaissement partiel enregistre le montant reçu et le solde restant');

    const replay = await recordCashPaymentWithDb(db, input('order-main', 3000, 'cash-partial-0001'));
    assert(replay.success === true && replay.idempotentReplay === true &&
      replay.payment?.id === partial.payment?.id,
      'Un rejeu avec la même clé retourne le même paiement sans doublon');

    const conflict = await recordCashPaymentWithDb(db, input('order-main', 4000, 'cash-partial-0001'));
    assert(conflict.success === false && conflict.conflict === true,
      'Une même clé avec un montant différent est rejetée');

    console.log('\n--- Contrôles de permission et de session ---');
    await memberRef.update({ permissions: [] });
    const deniedPermission = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-no-perm-0001'));
    assert(deniedPermission.success === false, 'Un caissier sans cash.manage ne peut pas encaisser');
    await memberRef.update({ permissions: ['cash.manage', 'cash.view'] });

    const staleSession = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-stale-session-1', 2));
    assert(staleSession.success === false, 'Une ancienne version de session du personnel est refusée');

    await memberRef.update({ active: false });
    const suspended = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-suspended-001'));
    assert(suspended.success === false, 'Un compte personnel suspendu ne peut pas encaisser');
    await memberRef.update({ active: true });

    console.log('\n--- Solde, monnaie et état final ---');
    const finalPayment = await recordCashPaymentWithDb(db, input('order-main', 7000, 'cash-final-0001'));
    assert(finalPayment.success === true && finalPayment.payment?.paidAmount === 6500 &&
      finalPayment.payment?.changeAmount === 500 && finalPayment.order?.remainingAmount === 0 &&
      finalPayment.order?.paymentStatus === 'paid',
      'Le paiement final règle le solde exact et calcule la monnaie à rendre');

    const alreadyPaid = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-after-paid-01'));
    assert(alreadyPaid.success === false, 'Une commande déjà réglée ne peut pas être encaissée une seconde fois');

    const cancelled = await recordCashPaymentWithDb(db, input('order-cancelled', 1000, 'cash-cancelled-01'));
    assert(cancelled.success === false, 'Une commande annulée ne peut pas être encaissée');

    console.log('\n--- Concurrence et journal de caisse ---');
    const concurrentResults = await Promise.all([
      recordCashPaymentWithDb(db, input('order-concurrent', 3000, 'cash-concurrent-01')),
      recordCashPaymentWithDb(db, input('order-concurrent', 3000, 'cash-concurrent-01'))
    ]);
    const concurrentPayments = await restaurantRef.collection('payments').where('orderId', '==', 'order-concurrent').get();
    const concurrentOrder = (await concurrentOrderRef.get()).data();
    assert(concurrentResults.every(x => x.success) &&
      concurrentResults.filter(x => x.idempotentReplay).length === 1 &&
      concurrentPayments.size === 1 && concurrentOrder?.paidAmount === 3000,
      'Deux requêtes concurrentes avec la même clé ne créent qu’un seul encaissement');

    const recent = await listRecentCashPaymentsWithDb(db, slug, 100);
    assert(recent.length === 3, 'Le journal retourne les trois encaissements réellement persistés');

    console.log('\nRésultats paiements espèces : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
    if (failed) process.exitCode = 1;
  } finally {
    const payments = await restaurantRef.collection('payments').get().catch(() => null);
    if (payments) for (const doc of payments.docs) { try { await doc.ref.delete(); } catch {} }
    const idem = await db.collection('payment_idempotency').where('restaurantSlug', '==', slug).get().catch(() => null);
    if (idem) for (const doc of idem.docs) { try { await doc.ref.delete(); } catch {} }
    for (const ref of [orderRef, concurrentOrderRef, cancelledOrderRef, memberRef, restaurantRef]) {
      try { await ref.delete(); } catch {}
    }
    try { await app.delete(); } catch {}
  }
}

run().catch((error) => {
  console.error('Échec inattendu des tests de paiements espèces :', error);
  process.exitCode = 1;
});
