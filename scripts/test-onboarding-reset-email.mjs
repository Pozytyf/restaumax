import assert from 'node:assert/strict';
import fs from 'node:fs';

const staff = fs.readFileSync(new URL('../src/components/restaumax/StaffManagementView.tsx', import.meta.url), 'utf8');
const platform = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminView.tsx', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/components/restaumax/ManagerLoginView.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');

assert(staff.includes('requestManagerPasswordReset(createdEmail)'), 'staff account creation sends a password setup email');
assert(platform.includes('requestManagerPasswordReset(ownerEmail)'), 'restaurant owner creation sends a password setup email');
assert(login.includes('requestManagerPasswordReset(normalizedEmail)'), 'users can request a reset from the login screen');
assert(firebase.includes('sendPasswordResetEmail(auth, email.trim())'), 'password setup uses Firebase Auth email delivery');
assert(!/form\\.password|Mot de passe initial/.test(staff), 'staff UI does not collect an initial password');
assert(!/form\\.ownerPassword|Mot de passe initial/.test(platform), 'owner UI does not collect an initial password');
assert(!/body\\.password|const password = String\\(body\\.password/.test(backend), 'backend does not require caller-supplied initial passwords');
assert(/auth\\.createUser\\(\\{ email, displayName: name, disabled: false \\}\\)/.test(backend), 'staff Auth account is created without a preset password');
assert(/email: ownerEmail, displayName: ownerName, disabled: false/.test(backend), 'owner Auth account is created without a preset password');
console.log('Account onboarding email and passwordless provisioning checks passed (9 assertions).');
