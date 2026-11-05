import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const start = source.indexOf("if (action === 'overview') {");
const end = source.indexOf("if (action === 'create_restaurant') {", start);
assert(start >= 0 && end > start, 'platform overview action exists');
const overview = source.slice(start, end);
assert(!overview.includes('...data'), 'overview does not spread arbitrary restaurant fields');
for (const privateField of ['ownerEmail', 'ownerName', 'phone', 'address']) {
  assert(!overview.includes(privateField), 'overview excludes private field ' + privateField);
}
assert(overview.includes('subscriptionsByStatus'), 'overview aggregates subscription status');
assert(overview.includes('subscriptionsByPlan'), 'overview aggregates subscription plans');
assert(overview.includes('monthlyRecurringRevenueFcfa'), 'overview reports normalized monthly recurring revenue');
assert(overview.includes("billingCycle === 'yearly'"), 'yearly subscriptions are normalized over twelve months');
console.log('Platform overview minimization and aggregate checks passed.');
