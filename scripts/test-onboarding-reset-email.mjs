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
assert(!staff.includes('form.password') && !staff.includes('Mot de passe initial'), 'staff UI does not collect an initial password');
assert(!platform.includes('form.ownerPassword') && !platform.includes('Mot de passe initial'), 'owner UI does not collect an initial password');
assert(!backend.includes('body.password') && !backend.includes('const password = String(body.password'), 'backend does not require caller-supplied initial passwords');
assert(backend.includes('auth.createUser({ email, displayName: name, disabled: false })'), 'staff Auth account is created without a preset password');
assert(backend.includes('email: ownerEmail, displayName: ownerName, disabled: false'), 'owner Auth account is created without a preset password');
console.log('Account onboarding email and passwordless provisioning checks passed (9 assertions).');
