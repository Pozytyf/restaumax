import assert from 'node:assert/strict';
import { resolveRolePermissions } from '../src/server/platformAdmin.ts';
const manager = resolveRolePermissions('manager', []);
assert(manager?.includes('payments.refund'));
assert.equal(resolveRolePermissions('server', ['payments.refund']), null);
assert.equal(resolveRolePermissions('kitchen', ['payments.refund']), null);
console.log('role ceiling tests passed');
