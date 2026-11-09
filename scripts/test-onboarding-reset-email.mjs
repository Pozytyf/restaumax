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
assert(backend.includes('email: ownerEmail, displayName: ownerName, disabled: false'), 'new owner Auth accounts are created without a preset password');
assert(backend.includes('auth.getUserByEmail(ownerEmail)'), 'restaurant provisioning can reuse an existing Firebase owner account');
assert(backend.includes("claims.role === 'super_admin' || claims.role === 'admin'"), 'platform administrator identities cannot be converted into restaurant owners');
assert(backend.includes("db.collection('managers').doc(existingOwner.uid).get()"), 'existing owner membership is checked before tenant assignment');
assert(backend.includes("db.collectionGroup('staff').where('uid', '==', existingOwner.uid)"), 'legacy staff memberships are checked before tenant assignment');
assert(backend.includes('previousCustomClaims'), 'existing custom claims are preserved and restored on provisioning failure');
assert(backend.includes('ownerCreated && ownerUser?.uid'), 'only newly-created Auth users are deleted during rollback');
assert(backend.includes('ownerAccountReused: !ownerCreated'), 'restaurant provisioning records whether an existing account was reused');
console.log('Account onboarding and existing-owner provisioning checks passed.');
