import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordCashPaymentWithDb, listRecentCashPaymentsWithDb, openCashSessionWithDb, closeCashSessionWithDb, getCashSessionWithDb, recordCashMovementWithDb } from '../src/server/paymentService.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

async function run() {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const managerViewSource = readFileSync(new URL('../src/components/manager/ManagerView.tsx', import.meta.url), 'utf8');
  const headerSource = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  assert(
    headerSource.includes('canAccessCash || permissions.includes') &&
    appSource.includes("canAccessCash={isRestaurantOwner || userPermissions.includes('cash.view') || userPermissions.includes('cash.manage')}"),
    'La navigation affiche l’espace caisse aux propriétaires et gérants autorisés'
  );
  assert(
    appSource.includes("const canViewCashForCashPanel = isRestaurantOwner ||") &&
    appSource.includes("userPermissions.includes('cash.view') || userPermissions.includes('cash.manage')"),
    'Le module caisse reste accessible aux propriétaires et gérants autorisés même sans permission explicite redondante'
  );
  assert(
    managerViewSource.includes('Fond de caisse disponible') &&
    managerViewSource.includes('cashSession.openingBalance + cashSession.cashCollected - cashSession.cashOut'),
    'Le tiroir affiche le fond de caisse disponible calculé depuis la session persistée'
  );
  assert(
    managerViewSource.includes('Clôturer la session et rapprocher') &&
    managerViewSource.includes('onCloseCashSession(amount)'),
    'Le responsable dispose d’une action visible de clôture avec comptage physique'
  );
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('ÉCHEC : Firestore Emulator requis pour les tests de caisse et sessions.');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-cash-payment-tests');
  const db = getFirestore(app, config.firestoreDatabaseId);
  const slug = 'cash-test-' + Date.now();
  const uid = 'cashier-' + Date.now();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(uid);
  const managerNoCashUid = 'manager-no-cash-' + Date.now();
  const managerNoCashRef = db.collection('managers').doc(managerNoCashUid);
  const orderRef = restaurantRef.collection('orders').doc('order-main');
  const concurrentOrderRef = restaurantRef.collection('orders').doc('order-concurrent');
  const cancelledOrderRef = restaurantRef.collection('orders').doc('order-cancelled');
  const splitOrderRef = restaurantRef.collection('orders').doc('order-split');

  const input = (orderId, amountTendered, idempotencyKey, sessionVersion = 3, actorUid = uid) => ({
    restaurantSlug: slug, orderId, actorUid, sessionVersion, amountTendered, idempotencyKey
  });

  try {
    await restaurantRef.set({ slug, status: 'active', isActive: true, ownerUid: 'owner-test', loyaltyFcfaPerPoint: 1000 });
    await memberRef.set({
      uid, role: 'cashier', restaurantSlug: slug, permissions: ['cash.manage', 'cash.view'],
      active: true, sessionVersion: 3
    });
    await managerNoCashRef.set({
      uid: managerNoCashUid, role: 'manager', restaurantSlug: slug, permissions: ['payments.refund'],
      active: true, sessionVersion: 3
    });
    await orderRef.set({
      id: 'order-main', orderNumber: '#CMD-001', restaurantSlug: slug, orderMode: 'sur_place',
      tableNumber: '4', totalAmount: 9500, subtotalAmount: 9500, taxAmount: 0, paidAmount: 0, currency: 'FCFA', status: 'pending',
      customerName: 'Client Fidélité', customerPhone: '07 00 00 00 01', customerPhoneNormalized: '0700000001',
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
    await splitOrderRef.set({
      id: 'order-split', orderNumber: '#CMD-004', restaurantSlug: slug, orderMode: 'sur_place',
      tableNumber: '4', totalAmount: 10000, paidAmount: 0, currency: 'FCFA', status: 'pending',
      items: [{ name: 'Repas partagé test', quantity: 1, unitPrice: 10000 }]
    });

    console.log('\n--- Ouverture et contrôle de session de caisse ---');
    const managerOpenDenied = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: managerNoCashUid, actorName: 'Manager sans caisse',
      sessionVersion: 3, openingBalance: 2000, idempotencyKey: 'manager-open-without-cash-manage'
    });
    assert(managerOpenDenied.success === false, 'Un manager sans cash.manage ne peut pas ouvrir une session');
    const managerPaymentDenied = await recordCashPaymentWithDb(db,
      input('order-main', 1000, 'manager-pay-without-cash-manage', 3, managerNoCashUid));
    assert(managerPaymentDenied.success === false, 'Un manager sans cash.manage ne peut pas encaisser');
    const noSession = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-no-session-01'));
    assert(noSession.success === false, 'Un encaissement est refusé tant que le caissier ne possède pas de session ouverte');
    await memberRef.update({ permissions: [] });
    const deniedOpen = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, openingBalance: 2000, idempotencyKey: 'open-cash-no-perm-01'
    });
    assert(deniedOpen.success === false, 'Un caissier sans cash.manage ne peut pas ouvrir une session');
    await memberRef.update({ permissions: ['cash.manage', 'cash.view'] });
    const opened = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, openingBalance: 2000, idempotencyKey: 'open-cash-session-001'
    });
    assert(opened.success === true && opened.session?.status === 'active' &&
      opened.session?.openingBalance === 2000, 'Une session s’ouvre avec un fond de caisse initial enregistré');
    const openReplay = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, openingBalance: 2000, idempotencyKey: 'open-cash-session-001'
    });
    assert(openReplay.success === true && openReplay.idempotentReplay === true,
      'Le rejeu de la même ouverture retourne la session existante sans doublon');
    const secondOpen = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, openingBalance: 1000, idempotencyKey: 'open-cash-session-002'
    });
    assert(secondOpen.success === false && secondOpen.conflict === true,
      'Une deuxième session simultanée pour le même caissier est bloquée');
    const activeSession = await getCashSessionWithDb(db, slug, uid);
    assert(activeSession?.id === opened.session?.id, 'La session active est récupérable côté serveur');

    console.log('\n--- Encaissement partiel et idempotence ---');
    const partial = await recordCashPaymentWithDb(db, input('order-main', 3000, 'cash-partial-0001'));
    const noEarlyLoyalty = await restaurantRef.collection('customers').where('phoneNormalized', '==', '0700000001').get();
    assert(noEarlyLoyalty.empty, 'Aucun point n’est attribué tant que le solde de la commande reste partiel');
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
    const replayDenied = await recordCashPaymentWithDb(db, input('order-main', 3000, 'cash-partial-0001'));
    assert(replayDenied.success === false, 'Un paiement rejoué ne révèle pas le reçu si la permission a été retirée');
    const deniedPermission = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-no-perm-0001'));
    assert(deniedPermission.success === false, 'Un caissier sans cash.manage ne peut pas encaisser');
    await memberRef.update({ permissions: ['cash.manage', 'cash.view'] });

    const staleSession = await recordCashPaymentWithDb(db, input('order-main', 1000, 'cash-stale-session-1', 2));
    assert(staleSession.success === false, 'Une ancienne version de session du personnel est refusée');

    const excessiveTender = await recordCashPaymentWithDb(db, input('order-main', 100_000_001, 'cash-excessive-01'));
    assert(excessiveTender.success === false, 'Un montant remis hors limite est rejeté avant transaction');

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
    const loyaltyCustomers = await restaurantRef.collection('customers').where('phoneNormalized', '==', '0700000001').get();
    assert(loyaltyCustomers.size === 1 && loyaltyCustomers.docs[0].data().loyaltyPoints === 9,
      'Les points sont attribués automatiquement une seule fois au paiement intégral');
    assert(finalPayment.order?.loyaltyPointsAwarded === 9,
      'La commande conserve le nombre de points attribués');
    const loyaltyLedger = await restaurantRef.collection('loyaltyLedger').where('orderId', '==', 'order-main').get();
    assert(loyaltyLedger.size === 1, 'Le journal de fidélité conserve une seule écriture par commande');

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

    console.log('\n--- Sorties de caisse et rapprochement ---');
    const overspend = await recordCashMovementWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, movementType: 'withdrawal', amount: 20000,
      category: 'retrait', note: 'Retrait supérieur au disponible', idempotencyKey: 'cash-overspend-01'
    });
    assert(overspend.success === false, 'Une sortie supérieure au solde théorique disponible est refusée');
    const expense = await recordCashMovementWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, movementType: 'expense', amount: 500,
      category: 'achats', note: 'Achat de charbon', idempotencyKey: 'cash-expense-0001'
    });
    assert(expense.success === true && expense.session?.cashOut === 500 &&
      expense.session?.cashMovementCount === 1,
      'Une dépense est enregistrée et déduite du solde de la session');
    const expenseReplay = await recordCashMovementWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, movementType: 'expense', amount: 500,
      category: 'achats', note: 'Achat de charbon', idempotencyKey: 'cash-expense-0001'
    });
    assert(expenseReplay.success === true && expenseReplay.idempotentReplay === true &&
      expenseReplay.session?.cashOut === 500,
      'Le rejeu idempotent d’une dépense ne double pas la sortie');
    const sessionWithJournal = await getCashSessionWithDb(db, slug, uid);
    assert(sessionWithJournal?.cashMovements?.length === 1 &&
      sessionWithJournal.cashMovements[0].amount === 500 &&
      sessionWithJournal.cashMovements[0].category === 'achats',
      'Le serveur restitue le détail du journal des sorties de la session active');
    const expenseConflict = await recordCashMovementWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, movementType: 'expense', amount: 700,
      category: 'achats', note: 'Autre montant', idempotencyKey: 'cash-expense-0001'
    });
    assert(expenseConflict.success === false && expenseConflict.conflict === true,
      'Une même clé ne peut pas servir à enregistrer une sortie différente');

    console.log('\n--- Clôture et rapprochement de caisse ---');
    const closed = await closeCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, closingCount: 14000, idempotencyKey: 'close-cash-session-001'
    });
    assert(closed.success === true && closed.session?.status === 'closed' &&
      closed.session?.expectedCash === 14000 && closed.session?.variance === 0,
      'La clôture calcule le solde théorique après sorties et l’écart avec le comptage physique');
    const closeReplay = await closeCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, closingCount: 14000, idempotencyKey: 'close-cash-session-001'
    });
    assert(closeReplay.success === true && closeReplay.idempotentReplay === true,
      'Le rejeu de la même clôture retourne le même rapport sans nouvelle écriture');
    const closeConflict = await closeCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, closingCount: 13900, idempotencyKey: 'close-cash-session-001'
    });
    assert(closeConflict.success === false && closeConflict.conflict === true,
      'Une même clé de clôture ne peut pas être rejouée avec un comptage différent');
    const afterClose = await getCashSessionWithDb(db, slug, uid);
    assert(afterClose === null, 'Une session clôturée n’est plus considérée comme active');
    const paymentAfterClose = await recordCashPaymentWithDb(db, input('order-concurrent', 1000, 'cash-after-close-01'));
    assert(paymentAfterClose.success === false, 'Aucun nouvel encaissement n’est accepté après clôture');
    console.log('\n--- Factures individuelles par convive ---');
    const splitSession = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, openingBalance: 1000, idempotencyKey: 'open-split-session-01'
    });
    assert(splitSession.success === true, 'Une nouvelle session peut être ouverte après clôture de la précédente');

    const guestOne = await recordCashPaymentWithDb(db, {
      ...input('order-split', 4000, 'split-guest-one-01'),
      splitGuests: 3, guestNumber: 1, guestName: 'Awa'
    });
    assert(guestOne.success === true && guestOne.payment?.paidAmount === 3334 &&
      guestOne.payment?.changeAmount === 666 && guestOne.order?.guestAccounts?.[0]?.shareAmount === 3334,
      'Le premier convive reçoit sa part arrondie et la monnaie est calculée correctement');
    const splitCountConflict = await recordCashPaymentWithDb(db, {
      ...input('order-split', 1000, 'split-count-change-01'),
      splitGuests: 2, guestNumber: 2, guestName: 'Koffi'
    });
    assert(splitCountConflict.success === false && splitCountConflict.conflict === true,
      'Le nombre de convives ne peut pas changer après le premier règlement');
    const guestOneOverpay = await recordCashPaymentWithDb(db, {
      ...input('order-split', 100, 'split-guest-one-extra'),
      splitGuests: 3, guestNumber: 1, guestName: 'Awa'
    });
    assert(guestOneOverpay.success === false, 'Un convive déjà réglé ne peut pas être encaissé une seconde fois');

    const guestTwoPartial = await recordCashPaymentWithDb(db, {
      ...input('order-split', 2000, 'split-guest-two-a'),
      splitGuests: 3, guestNumber: 2, guestName: 'Koffi'
    });
    assert(guestTwoPartial.success === true && guestTwoPartial.payment?.paidAmount === 2000 &&
      guestTwoPartial.payment?.guestRemainingAfter === 1333,
      'Un sous-compte accepte un paiement partiel indépendant');
    const guestTwoFinal = await recordCashPaymentWithDb(db, {
      ...input('order-split', 1333, 'split-guest-two-b'),
      splitGuests: 3, guestNumber: 2, guestName: 'Koffi'
    });
    assert(guestTwoFinal.success === true && guestTwoFinal.payment?.guestRemainingAfter === 0,
      'Le deuxième convive peut solder uniquement sa propre part');
    const guestThree = await recordCashPaymentWithDb(db, {
      ...input('order-split', 3333, 'split-guest-three'),
      splitGuests: 3, guestNumber: 3, guestName: 'Mariam'
    });
    assert(guestThree.success === true && guestThree.order?.paymentStatus === 'paid' &&
      guestThree.order?.paidAmount === 10000,
      'Le dernier règlement clôture la commande commune et les trois sous-comptes');
    const guestThreeReplay = await recordCashPaymentWithDb(db, {
      ...input('order-split', 3333, 'split-guest-three'),
      splitGuests: 3, guestNumber: 3, guestName: 'Mariam'
    });
    assert(guestThreeReplay.success === true && guestThreeReplay.idempotentReplay === true,
      'Le rejeu idempotent d’un paiement individuel ne crée pas de doublon');
    const splitAccounts = guestThree.order?.guestAccounts || [];
    assert(splitAccounts.length === 3 &&
      splitAccounts[0].paidAmount === 3334 &&
      splitAccounts[1].paidAmount === 3333 &&
      splitAccounts[2].paidAmount === 3333 &&
      splitAccounts[0].guestName === 'Awa' &&
      splitAccounts[1].guestName === 'Koffi' &&
      splitAccounts[2].guestName === 'Mariam',
      'Les trois sous-comptes conservent leur nom et leur règlement individuel');

    const splitClose = await closeCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Caissier Test',
      sessionVersion: 3, closingCount: 11000, idempotencyKey: 'close-split-session-01'
    });
    assert(splitClose.success === true && splitClose.session?.expectedCash === 11000 &&
      splitClose.session?.variance === 0,
      'La caisse rapproche correctement les encaissements des trois convives');

    const cashSessions = await restaurantRef.collection('cashSessions').get();
    const cashMovements = await restaurantRef.collection('cashMovements').get();
    assert(cashSessions.size === 2 &&
      cashSessions.docs.some((doc) => doc.data().paymentCount === 3 && doc.data().cashOut === 500) &&
      cashSessions.docs.some((doc) => doc.data().paymentCount === 4 && doc.data().cashCollected === 10000) &&
      cashMovements.size === 1 && cashMovements.docs[0].data().amount === 500,
      'L’historique conserve les encaissements et mouvements des deux sessions');

    console.log('\nRésultats paiements espèces : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
    if (failed) process.exitCode = 1;
  } finally {
    const payments = await restaurantRef.collection('payments').get().catch(() => null);
    if (payments) for (const doc of payments.docs) { try { await doc.ref.delete(); } catch {} }
    const idem = await db.collection('payment_idempotency').where('restaurantSlug', '==', slug).get().catch(() => null);
    if (idem) for (const doc of idem.docs) { try { await doc.ref.delete(); } catch {} }
    const sessions = await restaurantRef.collection('cashSessions').get().catch(() => null);
    if (sessions) for (const doc of sessions.docs) { try { await doc.ref.delete(); } catch {} }
    const movements = await restaurantRef.collection('cashMovements').get().catch(() => null);
    if (movements) for (const doc of movements.docs) { try { await doc.ref.delete(); } catch {} }
    const activeSessions = await restaurantRef.collection('cashSessionActive').get().catch(() => null);
    if (activeSessions) for (const doc of activeSessions.docs) { try { await doc.ref.delete(); } catch {} }
    for (const ref of [orderRef, concurrentOrderRef, cancelledOrderRef, splitOrderRef, memberRef, managerNoCashRef, restaurantRef]) {
      try { await ref.delete(); } catch {}
    }
    try { await app.delete(); } catch {}
  }
}

run().catch((error) => {
  console.error('Échec inattendu des tests de paiements espèces :', error);
  process.exitCode = 1;
});
