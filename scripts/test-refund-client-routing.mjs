import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');

assert(app.includes("payment.paymentMethod === 'especes'"), 'cash refunds are selected by payment method');
assert(app.includes('refundCashPaymentWithServerValidation('), 'cash payments use the dedicated cash refund API');
assert(app.includes('refundPayDunyaPaymentWithServerValidation('), 'Mobile Money payments use the PayDunya refund API');
assert(firebase.includes("action: 'refund_cash_payment'"), 'cash refund client calls the cash refund backend action');
assert(firebase.includes("action: 'refund_paydunya_payment'"), 'PayDunya refund client calls the provider refund backend action');

console.log('Refund client routing checks passed.');
