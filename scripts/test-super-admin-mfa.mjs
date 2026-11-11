import assert from 'node:assert/strict';
import { isSuperAdmin } from '../src/server/platformAdmin.ts';

const previousMfa = process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
const previousAllowlist = process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;

try {
  process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = 'true';
  process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = 'root@example.test';

  assert.equal(isSuperAdmin({ role: 'super_admin' } as any), false,
    'a trusted super-admin claim without a second factor must be rejected');
  assert.equal(isSuperAdmin({
    role: 'super_admin',
    firebase: { sign_in_second_factor: 'phone' }
  } as any), true, 'a trusted super-admin claim with a second factor is accepted');

  assert.equal(isSuperAdmin({
    email: 'root@example.test',
    email_verified: true
  } as any), false, 'an allowlisted email without a second factor is rejected');
  assert.equal(isSuperAdmin({
    email: 'root@example.test',
    email_verified: true,
    firebase: { sign_in_second_factor: 'totp' }
  } as any), true, 'a verified allowlisted super-admin with a second factor is accepted');

  assert.equal(isSuperAdmin({
    role: 'manager',
    email: 'other@example.test',
    email_verified: true,
    firebase: { sign_in_second_factor: 'phone' }
  } as any), false, 'MFA cannot elevate a non-admin identity');

  process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = 'false';
  assert.equal(isSuperAdmin({ role: 'super_admin' } as any), true,
    'the existing compatibility mode remains unchanged when enforcement is disabled');

  console.log('Super-admin MFA gate tests passed (6 assertions).');
} finally {
  if (previousMfa === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
  else process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = previousMfa;
  if (previousAllowlist === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;
  else process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = previousAllowlist;
}
