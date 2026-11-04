import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { computeOrderSignature, deriveIdempotencyIdentifiers } from '../src/server/orderService.ts';
import { executeOrderTransactionWithDb } from '../server.ts';

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
  const sessionHash = 'session-hash-' + Date.now();
  const qrTokenHash = 'qr-token-hash-' + Date.now();
  const restaurantRef = db.collection('restaurants').doc(slug);
  const tableRef = restaurantRef.collection('tables').doc(tableId);
  const sessionRef = restaurantRef.collection('table_sessions').doc(sessionHash);
  const qrRef = restaurantRef.collection('table_qr_tokens').doc(qrTokenHash);
  const createdRefs = [];

  function buildParams(key, mode = 'sur_place') {
    const { keyDocId, orderId, orderNumber } = deriveIdempotencyIdentifiers(slug, key);
    const cart = [{ menuItemId: 'dish-poulet', quantity: 1 }];
    const tableNumber = mode === 'sur_place' ? '4' : null;
    const signature = computeOrderSignature({ restaurantSlug: slug, orderMode: mode, tableNumber, cart });
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
    await restaurantRef.set({ slug, status: 'active', isActive: true, isOpen: true });
    await tableRef.set({ tableNumber: '4', isActive: true, qrVersion: 1 });
    await qrRef.set({ tokenHash: qrTokenHash, restaurantSlug: slug, tableId, version: 1, status: 'active' });
    await sessionRef.set({
      sessionHash, restaurantSlug: slug, tableId, tableNumber: '4', qrTokenHash,
      qrVersion: 1, csrfHash: 'a'.repeat(64), status: 'active',
      createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 60 * 60 * 1000
    });

    const valid = await executeOrderTransactionWithDb(db, buildParams('valid-session-' + Date.now()));
    assert(valid.success === true, 'Une session QR valide autorise la commande sur place dans la transaction');

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
  } finally {
    for (const ref of createdRefs) { try { await ref.delete(); } catch {} }
    try { await sessionRef.delete(); } catch {}
    try { await qrRef.delete(); } catch {}
    try { await tableRef.delete(); } catch {}
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
