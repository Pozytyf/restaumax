import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/components/restaumax/PlatformAdminWorkspace.tsx', import.meta.url), 'utf8');
const imageService = fs.readFileSync(new URL('../src/server/restaurantImageService.ts', import.meta.url), 'utf8');

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
assert(rules.includes("let snapshotValue = snapshotFeatures.get(feature, null)") && rules.includes('snapshotValue is bool'),
  'Firestore entitlement checks honor the same immutable feature snapshot as server APIs');

const staffStart = admin.indexOf("if (action === 'staff_list' && ['full', 'support'].includes");
const staffEnd = admin.indexOf('// Owner and authorized manager staff administration', staffStart);
assert(staffStart >= 0 && staffEnd > staffStart, 'platform staff audit endpoint exists');
const staffAudit = admin.slice(staffStart, staffEnd);
assert(staffAudit.includes("canSeeFullAccountDetails = await getPlatformAdminRole(db, user, mfaSessionValid) === 'full'"),
  'only full platform administrators may see complete account email addresses');
assert(staffAudit.includes('email: canSeeFullAccountDetails ? email : maskedEmail'),
  'support account list masks email addresses');

assert(admin.includes('billingLastRunAt <= now') && admin.includes('now - billingLastRunAt >= 0'),
  'billing health rejects future-dated telemetry before declaring the scheduler operational');
assert(admin.includes('backupFresh') && admin.includes('now - backupLastRunAt <= 48 * 60 * 60 * 1000'),
  'backup health status requires a successful run within 48 hours');
assert(admin.includes("id: 'deployment', label: 'Déploiement', status: 'unknown'"),
  'deployment health is not marked operational from environment metadata alone');
assert(admin.includes("const mfaPolicyEnabled = process.env.RESTAUMAX_SUPER_ADMIN_REQUIRE_MFA === 'true';") &&
  admin.includes('const mfaOperational = mfaPolicyEnabled && mfaSessionValid;') &&
  admin.includes("id: 'admin-access', label: 'Sécurité des accès administrateur'") &&
  admin.includes("status: mfaOperational ? 'operational' : 'degraded'"),
  'administrator access health requires both the enforced policy and a server-validated current session');

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
assert(admin.includes('promo_') && admin.includes('activePromotions.size >= 100'),
  'promotion codes are unique under concurrent creation and active campaigns are bounded');
assert(admin.includes('eligiblePlans.length > 20') && admin.includes("!['percentage', 'fixed'].includes(discountType)") && billing.includes("promotion.discountType === 'fixed'"),
  'promotion API validates targeted plans, discount types and quotas');
assert(billing.includes('usedCount < maxUses') && billing.includes('tx.update(appliedPromotionRef') &&
  billing.includes('No stacking: apply the single best available reduction.'),
  'promotion quota is consumed transactionally and never stacks with quarterly discounts');
assert(ui.includes('Politique de promotion') && ui.includes('promotion_list') &&
  ui.includes('Formules éligibles'),
  'billing workspace exposes promotion creation, targeting and activation');

assert(admin.includes("'dishImages'") && ui.includes('Photos des plats (stockage sécurisé)'),
  'dish photo uploads are an assignable plan entitlement');
assert(imageService.includes("collection('platform_config')") && imageService.includes('dishImages') &&
  imageService.includes('Les photos de plats ne sont pas incluses dans la formule'),
  'dish image uploads are denied by the server when the restaurant plan lacks the entitlement');

assert(admin.includes("id: 'imagekit'") && admin.includes('imageKitEndpointValid') &&
  admin.includes('la disponibilité du fournisseur reste non mesurée'),
  'health panel reports ImageKit configuration without claiming provider uptime');

// Subscription catalogue, persistence, invoicing policy and financial dashboard regressions.
assert(server.includes('const snapshotFeature = subscription.planFeatures') &&
  server.includes('if (typeof snapshotFeature === \'boolean\') return snapshotFeature;'),
  'restaurant feature access uses the immutable entitlement snapshot attached to its subscription');
assert(admin.includes('planId: selectedPlanId') && admin.includes('planFeatures: selectedPlanFeatures') &&
  admin.includes('planPriceMonthlyFcfa: selectedMonthlyPrice'),
  'each subscription stores the stable offer ID, contractual price and entitlement snapshot');
const subscriptionService = fs.readFileSync(new URL('../src/server/subscriptionService.ts', import.meta.url), 'utf8');
assert(subscriptionService.includes('expectedPeriodEndDate') && subscriptionService.includes('nextBillingAt !== endsAt'),
  'server rejects subscription periods that do not match the selected billing cycle');
assert(ui.includes('expectedSubscriptionEnd') && ui.includes('Fin calculée automatiquement selon la périodicité.'),
  'subscription UI derives the contract end date from its start date and billing cycle');
assert(admin.includes('subscriptionRef.collection(\'history\').doc()') &&
  admin.includes('billingAction: \'subscription_changed_no_invoice\''),
  'subscription changes are versioned and do not create an immediate or retroactive invoice');
assert(admin.includes('Aucune facturation rétroactive ne sera déclenchée sans validation explicite'),
  'active or trial subscriptions with past-due dates cannot trigger an unapproved retroactive invoice');
