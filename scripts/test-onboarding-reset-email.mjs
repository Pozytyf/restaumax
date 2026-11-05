import assert from 'node:assert/strict';
import fs from 'node:fs';

const staff = fs.readFileSync(new URL('../src/components/restaumax/StaffManagementView.tsx', import.meta.url), 'utf8');
const platform = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminView.tsx', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/components/restaumax/ManagerLoginView.tsx', import.meta.url), 'utf8');
const firebase = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');

assert(staff.includes('requestManagerPasswordReset(createdEmail)'), 'staff account creation sends a password setup email');
assert(platform.includes('requestManagerPasswordReset(ownerEmail)'), 'restaurant owner creation sends a password setup email');
assert(login.includes('requestManagerPasswordReset(normalizedEmail)'), 'users can request a reset from the login screen');
assert(firebase.includes('sendPasswordResetEmail(auth, email.trim())'), 'password setup uses Firebase Auth email delivery');
console.log('Account onboarding email checks passed.');
