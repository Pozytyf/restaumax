import assert from 'node:assert/strict';
import { getPlatformAdminRole, isSuperAdmin } from '../src/server/platformAdmin.ts';

const previousMfa = process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
const previousAllowlist = process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;

try {
  process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = 'true';
  process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = 'root@example.test';

  const trustedClaim = { uid: 'root-uid', role: 'super_admin' };
  assert.equal(isSuperAdmin(trustedClaim), false,
    'the legacy Firebase-factor predicate is not used as the custom MFA session proof');
  assert.equal(await getPlatformAdminRole({}, trustedClaim), null,
    'a super-admin without a server-validated MFA session is rejected');
  assert.equal(await getPlatformAdminRole({}, trustedClaim, true), 'full',
    'a super-admin with a server-validated MFA session is accepted');

  const allowlisted = { uid: 'allowlisted', email: 'root@example.test', email_verified: true };
  assert.equal(isSuperAdmin(allowlisted), false,
    'the legacy Firebase-factor predicate rejects an allowlisted identity without a Firebase second factor');
  assert.equal(await getPlatformAdminRole({}, allowlisted), null,
    'an allowlisted identity without a server-side MFA session is rejected');
  assert.equal(await getPlatformAdminRole({}, allowlisted, true), 'full',
    'an allowlisted identity with a server-side MFA session is accepted');

  assert.equal(isSuperAdmin({
    role: 'manager',
    email: 'other@example.test',
    email_verified: true
  }), false, 'MFA cannot elevate a non-admin identity');

  process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = 'false';
  assert.equal(await getPlatformAdminRole({}, trustedClaim), 'full',
    'the compatibility mode remains unchanged when enforcement is disabled');

  console.log('Super-admin MFA gate tests passed (7 assertions).');
} finally {
  if (previousMfa === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
  else process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = previousMfa;
  if (previousAllowlist === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;
  else process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = previousAllowlist;
}
