import assert from 'node:assert/strict';
import fs from 'node:fs';

const modal = fs.readFileSync(new URL('../src/components/pos/PaymentModal.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');

assert(modal.includes('tenderedAmount > balanceDue'), 'Mobile Money accepts partial amounts up to the remaining balance');
assert(!modal.includes('tenderedAmount !== balanceDue'), 'Mobile Money no longer forces full-balance settlement');
assert(modal.includes('Vous pouvez régler tout ou partie du solde restant'), 'The POS explains partial Mobile Money payments');
assert(app.includes('paymentIdempotencyKey, paymentData.paidAmount'), 'POS sends the requested partial amount to the server');
assert(firebase.includes('idempotencyKey, amount'), 'Client request transmits the amount to the backend');
console.log('Partial Mobile Money UI checks passed.');
