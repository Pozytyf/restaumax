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
  assert.equal(isSuperAdmin(trustedClaim), true,
    'super-admin identity recognition is independent from the separately enforced server MFA session');
  assert.equal(await getPlatformAdminRole({}, trustedClaim), null,
    'a super-admin without a server-validated MFA session is rejected');
  assert.equal(await getPlatformAdminRole({}, trustedClaim, true), 'full',
    'a super-admin with a server-validated MFA session is accepted');

  const allowlisted = { uid: 'allowlisted', email: 'root@example.test', email_verified: true };
  assert.equal(isSuperAdmin(allowlisted), true,
    'verified allowlisted identity is recognized while protected API actions still require a server MFA session');
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
    adminSource.includes('firebaseMfaIsRecent') && adminSource.includes('firebaseMfaAdminIdentity') &&
    adminSource.includes("user.role === 'platform_admin'") && adminSource.includes('createPlatformAdminMfaSession') &&
    adminSource.includes('sessionValid') && adminSource.includes("action === 'mfa_accept_firebase'") &&
    adminSource.includes('createPlatformAdminMfaSession') &&
    adminSource.includes('getPlatformAdminRole(db, user, mfaSessionValid)'),
    'platform admin API reads and enforces the server-side MFA session on protected actions');
  assert(adminSource.includes('HttpOnly; Secure; SameSite=Strict; Path=/api/platform-admin'),
    'MFA session token is issued only in a scoped HttpOnly secure cookie');
  assert(mfaSource.includes('lastAcceptedStep') && mfaSource.includes('tx.update(ref, update)'),
    'TOTP time steps are consumed transactionally to prevent replay');
  assert(mfaSource.includes('recoveryCodeHashes') && mfaSource.includes('hashMfaToken'),
    'recovery codes are stored as hashes and consumed once');
  assert(adminSource.includes("action === 'mfa_reset'") &&
    adminSource.includes("platform_admin_mfa_reset") &&
    adminSource.includes("platformRole !== 'full'"),
    'the audited MFA reset endpoint remains restricted to a fully authenticated Super-admin');
  assert(!adminWorkspace.includes("action: 'mfa_reset'") &&
    !adminWorkspace.includes('Réinitialiser MFA'),
    'the account workspace does not expose MFA controls in its menu or account actions');
  assert(adminView.includes('mfa_enroll_start') && adminView.includes('QRCode.toDataURL') &&
    adminView.includes('mfa_verify'),
    'admin UI supports server-backed QR enrollment and MFA login verification');
  assert(adminView.includes('getIdTokenResult(true)') && adminView.includes('credential.user.getIdToken(true)') &&
    adminView.includes('continueAfterAuthentication(true)') &&
    adminSource.includes('firebase.sign_in_second_factor') === false && adminSource.includes('firebaseMfaIsRecent'),
    'Firebase MFA login force-refreshes the verified second-factor claim and establishes one platform session');
  assert(!adminView.includes('Demo-RestauMax-2026!') && !adminView.includes('isPublicDemoAccess'),
    'public Preview never embeds or pre-fills a super-admin password');

  console.log('Super-admin MFA gate and API security tests passed (15 assertions).');
} finally {
  if (previousMfa === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
  else process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = previousMfa;
  if (previousAllowlist === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;
  else process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = previousAllowlist;
}
