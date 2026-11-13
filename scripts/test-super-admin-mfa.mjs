import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canPlatformAdminPerform, getPlatformAdminRole, isSuperAdmin } from '../src/server/platformAdmin.ts';

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

  const delegatedDb = {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            role: 'billing', active: true, sessionVersion: 4,
            permissions: ['platform.overview', 'billing.read']
          })
        })
      })
    })
  };
  const billingAdmin = {
    uid: 'billing-admin', role: 'platform_admin', platformAdminRole: 'billing',
    platformAdminSessionVersion: 4,
    platformAdminPermissions: ['platform.overview', 'billing.read']
  };
  assert.equal(await getPlatformAdminRole(delegatedDb, billingAdmin, true), 'billing',
    'a delegated administrator is accepted only when its token permissions match the server record');
  assert.equal(await getPlatformAdminRole(delegatedDb, {
    ...billingAdmin, platformAdminPermissions: ['platform.overview', 'billing.read', 'billing.manage']
  }, true), null, 'a stale or escalated permission token is rejected against the server record');
  assert.equal(canPlatformAdminPerform('billing', 'billing_list', ['platform.overview', 'billing.read']), true,
    'a delegated billing permission enables its mapped read action');
  assert.equal(canPlatformAdminPerform('billing', 'update_subscription', ['platform.overview', 'billing.read']), false,
    'removing billing.manage blocks subscription mutations server-side');
  assert.equal(canPlatformAdminPerform('read_only', 'support_access_list', ['platform.overview', 'support.read']), false,
    'read-only support cannot inspect the support access-request queue');
  assert.equal(canPlatformAdminPerform('full', 'platform_admin_create'), true,
    'full Super-admin retains the ability to invite another Super-admin');

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
  assert(adminSource.includes('HttpOnly; Secure; SameSite=Strict; Path=/api/platform-admin') && adminSource.includes('Max-Age=7776000'),
    'MFA session token is issued only in a scoped HttpOnly secure cookie');
  assert(mfaSource.includes('PLATFORM_ADMIN_TRUSTED_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000'),
    'the trusted MFA session has an explicit 90-day server-side TTL');
  assert(mfaSource.includes('lastAcceptedStep') && mfaSource.includes('tx.update(ref, update)'),
    'TOTP time steps are consumed transactionally to prevent replay');
  assert(mfaSource.includes('recoveryCodeHashes') && mfaSource.includes('hashMfaToken'),
    'recovery codes are stored as hashes and consumed once');
  assert(adminSource.includes("action === 'mfa_reset'") &&
    adminSource.includes("platform_admin_mfa_reset") &&
    adminSource.includes("platform_admin_mfa_email_recovery") &&
    adminSource.includes("platform_admin_mfa_webauthn_challenges") &&
    adminSource.includes("action === 'mfa_logout'") &&
    adminSource.includes("platformRole !== 'full'"),
    'the audited MFA reset endpoint remains restricted to a fully authenticated Super-admin');
  assert(!adminWorkspace.includes("action: 'mfa_reset'") &&
    !adminWorkspace.includes('Réinitialiser MFA'),
    'the account workspace does not expose MFA controls in its menu or account actions');
  assert(adminView.includes('mfa_enroll_start') && adminView.includes('QRCode.toDataURL') &&
    adminView.includes('mfa_verify'),
    'admin UI supports server-backed QR enrollment and MFA login verification');
  assert(mfaSource.includes("factorSource: recoveryUsed ? 'recovery' : 'totp'") &&
    mfaSource.includes('getPlatformAdminMfaSessionDetails'),
    'a recovery code creates a separately marked MFA recovery session');
  assert(adminSource.includes("action === 'mfa_recovery_enroll_start'") &&
    adminSource.includes("factorSource !== 'recovery'") &&
    adminSource.includes("factorSource === 'recovery'"),
    'recovery sessions are restricted to replacing the lost factor and cannot access platform data');
  assert(adminView.includes("status.recoverySession === true") &&
    adminView.includes("action: 'mfa_recovery_enroll_start'") &&
    adminView.includes('await continueAfterAuthentication();'),
    'recovery-code sign-in forces a new TOTP enrollment before platform access');
  assert(mfaSource.includes('regeneratePlatformAdminRecoveryCodes') &&
    adminSource.includes("action === 'mfa_recovery_regenerate'") &&
    adminSource.includes("sessionDetails.factorSource === 'recovery'"),
    'recovery codes can only be rotated with a valid non-recovery MFA session and a fresh TOTP');
  assert(adminView.includes("action: 'mfa_recovery_regenerate'") &&
    adminView.includes('Renouveler les 10 codes'),
    'the authenticated admin UI exposes one-time recovery-code rotation');
  assert(adminView.includes('getIdTokenResult(true)') && adminView.includes('credential.user.getIdToken(true)') &&
    adminView.includes('continueAfterAuthentication(true)') &&
    adminSource.includes('firebaseMfaIsRecent') &&
    adminSource.includes("firebaseSessionIsMigration ? 'firebase-migration' : 'firebase'") &&
    adminSource.includes("firebaseSessionIsMigration ? 10 * 60 * 1000"),
    'legacy Firebase MFA is only a short-lived migration bridge, not a trusted RestauMax session');
  assert(adminSource.includes("['totp', 'passkey'].includes(activeMfaSessionDetails.factorSource)") &&
    adminSource.includes("(activeMfaSessionDetails.factorSource === 'firebase' && !isSuperAdminIdentity(user))"),
    'only RestauMax factors unlock Super-admin APIs while delegated admins retain their Firebase MFA policy');
  assert(adminSource.includes("action === 'mfa_recovery_email_start'") &&
    adminSource.includes("action === 'mfa_recovery_email_verify'") &&
    adminSource.includes('startPlatformAdminEmailRecovery') &&
    adminSource.includes('verifyPlatformAdminEmailRecovery') &&
    adminSource.includes('user.auth_time || 0'),
    'verified-email recovery is wired through the authenticated platform API and requires recent primary authentication');
  assert(adminSource.includes("action === 'mfa_passkey_register_options'") &&
    adminSource.includes("action === 'mfa_passkey_auth_verify'") &&
    adminView.includes('startAuthentication') && adminView.includes('startRegistration') &&
    adminView.includes('status.firebaseMfaMigrationEligible === true'),
    'passkey enrollment and second-factor authentication are wired end to end');
  assert(adminView.includes('multiFactor(currentUser).unenroll(factor)'),
    'Firebase-native factors are progressively removed only after RestauMax MFA succeeds');
  assert(!adminView.includes('Demo-RestauMax-2026!') && !adminView.includes('isPublicDemoAccess'),
    'public Preview never embeds or pre-fills a super-admin password');

  console.log('Super-admin MFA gate, migration boundary and API security tests passed.');
} finally {
  if (previousMfa === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA;
  else process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA = previousMfa;
  if (previousAllowlist === undefined) delete process.env.RESTAUMAX_SUPER_ADMIN_EMAILS;
  else process.env.RESTAUMAX_SUPER_ADMIN_EMAILS = previousAllowlist;
}
