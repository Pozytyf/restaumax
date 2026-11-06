import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { processOrderSubmission } from '../src/server/orderService.ts';
import { toClientCartItem } from '../src/utils/posCart.ts';
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
    optionGroups: [
      { id: 'side', name: 'Accompagnement', required: true, options: [
        { id: 'rice', name: 'Riz', extraPrice: 500 },
        { id: 'alloco', name: 'Alloco', extraPrice: 800 }
      ] },
      { id: 'cooking', name: 'Cuisson', required: true, options: [
        { id: 'medium', name: 'À point', extraPrice: 0 },
        { id: 'well', name: 'Bien cuit', extraPrice: 300 }
      ] }
    ],
    availableExtras: [
      { id: 'sauce', name: 'Sauce maison', price: 1000 },
      { id: 'egg', name: 'Œuf', price: 500 }
    ]
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
      idempotencyKey: 'integration-order-' + suffix,
      declaredTotal: 6800,
      cart: [toClientCartItem({
        id: 'cart-line-1',
        menuItem: {
          id: menuItem.id,
          name: menuItem.name,
          category: 'plats',
          price: 5000,
          description: menuItem.description,
          imageUrl: '',
          available: true,
          prepTimeMinutes: 15,
          course: 'plat',
          optionGroups: menuItem.optionGroups,
          availableExtras: menuItem.availableExtras
        },
        quantity: 1,
        selectedOption: {
          groupId: 'side+cooking',
          groupName: 'Accompagnement / Cuisson',
          optionId: 'rice+well',
          optionName: 'Accompagnement: Riz · Cuisson: Bien cuit',
          extraPrice: 800
        },
        selectedExtras: [
          { extraId: 'sauce', name: 'Sauce maison', price: 1000 }
        ],
        specialInstructions: 'Sauce à part',
        course: 'plat'
      })]
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
    if (!created.success) console.error('Détail du refus de création POS :', created.error || created);
    check(created.success === true && Boolean(created.order?.id),
      'Le POS crée une commande validée depuis le catalogue officiel' + (created.error ? ' — ' + created.error : ''));
    const orderId = created.order.id;
    const createdLine = created.order.items[0];
    check(createdLine.basePrice === 5000 && createdLine.unitPrice === 6800 &&
      createdLine.totalPrice === 6800,
      'Le serveur recalcule le prix depuis le catalogue : base 5 000 + options 800 + supplément 1 000');
    check(createdLine.selectedOption?.groupId === 'side+cooking' &&
      createdLine.selectedOption?.optionId === 'rice+well' &&
      createdLine.selectedExtras?.length === 1 &&
      createdLine.selectedExtras?.[0]?.extraId === 'sauce' &&
      createdLine.prepNotes === 'Sauce à part',
      'Les deux groupes obligatoires, le supplément et la note sont persistés sans perte');

    const replay = await processOrderSubmission(payload, provider);
    check(replay.success === true && replay.idempotentReplay === true &&
      replay.order.id === orderId && replay.order.items[0].selectedOption?.optionId === 'rice+well' &&
      replay.order.items[0].selectedExtras?.[0]?.extraId === 'sauce',
      'Le rejeu de commande retourne le même document configuré sans doublon');

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
      sessionVersion: 7, amountTendered: 2800, idempotencyKey: 'integration-pay-a-' + suffix
    });
    check(partial.success === true && partial.order?.paidAmount === 2800 &&
      partial.order?.remainingAmount === 4000 && partial.order?.paymentStatus === 'partial',
      'Un premier encaissement partiel met à jour la commande configurée sans la recréer');

    const final = await recordCashPaymentWithDb(db, {
      restaurantSlug: slug, orderId, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, amountTendered: 4000, idempotencyKey: 'integration-pay-b-' + suffix
    });
    check(final.success === true && final.order?.paidAmount === 6800 &&
      final.order?.remainingAmount === 0 && final.order?.paymentStatus === 'paid',
      'Le second encaissement solde exactement la même commande');

    const persisted = (await restaurantRef.collection('orders').doc(orderId).get()).data();
    const payments = await restaurantRef.collection('payments').where('orderId', '==', orderId).get();
    const cashSession = await restaurantRef.collection('cashSessions').doc(opened.session.id).get();
    check(persisted?.kitchenItemCompletion?.['0'] === true &&
      persisted?.kitchenItemsCompletedCount === 1 && persisted?.paidAmount === 6800 &&
      persisted?.items?.[0]?.selectedOption?.optionId === 'rice+well' &&
      persisted?.items?.[0]?.selectedExtras?.[0]?.extraId === 'sauce' &&
      persisted?.items?.[0]?.prepNotes === 'Sauce à part',
      'Les écritures caisse ne détruisent pas la progression KDS déjà enregistrée');
    check(payments.size === 2 && cashSession.data()?.cashCollected === 6800,
      'Le journal de paiements et le solde de caisse concordent avec les deux encaissements');

    const replayPayment = await recordCashPaymentWithDb(db, {
      restaurantSlug: slug, orderId, actorUid: uid, actorName: 'Manager intégration',
      sessionVersion: 7, amountTendered: 4000, idempotencyKey: 'integration-pay-b-' + suffix
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
