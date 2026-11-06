import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { processOrderSubmission } from '../src/server/orderService.ts';
import { executeOrderTransactionWithDb } from '../server.ts';
import { updateKitchenItemCompletionWithDb } from '../src/server/kitchenService.ts';
import { openCashSessionWithDb, recordCashPaymentWithDb } from '../src/server/paymentService.ts';

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('  ✓ ' + message);
}

async function run() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('ORDER → KDS → CASH : ignoré (Firestore Emulator non actif).');
    return;
  }

  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-order-kds-cash-' + Date.now());
  const db = getFirestore(app, config.firestoreDatabaseId);
  const suffix = Date.now().toString();
  const slug = 'integration-' + suffix;
  const uid = 'manager-' + suffix;
  const restaurantRef = db.collection('restaurants').doc(slug);
  const memberRef = db.collection('managers').doc(uid);
  const menuItem = {
    id: 'dish-integration', restaurantSlug: slug, name: 'Plat intégration',
    category: 'plats', price: 5000, available: true, description: 'Test transversal',
    optionGroups: [], availableExtras: []
  };

  try {
    await restaurantRef.set({
      slug, name: 'Restaurant intégration', status: 'active', isActive: true,
      isOpen: true, ownerUid: 'owner-' + suffix
    });
    await memberRef.set({
      uid, role: 'manager', restaurantSlug: slug,
      permissions: ['pos.access', 'kitchen.access', 'orders.manage', 'cash.manage', 'cash.view'],
      active: true, sessionVersion: 7
    });

    const payload = {
      restaurantSlug: slug,
      orderMode: 'a_emporter',
      tableNumber: null,
      customerNote: 'Test transversal POS-KDS-caisse',
      idempotencyKey: 'integration-order-' + suffix,
      declaredTotal: 5000,
      cart: [{
        id: 'cart-line-1', menuItemId: menuItem.id, name: menuItem.name,
        basePrice: 5000, unitPrice: 5000, quantity: 1, selectedExtras: []
      }]
    };
    const provider = {
      async getMenuItems() { return [menuItem]; },
      async getTables() { return []; },
      async executeOrderTransaction(params) {
        return executeOrderTransactionWithDb(db, {
          ...params,
          staffOrder: true,
          staffActorUid: uid,
          staffSessionVersion: 7
        });
      }
    };

    console.log('\n--- Création réelle de la commande POS ---');
    const created = await processOrderSubmission(payload, provider);
    check(created.success === true && Boolean(created.order?.id),
      'Le POS crée une commande validée depuis le catalogue officiel');
    const orderId = created.order.id;

    const replay = await processOrderSubmission(payload, provider);
    check(replay.success === true && replay.idempotentReplay === true && replay.order.id === orderId,
      'Le rejeu de commande retourne le même document sans doublon');

    console.log('\n--- Transmission et progression KDS ---');
    const kitchen = await updateKitchenItemCompletionWithDb(db, {
      restaurantSlug: slug, orderId, itemId: `ki-${orderId}-0`, itemIndex: 0,
      completed: true, actorUid: uid, sessionVersion: 7
    });
    check(kitchen.success === true && kitchen.completedCount === 1,
      'Le KDS met à jour une ligne de la commande persistée');
    const afterKitchen = (await restaurantRef.collection('orders').doc(orderId).get()).data();
    check(afterKitchen?.kitchenItemCompletion?.['0'] === true &&
      afterKitchen?.kitchenItemsCompletedCount === 1,
      'La progression cuisine est conservée dans le document Firestore de la commande');

    console.log('\n--- Encaissement et rapprochement ---');
    const opened = await openCashSessionWithDb(db, {
      restaurantSlug: slug, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, openingBalance: 1000, idempotencyKey: 'integration-open-' + suffix
    });
    check(opened.success === true && opened.session?.status === 'active',
      'Le manager autorisé ouvre sa session de caisse');

    const partial = await recordCashPaymentWithDb(db, {
      restaurantSlug: slug, orderId, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, amountTendered: 2000, idempotencyKey: 'integration-pay-a-' + suffix
    });
    check(partial.success === true && partial.order?.paidAmount === 2000 &&
      partial.order?.remainingAmount === 3000 && partial.order?.paymentStatus === 'partial',
      'Un premier encaissement partiel met à jour la commande sans créer une nouvelle commande');

    const final = await recordCashPaymentWithDb(db, {
      restaurantSlug: slug, orderId, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, amountTendered: 3000, idempotencyKey: 'integration-pay-b-' + suffix
    });
    check(final.success === true && final.order?.paidAmount === 5000 &&
      final.order?.remainingAmount === 0 && final.order?.paymentStatus === 'paid',
      'Le second encaissement solde exactement la même commande');

    const persisted = (await restaurantRef.collection('orders').doc(orderId).get()).data();
    const payments = await restaurantRef.collection('payments').where('orderId', '==', orderId).get();
    const cashSession = await restaurantRef.collection('cashSessions').doc(opened.session.id).get();
    check(persisted?.kitchenItemCompletion?.['0'] === true &&
      persisted?.kitchenItemsCompletedCount === 1 && persisted?.paidAmount === 5000,
      'Les écritures caisse ne détruisent pas la progression KDS déjà enregistrée');
    check(payments.size === 2 && cashSession.data()?.cashCollected === 5000,
      'Le journal de paiements et le solde de caisse concordent avec les deux encaissements');

    const replayPayment = await recordCashPaymentWithDb(db, {
      restaurantSlug: slug, orderId, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, amountTendered: 3000, idempotencyKey: 'integration-pay-b-' + suffix
    });
    check(replayPayment.success === true && replayPayment.idempotentReplay === true && payments.size === 2,
      'Le rejeu d’un paiement ne double pas le journal ni le montant encaissé');

    console.log(`\nRésultats intégration POS → KDS → caisse : ${passed}/${passed} réussis.`);
  } finally {
    const payments = await restaurantRef.collection('payments').get().catch(() => null);
    if (payments) for (const doc of payments.docs) { try { await doc.ref.delete(); } catch {} }
    const orders = await restaurantRef.collection('orders').get().catch(() => null);
    if (orders) for (const doc of orders.docs) { try { await doc.ref.delete(); } catch {} }
    const sessions = await restaurantRef.collection('cashSessions').get().catch(() => null);
    if (sessions) for (const doc of sessions.docs) { try { await doc.ref.delete(); } catch {} }
    const active = await restaurantRef.collection('cashSessionActive').get().catch(() => null);
    if (active) for (const doc of active.docs) { try { await doc.ref.delete(); } catch {} }
    const keys = await db.collection('idempotency_keys').where('restaurantSlug', '==', slug).get().catch(() => null);
    if (keys) for (const doc of keys.docs) { try { await doc.ref.delete(); } catch {} }
    const paymentKeys = await db.collection('payment_idempotency').where('restaurantSlug', '==', slug).get().catch(() => null);
    if (paymentKeys) for (const doc of paymentKeys.docs) { try { await doc.ref.delete(); } catch {} }
    for (const ref of [memberRef, restaurantRef]) { try { await ref.delete(); } catch {} }
    try { await app.delete(); } catch {}
  }
}

run().catch((error) => {
  console.error('Échec du parcours transversal POS → KDS → caisse :', error);
  process.exitCode = 1;
});
