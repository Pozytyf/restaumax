import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminWorkspace.tsx', import.meta.url), 'utf8');

assert(server.includes("if (!restaurantSnap.exists || restaurantSnap.data()?.deletedAt || restaurantSnap.data()?.status === 'deleted') return false;"),
  'feature entitlements deny deleted or missing restaurants');
assert(server.includes("if (!planName) return feature === 'kitchenScreen';"),
  'legacy subscriptions receive only the explicit kitchen baseline');
assert(server.includes("return typeof defaultValue === 'boolean' ? defaultValue : false;"),
  'unknown plan names fail closed for premium features');

assert(rules.includes('return exists(restaurantPath) &&'),
  'Firestore denies access when the restaurant parent document is absent');
assert(rules.includes("return plan == ''\n        ? feature == 'kitchenScreen'"),
  'Firestore applies the same limited legacy feature baseline');
assert(rules.includes("featureMap.get(feature, plan == 'Pro' || (plan == 'Essentiel' && feature == 'kitchenScreen')) == true"),
  'unknown Firestore plan names do not inherit Pro features');

const staffStart = admin.indexOf("if (action === 'staff_list' && ['full', 'support'].includes");
const staffEnd = admin.indexOf('// Owner and authorized manager staff administration', staffStart);
assert(staffStart >= 0 && staffEnd > staffStart, 'platform staff audit endpoint exists');
const staffAudit = admin.slice(staffStart, staffEnd);
assert(staffAudit.includes("canSeeFullAccountDetails = await getPlatformAdminRole(db, user) === 'full'"),
  'only full platform administrators may see complete account email addresses');
assert(staffAudit.includes('email: canSeeFullAccountDetails ? email : maskedEmail'),
  'support account list masks email addresses');

assert(admin.includes('backupFresh') && admin.includes('now - backupLastRunAt <= 48 * 60 * 60 * 1000'),
  'backup health status requires a successful run within 48 hours');
assert(admin.includes("id: 'deployment', label: 'Déploiement', status: 'unknown'"),
  'deployment health is not marked operational from environment metadata alone');
assert(admin.includes('l’enrôlement individuel de chaque administrateur'),
  'MFA health does not overclaim individual enrollment based only on policy configuration');

const auditStart = admin.indexOf("if (action === 'audit_list') {");
const auditEnd = admin.indexOf("if (action === 'overview') {", auditStart);
assert(auditStart >= 0 && auditEnd > auditStart, 'read-only audit endpoint exists');
const auditRead = admin.slice(auditStart, auditEnd);
for (const field of ['targetUid','previousRole','newRole','previousStatus','newStatus','previousPlanName','newPlanName','outcome','reasonCode']) {
  assert(auditRead.includes(field + ':'), 'audit API exposes sanitized field ' + field);
}
assert(ui.includes('expandedAuditId===a.id') && ui.includes('Aucun détail complémentaire n’avait été enregistré'),
  'audit UI exposes expandable detail rows and explains missing legacy metadata');

console.log('Platform admin hardening regression tests passed.');
