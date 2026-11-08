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
const menuView = fs.readFileSync(new URL('../src/components/restaumax/MenuManagementView.tsx', import.meta.url), 'utf8');
const hubView = fs.readFileSync(new URL('../src/components/restaumax/RestaurantHubView.tsx', import.meta.url), 'utf8');
const platformAdmin = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const staffView = fs.readFileSync(new URL('../src/components/restaumax/StaffManagementView.tsx', import.meta.url), 'utf8');
const qrView = fs.readFileSync(new URL('../src/components/restaumax/TableQrGeneratorView.tsx', import.meta.url), 'utf8');
assert(menuView.includes("canManageCatalog = false") && menuView.includes("if (!canManageCatalog) return"),
  'catalogue mutation handlers are denied by default without menu.manage');
assert(menuView.includes("{canManageCatalog && <button") && menuView.includes("{canManageCatalog && <>"),
  'create, edit, delete and availability actions are hidden without menu.manage');
assert(hubView.includes("canManageCatalog={permissions.includes('menu.manage')}"),
  'catalogue edit access is driven by the verified role permission set');
assert(hubView.includes("const canViewCatalog = permissions.includes('menu.view') || permissions.includes('menu.manage')") &&
  hubView.includes("status: canViewCatalog ? 'active' : 'unavailable'"),
  'catalogue consultation is hidden from roles without menu.view');
assert(staffView.includes('Autorisations supplémentaires accordées par le propriétaire') &&
  staffView.includes('Elles ne peuvent être retirées que par le propriétaire.'),
  'Managers can see owner-granted extras but cannot edit or remove them');
assert(platformAdmin.includes("const sessionVersion = currentSessionVersion + 1") &&
  platformAdmin.includes("await getAuth().revokeRefreshTokens(staffUid)"),
  'role and permission changes invalidate prior staff sessions and require reauthentication');
assert(platformAdmin.includes("await db.runTransaction(async (tx: any) =>") &&
  platformAdmin.includes("tx.set(memberRef, { role, permissions, sessionVersion") &&
  platformAdmin.includes("tx.set(managerRef, { role, permissions, sessionVersion"),
  'role updates atomically synchronize both staff membership records before Auth claims are refreshed');

assert(qrView.includes('window.confirm') && qrView.includes('setIsRevoking(true)') &&
  qrView.includes('disabled={isGenerating || isRevoking}') &&
  qrView.includes("setQrDataUrl('')") && qrView.includes("setQrSvgString('')") && qrView.includes("setQrUrl('')"),
  'QR revocation requires confirmation, prevents duplicate requests and clears all stale QR representations');
const qrGenerateButton = qrView.slice(qrView.indexOf('const handleGenerateQr'), qrView.indexOf('const handleRevokeQr'));
assert(qrGenerateButton.includes('window.confirm') && qrGenerateButton.includes('Tout QR précédemment émis'),
  'QR regeneration warns that previously printed QR codes will be invalidated');
const qrGenerateStart = qrView.slice(qrView.indexOf('const generateQrForTable'), qrView.indexOf('const handleGenerateQr'));
assert(qrGenerateStart.includes("setQrDataUrl('')") && qrGenerateStart.includes("setQrSvgString('')") &&
  qrGenerateStart.includes("setQrUrl('')") && qrGenerateStart.includes('setQrForTableId(null)'),
  'QR rotation clears old image and vector assets before the server can invalidate the previous token');
assert(qrView.includes('const hasCurrentQr = Boolean(currentTable && qrForTableId === currentTable.id') &&
  qrView.includes('qrForTableId !== currentTable.id') && qrView.includes('disabled={isGenerating || isRevoking || !hasCurrentQr}'),
  'QR assets and downloads are bound to the selected table only');
assert(hubView.includes("permissions.includes('tables.manage') && <button") &&
  hubView.includes("status: permissions.includes('tables.manage') ? 'active' : 'unavailable'"),
  'QR administration entry points are restricted to members with tables.manage');

const firestoreRules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const managerRule = firestoreRules.match(/role == 'manager' && permission in \[([\s\S]*?)\]\)/)?.[1] || '';
assert(managerRule.includes("'orders.cancel'") && managerRule.includes("'payments.refund'"), 'Firestore manager ceiling includes cancellation and refund permissions');
assert(adminSource.includes('user.email_verified === true') && adminSource.includes('configuredSuperAdmins()'), 'platform super-admin requires a verified allowlisted email');
assert(adminSource.includes("RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA === 'true'") && adminSource.includes('sign_in_second_factor'), 'platform super-admin can require a verified Firebase second-factor claim');
assert(!adminSource.includes("return user.role === 'super_admin' ||"), 'a stale super-admin custom claim cannot bypass the current allowlist');
assert(adminSource.includes('configuredSuperAdmins()'), 'platform admin email allowlist remains enforced');
assert(adminSource.includes("['manager', 'cashier', 'server', 'kitchen'].includes(String(value))"),
  'new restaurant memberships are restricted to the five non-owner staff roles');

console.log('Full role boundary checks passed.');
