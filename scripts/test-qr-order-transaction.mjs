import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { computeOrderSignature, deriveIdempotencyIdentifiers } from '../src/server/orderService.ts';
import { executeOrderTransactionWithDb } from '../server.ts';
import { issueTableQr, resolveTableQr, getActiveTableSession, revokeTableQr } from '../src/server/tableSecurityService.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

async function run() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('QR ORDER TRANSACTION : ignoré (Firestore Emulator non actif).');
    return;
  }

  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const app = initializeApp({ projectId: 'demo-restaumax' }, 'restaumax-qr-order-security-tests');
  const db = getFirestore(app, config.firestoreDatabaseId);
  const slug = 'qr-security-' + Date.now();
  const tableId = 'table-4';
  const qrLifecycleTableId = 'qr-lifecycle';
  const sessionHash = 'session-hash-' + Date.now();
  const qrTokenHash = 'qr-token-hash-' + Date.now();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const qrLifecycleTableRef = restaurantRef.collection('tables').doc(qrLifecycleTableId);
  const staffRef = db.collection('managers').doc('staff-cashier-' + Date.now());
  const staffUid = staffRef.id;
  const tableRef = restaurantRef.collection('tables').doc(tableId);
  const sessionRef = restaurantRef.collection('table_sessions').doc(sessionHash);
  const qrRef = restaurantRef.collection('table_qr_tokens').doc(qrTokenHash);
  const createdRefs = [];

  function buildParams(key, mode = 'sur_place') {
    const { keyDocId, orderId, orderNumber } = deriveIdempotencyIdentifiers(slug, key);
    const cart = [{ menuItemId: 'dish-poulet', quantity: 1 }];
    const tableNumber = mode === 'sur_place' ? '4' : null;
    const signature = computeOrderSignature({ restaurantSlug: slug, orderMode: mode, tableNumber, idempotencyKey: key, cart });
    const orderToCreate = {
      id: orderId, orderNumber, restaurantSlug: slug, orderMode: mode, tableNumber,
      items: [{ menuItemId: 'dish-poulet', name: 'Poulet test', quantity: 1, unitPrice: 9500, totalLinePrice: 9500 }],
      itemsCount: 1, totalAmount: 9500, currency: 'FCFA', status: 'pending',
      createdAt: Date.now(), createdAtIso: new Date().toISOString(),
      idempotencyKey: key, idempotencyDocId: keyDocId, contentSignature: signature
    };
    createdRefs.push(
      db.collection('idempotency_keys').doc(keyDocId),
      restaurantRef.collection('orders').doc(orderId)
    );
    return {
      restaurantSlug: slug, idempotencyKey: key, keyDocId, orderId, signature, orderToCreate,
      ...(mode === 'sur_place' ? { tableSession: { sessionHash, qrTokenHash, qrVersion: 1, tableId } } : {})
    };
  }

  try {
    await restaurantRef.set({ slug, status: 'active', isActive: true, isOpen: true, tableSessionVersion: 0, ownerUid: 'owner-test' });
    await staffRef.set({ uid: staffUid, role: 'cashier', restaurantSlug: slug, permissions: ['pos.access'], active: true, sessionVersion: 0 });
    await tableRef.set({ tableNumber: '4', isActive: true, qrVersion: 1 });
    await qrRef.set({ tokenHash: qrTokenHash, restaurantSlug: slug, tableId, version: 1, status: 'active' });
    await sessionRef.set({
      sessionHash, restaurantSlug: slug, tableId, tableNumber: '4', qrTokenHash,
      qrVersion: 1, csrfHash: 'a'.repeat(64), restaurantSessionVersion: 0, status: 'active',
      createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 60 * 60 * 1000
    });

    // Real Firestore Emulator lifecycle: issue, resolve, revoke and concurrent rotation.
    await qrLifecycleTableRef.set({ id: qrLifecycleTableId, tableNumber: 'QR-Lifecycle', isActive: true, qrVersion: 0 });
    const issuedQr = await issueTableQr(db, slug, qrLifecycleTableId, 'https://restaumax.example');
    const resolvedQr = await resolveTableQr(db, issuedQr.token);
    assert((await getActiveTableSession(db, resolvedQr.sessionSecret))?.tableId === qrLifecycleTableId,
      'Le QR émis ouvre une session réelle liée à la bonne table dans Firestore Emulator');
    const revokedQr = await revokeTableQr(db, slug, qrLifecycleTableId);
    assert(revokedQr.versionAdvanced === true && revokedQr.revoked === 1,
      'La révocation transactionnelle invalide le QR et avance la version de table');
    assert(await getActiveTableSession(db, resolvedQr.sessionSecret) === null,
      'La révocation transactionnelle invalide immédiatement la session QR existante');
    let revokedTokenRejected = false;
    try { await resolveTableQr(db, issuedQr.token); } catch { revokedTokenRejected = true; }
    assert(revokedTokenRejected, 'Un jeton QR révoqué ne peut plus créer de session');

    const concurrentResults = await Promise.all([
      issueTableQr(db, slug, qrLifecycleTableId, 'https://restaumax.example'),
      revokeTableQr(db, slug, qrLifecycleTableId)
    ]);
    const lifecycleTokens = await restaurantRef.collection('table_qr_tokens').where('tableId', '==', qrLifecycleTableId).get();
    const activeLifecycleTokens = lifecycleTokens.docs.filter((doc) => doc.data()?.status === 'active');
    const lifecycleTable = await qrLifecycleTableRef.get();
    assert(activeLifecycleTokens.length <= 1,
      'Une émission et une révocation concurrentes ne peuvent jamais laisser plusieurs QR actifs');
    assert(activeLifecycleTokens.every((doc) => Number(doc.data()?.version) === Number(lifecycleTable.data()?.qrVersion)),
      'Tout QR restant actif correspond exactement à la version courante de la table');
    assert(concurrentResults.length === 2, 'Les opérations concurrentes d’émission et de révocation se terminent');

    const valid = await executeOrderTransactionWithDb(db, buildParams('valid-session-' + Date.now()));
    assert(valid.success === true, 'Une session QR valide autorise la commande sur place dans la transaction');

    await restaurantRef.update({ tableSessionVersion: 1 });
    const staleRestaurantSession = await executeOrderTransactionWithDb(db, buildParams('stale-restaurant-session-' + Date.now()));
    assert(staleRestaurantSession.success === false, 'Une session antérieure à la suspension du restaurant est refusée dans la transaction');
    await restaurantRef.update({ tableSessionVersion: 0 });

    await qrRef.update({ status: 'revoked' });
    const revoked = await executeOrderTransactionWithDb(db, buildParams('revoked-qr-' + Date.now()));
    assert(revoked.success === false && revoked.error?.includes('QR révoqué'), 'Un QR révoqué bloque la commande dans la transaction');

    await qrRef.update({ status: 'active' });
    await sessionRef.update({ expiresAt: Date.now() - 1000 });
    const expired = await executeOrderTransactionWithDb(db, buildParams('expired-session-' + Date.now()));
    assert(expired.success === false, 'Une session expirée bloque la commande dans la transaction');

    await sessionRef.update({ expiresAt: Date.now() + 60 * 60 * 1000 });
    await tableRef.update({ isActive: false });
    const inactiveTable = await executeOrderTransactionWithDb(db, buildParams('inactive-table-' + Date.now()));
    assert(inactiveTable.success === false, 'Une table inactive bloque la commande dans la transaction');

    await tableRef.update({ isActive: true });
    await restaurantRef.update({ isOpen: false });
    const closedRestaurant = await executeOrderTransactionWithDb(db, buildParams('closed-restaurant-' + Date.now()));
    assert(closedRestaurant.success === false, 'Un restaurant fermé bloque la commande dans la transaction');

    const missingSession = await executeOrderTransactionWithDb(db, {
      ...buildParams('missing-session-' + Date.now()),
      tableSession: undefined
    });
    assert(missingSession.success === false, 'Une commande sur place sans contexte de session est refusée');

    await restaurantRef.update({ isOpen: true });
    const staffOrderParams = buildParams('staff-order-' + Date.now());
    const staffOrder = await executeOrderTransactionWithDb(db, {
      ...staffOrderParams,
      tableSession: undefined,
      staffOrder: true,
      staffActorUid: staffUid,
      staffSessionVersion: 0,
      staffTableId: tableId
    });
    assert(staffOrder.success === true, 'Une commande sur place du personnel authentifié peut être enregistrée sans session QR' + (staffOrder.error ? ' — ' + staffOrder.error : ''));

    await staffRef.update({ permissions: [] });
    const deniedStaffParams = buildParams('staff-no-pos-permission-' + Date.now());
    const deniedStaffOrder = await executeOrderTransactionWithDb(db, {
      ...deniedStaffParams,
      tableSession: undefined,
      staffOrder: true,
      staffActorUid: staffUid,
      staffSessionVersion: 0,
      staffTableId: tableId
    });
    assert(deniedStaffOrder.success === false, 'Une commande POS est refusée si la permission pos.access a été retirée');
    await staffRef.update({ permissions: ['pos.access'] });

    const wrongStaffTableParams = buildParams('staff-wrong-table-' + Date.now());
    wrongStaffTableParams.orderToCreate.tableNumber = '999';
    const wrongStaffTable = await executeOrderTransactionWithDb(db, {
      ...wrongStaffTableParams,
      tableSession: undefined,
      staffOrder: true,
      staffActorUid: staffUid,
      staffSessionVersion: 0,
      staffTableId: tableId
    });
    assert(wrongStaffTable.success === false, 'Une commande POS est refusée si le numéro de table ne correspond pas à la table validée');

    await tableRef.update({ isActive: false });
    const inactiveStaffTableParams = buildParams('staff-inactive-table-' + Date.now());
    const inactiveStaffTable = await executeOrderTransactionWithDb(db, {
      ...inactiveStaffTableParams,
      tableSession: undefined,
      staffOrder: true,
      staffActorUid: staffUid,
      staffSessionVersion: 0,
      staffTableId: tableId
    });
    assert(inactiveStaffTable.success === false, 'Une commande POS est refusée si la table devient inactive avant la transaction');
    await tableRef.update({ isActive: true });

    // Both public customer order modes must be rejected when the restaurant closes.
    await restaurantRef.update({ isOpen: false, status: 'active', deletedAt: null });
    const closedTakeaway = await executeOrderTransactionWithDb(
      db,
      buildParams('takeaway-closed-' + Date.now(), 'a_emporter')
    );
    assert(closedTakeaway.success === false && closedTakeaway.error?.includes('fermé'),
      'Une commande à emporter est refusée dans la transaction lorsque le restaurant est fermé');
    const closedQr = await executeOrderTransactionWithDb(db, buildParams('qr-closed-' + Date.now()));
    assert(closedQr.success === false,
      'Une commande QR sur place reste refusée lorsque le restaurant est fermé');
    await restaurantRef.update({ isOpen: true });

    await restaurantRef.update({ isOpen: true, status: 'deleted', deletedAt: Date.now() });
    const deletedRestaurant = await executeOrderTransactionWithDb(db, buildParams('deleted-restaurant-' + Date.now()));
    assert(deletedRestaurant.success === false, 'Un restaurant supprimé logiquement ne peut plus recevoir de commande');

    // Les commandes à emporter doivent également échouer pour tout statut non actif,
    // même lorsqu'aucune session QR n'est impliquée.
    for (const status of ['provisioning', 'suspended', 'deleted', 'pending_review']) {
      await restaurantRef.update({ status, isOpen: true, deletedAt: status === 'deleted' ? Date.now() : null });
      const nonActiveTakeaway = await executeOrderTransactionWithDb(
        db,
        buildParams('takeaway-' + status + '-' + Date.now(), 'a_emporter')
      );
      assert(nonActiveTakeaway.success === false, 'Une commande à emporter est refusée avec le statut restaurant ' + status);
    }
  } finally {
    for (const ref of createdRefs) { try { await ref.delete(); } catch {} }
    try { await sessionRef.delete(); } catch {}
    try { await qrRef.delete(); } catch {}
    try {
      const qrTokens = await restaurantRef.collection('table_qr_tokens').where('tableId', '==', qrLifecycleTableId).get();
      await Promise.all(qrTokens.docs.map((doc) => doc.ref.delete()));
      const qrSessions = await restaurantRef.collection('table_sessions').where('tableId', '==', qrLifecycleTableId).get();
      await Promise.all(qrSessions.docs.map((doc) => doc.ref.delete()));
    } catch {}
    try { await qrLifecycleTableRef.delete(); } catch {}
    try { await tableRef.delete(); } catch {}
    try { await staffRef.delete(); } catch {}
    try { await restaurantRef.delete(); } catch {}
    try { await app.delete(); } catch {}
  }

  console.log('Résultats transaction QR : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
  if (failed) process.exitCode = 1;
}
run().catch((error) => {
  console.error('Échec inattendu des tests de transaction QR :', error);
  process.exitCode = 1;
});
