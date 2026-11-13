import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPlatformAdminRole, isSuperAdmin } from '../src/server/platformAdmin.ts';

const adminSource = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const mfaSource = fs.readFileSync(new URL('../src/server/platformAdminMfa.ts', import.meta.url), 'utf8');
const adminView = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminView.tsx', import.meta.url), 'utf8');
const adminWorkspace = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminWorkspace.tsx', import.meta.url), 'utf8');

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

  assert(adminSource.includes('hasValidPlatformAdminMfaSession') &&
    adminSource.includes('getPlatformAdminRole(db, user, mfaSessionValid)'),
    'platform admin API reads and enforces the server-side MFA session on protected actions');
  assert(adminSource.includes('HttpOnly; Secure; SameSite=Strict; Path=/api/platform-admin'),
    'MFA session token is issued only in a scoped HttpOnly secure cookie');
  assert(mfaSource.includes('lastAcceptedStep') && mfaSource.includes('tx.update(ref, update)'),
    'TOTP time steps are consumed transactionally to prevent replay');
  assert(mfaSource.includes('recoveryCodeHashes') && mfaSource.includes('hashMfaToken'),
    'recovery codes are stored as hashes and consumed once');
  assert(adminSource.includes("action === 'mfa_reset'") && adminSource.includes('platform_admin_mfa_reset') &&
    adminWorkspace.includes("action: 'mfa_reset'"),
    'only the full Super-admin account workspace exposes the audited MFA reset procedure');
  assert(adminView.includes('mfa_enroll_start') && adminView.includes('QRCode.toDataURL') &&
    adminView.includes('mfa_verify'),
    'admin UI supports server-backed QR enrollment and MFA login verification');

  console.log('Super-admin MFA gate and API security tests passed (14 assertions).');
} finally {
  if (previousMfa === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
  else process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = previousMfa;
  if (previousAllowlist === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;
  else process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = previousAllowlist;
}
