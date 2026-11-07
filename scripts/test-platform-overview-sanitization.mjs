import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const start = source.indexOf("if (action === 'overview') {");
const end = source.indexOf("if (action === 'create_restaurant') {", start);
assert(start >= 0 && end > start, 'platform overview action exists');
const overview = source.slice(start, end);
assert(!overview.includes('...data'), 'overview does not spread arbitrary restaurant fields');
for (const privateField of ['ownerEmail:', 'ownerName:', 'phone:', 'address:']) {
  assert(!overview.includes(privateField), 'overview excludes private field ' + privateField);
}
assert(overview.includes('subscriptionsByStatus'), 'overview aggregates subscription status');
assert(overview.includes('subscriptionsByPlan'), 'overview aggregates subscription plans');
assert(overview.includes('monthlyRecurringRevenueFcfa'), 'overview reports normalized monthly recurring revenue');
assert(overview.includes("billingCycle === 'yearly'"), 'yearly subscriptions are normalized over twelve months');
console.log('Platform overview minimization and aggregate checks passed.');

const accountsStart = source.indexOf("if (action === 'staff_list' && isSuperAdmin(user)) {");
const accountsEnd = source.indexOf("// Owner and authorized manager staff administration", accountsStart);
assert(accountsStart >= 0 && accountsEnd > accountsStart, 'super-admin account audit exists before tenant staff authorization');
const accountAudit = source.slice(accountsStart, accountsEnd);
assert(accountAudit.includes("collection('managers').where('restaurantSlug', '==', slug)"), 'account audit reconciles global manager records for the selected restaurant');
assert(accountAudit.includes("collection('staff').get()"), 'account audit reads the restaurant staff subcollection');
assert(accountAudit.includes('restaurant.ownerUid') && accountAudit.includes('restaurant.ownerEmail'), 'account audit includes canonical owner identity fields');
assert(accountAudit.includes('emailConflict'), 'account audit flags conflicting email records');
assert(accountAudit.includes("actorRole: 'super_admin'") && accountAudit.includes('readOnly: true'), 'super-admin account audit is read-only');
assert(accountAudit.includes('accountLinked: false'), 'unlinked owner metadata is distinguished from an actual Firebase account');
console.log('Super-admin restaurant account audit and owner-email reconciliation checks passed.');
