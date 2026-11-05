import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveRolePermissions } from '../src/server/platformAdmin.ts';

const owner = resolveRolePermissions('owner', []);
assert(owner?.includes('payments.refund'), 'owner has operational refund authority');
const manager = resolveRolePermissions('manager', []);
assert(manager?.includes('payments.refund'), 'manager has fundamental refund authority');
assert(manager?.includes('orders.cancel'), 'manager has fundamental cancellation authority');
const cashier = resolveRolePermissions('cashier', []);
assert(!cashier?.includes('payments.refund'), 'cashier does not receive refund authority by default');
assert(!cashier?.includes('orders.cancel'), 'cashier does not receive cancellation authority by default');
assert(resolveRolePermissions('cashier', ['payments.refund'])?.includes('payments.refund'), 'owner may explicitly grant cashier refund');
assert(resolveRolePermissions('cashier', ['orders.cancel'])?.includes('orders.cancel'), 'owner may separately grant cashier cancellation');
assert.equal(resolveRolePermissions('server', ['payments.refund']), null);
assert.equal(resolveRolePermissions('kitchen', ['payments.refund']), null);

const adminSource = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const staffUiSource = fs.readFileSync(new URL('../src/components/restaumax/StaffManagementView.tsx', import.meta.url), 'utf8');
assert(staffUiSource.includes("'orders.cancel','payments.refund','reports.view'"), 'staff UI exposes manager cancellation and refund permissions consistently');
const firestoreRules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const managerRule = firestoreRules.match(/role == 'manager' && permission in \[([\s\S]*?)\]\)/)?.[1] || '';
assert(managerRule.includes("'orders.cancel'") && managerRule.includes("'payments.refund'"), 'Firestore manager ceiling includes cancellation and refund permissions');
assert(adminSource.includes("user.role === 'super_admin'"), 'platform super-admin is validated separately from restaurant roles');
assert(adminSource.includes('configuredSuperAdmins()'), 'platform admin email allowlist remains enforced');
assert(adminSource.includes("['manager', 'cashier', 'server', 'kitchen'].includes(String(value))"),
  'new restaurant memberships are restricted to the five non-owner staff roles');

console.log('Full role boundary checks passed.');
