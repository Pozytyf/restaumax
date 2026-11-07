import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { processOrderSubmission } from '../src/server/orderService.ts';
import { getPosCartConfigurationKey, toClientCartItem } from '../src/utils/posCart.ts';
import { mapRestauOrderToKitchenTicket } from '../src/utils/kitchenTicket.ts';
import { executeOrderTransactionWithDb } from '../server.ts';
import { updateKitchenItemCompletionWithDb } from '../src/server/kitchenService.ts';
import { openCashSessionWithDb, recordCashPaymentWithDb } from '../src/server/paymentService.ts';
import { transitionOrderStatusWithDb } from '../src/server/orderLifecycleService.ts';

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

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const posViewSource = readFileSync(new URL('../src/components/pos/PosView.tsx', import.meta.url), 'utf8');
  const productModalSource = readFileSync(new URL('../src/components/restaumax/ProductDetailModal.tsx', import.meta.url), 'utf8');
  const cartLedgerSource = readFileSync(new URL('../src/components/pos/CartLedger.tsx', import.meta.url), 'utf8');
  const paymentModalSource = readFileSync(new URL('../src/components/pos/PaymentModal.tsx', import.meta.url), 'utf8');
  check((appSource.match(/cart\.map\(toClientCartItem\)/g) || []).length === 2,
    'Envoi cuisine et encaissement direct utilisent le même sérialiseur POS');
  check(posViewSource.includes('<ProductDetailModal') &&
    posViewSource.includes('onAddToCart={onAddToCart}') &&
    productModalSource.includes('map((group) => selectedOptionsByGroup[group.id])'),
    'Le POS ouvre le configurateur et sérialise les groupes dans l’ordre du catalogue');
  const optionOrderA = { groupId: 'side+cooking', optionId: 'rice+well' };
  const optionOrderB = { groupId: 'cooking+side', optionId: 'well+rice' };
  check(getPosCartConfigurationKey(optionOrderA, [{ extraId: 'sauce' }, { extraId: 'egg' }]) ===
    getPosCartConfigurationKey(optionOrderB, [{ extraId: 'egg' }, { extraId: 'sauce' }]),
    'Une configuration identique ne crée pas une ligne doublon selon l’ordre des clics');
  check(cartLedgerSource.includes('getPosCartLineUnitPrice(item)') &&
    paymentModalSource.includes('getPosCartLineUnitPrice(item)'),
    'Le panier et la fenêtre de paiement affichent le même prix configuré');
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
    const inventoryRef = restaurantRef.collection('inventoryItems').doc('rice');
    const recipeRef = restaurantRef.collection('menuRecipes').doc(menuItem.id);
    await inventoryRef.set({
      id: 'rice', name: 'Riz', unit: 'kg', quantity: 1, minQuantity: 0.1,
      unitCost: 500, active: true
    });
    await recipeRef.set({
      menuItemId: menuItem.id,
      lines: [{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.1 }]
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

    check(payload.cart[0].unitPrice === 6800 &&
      payload.cart[0].selectedOption?.optionId === 'rice+well' &&
      payload.cart[0].selectedExtras?.[0]?.extraId === 'sauce' &&
      payload.cart[0].prepNotes === 'Sauce à part',
      'Le sérialiseur POS commun conserve options, suppléments, note et prix indicatif');

    const missingRequiredResult = await processOrderSubmission({
      ...payload,
      idempotencyKey: 'integration-missing-required-' + suffix,
      cart: [{
        ...payload.cart[0],
        unitPrice: 6500,
        selectedOption: {
          groupId: 'side', groupName: 'Accompagnement',
          optionId: 'rice', optionName: 'Accompagnement: Riz', extraPrice: 500
        }
      }],
      declaredTotal: 6500
    }, provider);
    check(missingRequiredResult.success === false &&
      String(missingRequiredResult.error || '').includes('obligatoire'),
      'Le serveur refuse un plat POS si un groupe obligatoire est absent');

    const tamperedPriceResult = await processOrderSubmission({
      ...payload,
      idempotencyKey: 'integration-tampered-total-' + suffix,
      declaredTotal: 1
    }, provider);
    check(tamperedPriceResult.success === false &&
      String(tamperedPriceResult.error || '').includes('recalculé'),
      'Le serveur refuse un total POS falsifié');

    const minimalOptionalFieldsPayload = {
      ...payload,
      idempotencyKey: 'integration-optional-fields-' + suffix,
      declaredTotal: 5800,
      cart: [{
        ...payload.cart[0],
        unitPrice: 5800,
        selectedExtras: []
      }]
    };
    delete minimalOptionalFieldsPayload.cart[0].prepNotes;
    const minimalOptionalFieldsResult = await processOrderSubmission(minimalOptionalFieldsPayload, provider);
    check(minimalOptionalFieldsResult.success === true &&
      !Object.prototype.hasOwnProperty.call(minimalOptionalFieldsResult.order || {}, 'customerNote') &&
      !Object.prototype.hasOwnProperty.call(minimalOptionalFieldsResult.order?.items?.[0] || {}, 'prepNotes') &&
      !Object.prototype.hasOwnProperty.call(minimalOptionalFieldsResult.order?.items?.[0] || {}, 'selectedExtras'),
      'Une commande sans note ni supplément facultatif est enregistrée sans valeurs undefined Firestore');

    const clientPriceTampering = await processOrderSubmission({
      ...payload,
      idempotencyKey: 'integration-tampered-line-price-' + suffix,
      cart: [{
        ...payload.cart[0],
        unitPrice: 1,
        selectedOption: { ...payload.cart[0].selectedOption, extraPrice: 0 },
        selectedExtras: [{ extraId: 'sauce', name: 'Prix falsifié', price: 0 }]
      }]
    }, provider);
    if (!clientPriceTampering.success) {
      console.error('Détail du rejet de prix client :', clientPriceTampering.error || clientPriceTampering);
    } else {
      console.log('Résultat serveur après falsification client :', JSON.stringify({
        totalAmount: clientPriceTampering.order?.totalAmount,
        selectedOption: clientPriceTampering.order?.items?.[0]?.selectedOption,
        selectedExtras: clientPriceTampering.order?.items?.[0]?.selectedExtras
      }));
    }
    check(clientPriceTampering.success === true,
      'Le serveur accepte la commande après avoir ignoré les prix client');
    check(clientPriceTampering.order?.totalAmount === 6800,
      'Le total serveur reste calculé depuis le catalogue officiel');
    check(clientPriceTampering.order?.items?.[0]?.selectedExtras?.[0]?.name === 'Sauce maison' &&
      clientPriceTampering.order?.items?.[0]?.selectedExtras?.[0]?.price === 1000,
      'Le serveur remplace le libellé et le prix du supplément par ceux du catalogue');

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

    const startPreparation = await transitionOrderStatusWithDb(db, {
      restaurantSlug: slug, orderId, targetStatus: 'in_prep', actorUid: uid, sessionVersion: 7
    });
    check(startPreparation.success === true && startPreparation.stockLines === 1,
      'Le démarrage cuisine consomme la recette via une transaction serveur');
    const stockAfterStart = (await inventoryRef.get()).data();
    check(stockAfterStart.quantity === 0.9,
      'La consommation d’ingrédient est calculée à partir de la recette et de la quantité vendue');
    const startedOrder = (await restaurantRef.collection('orders').doc(orderId).get()).data();
    check(startedOrder?.stockTrackingStatus === 'partial' &&
      startedOrder?.stockUntrackedItemIds?.includes(menuItem.id),
      'Les options et suppléments sans nomenclature dédiée sont signalés comme stock partiellement suivi');

    const kitchenTicket = mapRestauOrderToKitchenTicket(startedOrder);
    check(kitchenTicket.items[0]?.notes?.includes('Options :') &&
      kitchenTicket.items[0]?.notes?.includes('Suppléments : Sauce maison') &&
      kitchenTicket.items[0]?.notes?.includes('Note : Sauce à part'),
      'Le ticket KDS affiche les options, suppléments et notes de préparation de la commande');

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
    const ready = await transitionOrderStatusWithDb(db, {
      restaurantSlug: slug, orderId, targetStatus: 'ready', actorUid: uid, sessionVersion: 7
    });
    check(ready.success === true && ready.status === 'ready',
      'La commande passe à prête seulement après pointage de toutes les lignes cuisine');

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
    const stockConsumptions = await restaurantRef.collection('stockOrderConsumptions').get().catch(() => null);
    if (stockConsumptions) for (const doc of stockConsumptions.docs) { try { await doc.ref.delete(); } catch {} }
    const stockMovements = await restaurantRef.collection('stockMovements').get().catch(() => null);
    if (stockMovements) for (const doc of stockMovements.docs) { try { await doc.ref.delete(); } catch {} }
    const inventoryItems = await restaurantRef.collection('inventoryItems').get().catch(() => null);
    if (inventoryItems) for (const doc of inventoryItems.docs) { try { await doc.ref.delete(); } catch {} }
    const recipes = await restaurantRef.collection('menuRecipes').get().catch(() => null);
    if (recipes) for (const doc of recipes.docs) { try { await doc.ref.delete(); } catch {} }
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
