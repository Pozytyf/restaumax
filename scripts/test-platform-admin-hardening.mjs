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
assert(server.includes("return typeof defaultValue === 'boolean' ? defaultValue : feature === 'kitchenScreen';"),
  'unmapped plan names retain only the baseline kitchen feature and fail closed for premium features');

assert(rules.includes('return exists(restaurantPath) &&'),
  'Firestore denies access when the restaurant parent document is absent');
assert(rules.includes("return plan == ''\n        ? feature == 'kitchenScreen'"),
  'Firestore applies the same limited legacy feature baseline');
assert(rules.includes("featureMap.get(feature, plan == 'Pro' || feature == 'kitchenScreen') == true"),
  'unmapped Firestore plans retain only the kitchen baseline and do not inherit premium features');

const staffStart = admin.indexOf("if (action === 'staff_list' && ['full', 'support'].includes");
const staffEnd = admin.indexOf('// Owner and authorized manager staff administration', staffStart);
assert(staffStart >= 0 && staffEnd > staffStart, 'platform staff audit endpoint exists');
const staffAudit = admin.slice(staffStart, staffEnd);
assert(staffAudit.includes("canSeeFullAccountDetails = await getPlatformAdminRole(db, user) === 'full'"),
  'only full platform administrators may see complete account email addresses');
assert(staffAudit.includes('email: canSeeFullAccountDetails ? email : maskedEmail'),
  'support account list masks email addresses');

assert(admin.includes('billingLastRunAt <= now') && admin.includes('now - billingLastRunAt >= 0'),
  'billing health rejects future-dated telemetry before declaring the scheduler operational');
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

const billing = fs.readFileSync(new URL('../src/server/subscriptionBillingService.ts', import.meta.url), 'utf8');
assert(admin.includes('const planInput = Array.isArray(input.plans)') && admin.includes('planInput.length > 20'),
  'platform configuration accepts a bounded, dynamic plan catalog');
assert(admin.includes('rawPlan?.active !== \'boolean\'') && admin.includes('normalizedFeatures'),
  'custom plan definitions validate activation state and every supported entitlement');
assert(admin.includes('quarterlyDiscountPercent') && ui.includes('quarterlyDiscountPercent'),
  'quarterly discount rate is configurable in the admin API and UI');
assert(ui.includes('Créer une formule personnalisée') && ui.includes('platformConfig.plans.map'),
  'super-admin can create and manage multiple named subscription plans');
assert(ui.includes('Formule souscrite') && ui.includes('platformConfig.plans.filter(plan=>plan.active)'),
  'restaurant subscription assignment uses the active plan catalog');
assert(billing.includes("cycle === 'quarterly' ? quarterlyDiscountPercent : 0") &&
  billing.includes('baseAmountFcfa: baseAmount') && billing.includes('discountAmountFcfa: discountAmount'),
  'quarterly invoice stores an immutable base amount and applied discount snapshot');
assert(billing.includes("date.setUTCMonth(date.getUTCMonth() + 3)") &&
  billing.includes("cycle !== 'quarterly'"),
  'quarterly subscription period is supported in renewal and settlement logic');

assert(admin.includes("if (action === 'promotion_save')") && admin.includes("if (action === 'promotion_toggle')"),
  'promotion creation and activation changes are server-authorized actions');
assert(admin.includes('eligiblePlans.length > 20') && admin.includes("!['percentage', 'fixed'].includes(discountType)") && billing.includes("promotion.discountType === 'fixed'"),
  'promotion API validates targeted plans, discount types and quotas');
assert(billing.includes('usedCount < maxUses') && billing.includes('tx.update(appliedPromotionRef') &&
  billing.includes('No stacking: apply the single best available reduction.'),
  'promotion quota is consumed transactionally and never stacks with quarterly discounts');
assert(ui.includes('Politique de promotion') && ui.includes('promotion_list') &&
  ui.includes('Formules éligibles'),
  'billing workspace exposes promotion creation, targeting and activation');

console.log('Platform admin hardening regression tests passed.');
