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
    console.error('ÉCHEC : Firestore Emulator requis pour les tests QR/commandes transactionnels.');
    process.exit(1);
  }
run().catch((error) => {
  console.error('Échec inattendu des tests de transaction QR :', error);
  process.exitCode = 1;
});