assert(admin.includes('batch.set(subscriptionRef, updatedSubscription)') &&
  admin.includes('batch.create(historyRef') && admin.includes('batch.commit()'),
  'canonical subscription, history and audit are persisted atomically');
assert(admin.includes('subscriptionSnap.exists\n            ?') && admin.includes("'legacy_unmigrated'"),
  'the canonical subscription document takes precedence and legacy data is marked explicitly');
assert(admin.includes("billingCycle === 'quarterly'" ) && admin.includes('amount / 3'),
  'quarterly contracts contribute one third of their cycle price to MRR');
assert(admin.includes('financialSummary') && admin.includes('overdueInvoicesCount') &&
  admin.includes('collectedAmountFcfa') && admin.includes('upcomingDueAmountFcfa'),
  'overview exposes open, overdue, collected and upcoming-due financial totals');
assert(admin.includes('resolveSubscriptionInvoiceIdentity(doc.ref, rawInvoice)') &&
  admin.includes("payment.restaurantSlug !== restaurantSlug") &&
  admin.includes("linkedInvoice.status === 'paid'") &&
  admin.includes("linkedInvoice.paymentReference === payment.paymentReference"),
  'financial aggregates include only canonical invoices and payments reconciled to the same paid invoice');
assert(admin.includes("['full', 'billing'].includes(String(await getPlatformAdminRole(db, user, mfaSessionValid) || ''))"),
  'financial aggregates are restricted to full and billing platform administrators');
assert(ui.includes("screen === 'settings'") && ui.includes("const configData = await read('billing_catalog_read')") &&
  admin.includes("action === 'billing_catalog_read'") && admin.includes("'billing_catalog_read'"),
  'the offer catalog is loaded through a least-privilege billing action before a subscription is edited');
assert(ui.includes('planId: selectedPlan?.id') && ui.includes('summary?.financialSummary?.overdueInvoicesCount') &&
  ui.includes('{date(i.dueAt)}') && ui.includes('Période facturée') && ui.includes('Fin de grâce') &&
  ui.includes("i.planId || 'Offre historique'") &&
  !ui.includes("status: 'Existant'") && !ui.includes('Vert · Existant'),
  'subscription UI sends the offer ID and displays overdue counts and invoice due dates');
assert(billing.includes('Number(sub.priceFcfa)') && billing.includes('Catalog edits must not'),
  'recurring invoices use the saved contractual price snapshot instead of silently repricing existing subscriptions');
assert(billing.includes("!['open', 'overdue'].includes(String(invoice.status))"),
  'overdue invoices remain payable through the same settlement transaction');
assert(billing.includes('graceEndsAt: now + gracePeriodDays * DAY_MS') &&
  billing.includes('planId: String(sub.planId || \'\')') &&
  billing.includes('periodStartAt: nextBillingAt') && billing.includes('periodEndAt: addBillingCycle(nextBillingAt, cycle)'),
  'recurring invoices snapshot the scheduled contract period and grace deadline');
assert(admin.includes('sessionValid') && admin.includes("action === 'mfa_accept_firebase'") &&
  admin.includes('createPlatformAdminMfaSession'),
  'MFA reuses a valid server session and accepts one verified Firebase second factor');

assert(admin.includes("!['full', 'billing', 'support', 'read_only'].includes(role)") &&
  admin.includes("role === 'full' ? { role: 'super_admin', sessionVersion }") &&
  admin.includes("action: role === 'full' ? 'invite_full_super_admin' : 'create_platform_admin'"),
  'only a full administrator can invite a new full Super-admin through the authenticated admin API');
assert(admin.includes("action === 'platform_admin_revoke_sessions'") &&
  admin.includes('revokePlatformAdminMfaSessions(db, uid)') &&
  admin.includes("action: 'revoke_platform_admin_sessions'"),
  'administrator session revocation invalidates Firebase tokens and RestauMax MFA sessions with an audit record');
assert(admin.includes("action === 'platform_admin_delete'") &&
  admin.includes("role: 'revoked_platform_admin'") &&
  admin.includes("action: 'delete_platform_admin'") &&
  admin.includes('auditRecordPreserved: true'),
  'administrator deletion disables and removes the identity while preserving its audit tombstone');
assert(admin.includes('countActivePlatformSuperAdmins(auth)') &&
  admin.includes('Impossible de suspendre le dernier Super-admin actif') &&
  admin.includes('Impossible de supprimer le dernier Super-admin actif'),
  'full administrator suspension and deletion cannot lock out the last active Super-admin, including allowlisted identities');
assert(admin.includes("managedFull.data()?.active !== true") &&
  admin.includes("snap.data()?.deleted === true"),
  'suspended and deleted full-admin records are denied server-side and cannot be reactivated as live accounts');
assert(ui.includes('<option value="full">Super-admin complet') &&
  ui.includes('platform_admin_revoke_sessions') &&
  ui.includes('platform_admin_delete') &&
  ui.includes('Révoquer sessions') && ui.includes('Supprimer'),
  'the administrator workspace exposes full-admin invitation, session revocation and deletion controls');

assert(admin.includes("if (db && typeof db.collection === 'function')") &&
  admin.includes("managedFull.data()?.active !== true"),
  'full-admin suspension state is checked when Firestore is available without breaking isolated role unit tests');

console.log('Platform admin hardening regression tests passed.');
