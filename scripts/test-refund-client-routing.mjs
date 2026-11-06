import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const managerUi = fs.readFileSync(new URL('../src/components/manager/ManagerView.tsx', import.meta.url), 'utf8');
const paymentService = fs.readFileSync(new URL('../src/server/paymentService.ts', import.meta.url), 'utf8');

assert(app.includes("payment.paymentMethod === 'especes'"), 'cash refunds are selected by payment method');
assert(app.includes('refundCashPaymentWithServerValidation('), 'cash payments use the dedicated cash refund API');
assert(app.includes('refundPayDunyaPaymentWithServerValidation('), 'Mobile Money payments use the PayDunya refund API');
assert(firebase.includes("action: 'refund_cash_payment'"), 'cash refund client calls the cash refund backend action');
assert(firebase.includes("action: 'refund_paydunya_payment'"), 'PayDunya refund client calls the provider refund backend action');
assert(managerUi.includes('canRefundPayments && tx.refundEligible &&'), 'manager journal exposes every eligible refund, including cash');
assert(managerUi.includes('Confirmez-vous avoir remis physiquement'), 'cash refund requires operator handover confirmation in the UI');
assert(paymentService.includes("refundEligible: true"), 'cash payments are marked eligible for cash refunds');

console.log('Refund client routing checks passed.');
