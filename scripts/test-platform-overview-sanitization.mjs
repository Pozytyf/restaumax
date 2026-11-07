import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/server/platformAdmin.ts', import.meta.url), 'utf8');
const start = source.indexOf("if (action === 'overview') {");
const end = source.indexOf("if (action === 'create_restaurant') {", start);
assert(start >= 0 && end > start, 'platform overview action exists');
const overview = source.slice(start, end);
assert(!overview.includes('...data'), 'overview does not spread arbitrary restaurant fields');
for (const privateField of ['ownerEmail:', 'ownerName:', 'phone:', 'address:']) {
  assert(!overview.includes(privateField), 'overview excludes private field ' + privateField);
}
assert(overview.includes('subscriptionsByStatus'), 'overview aggregates subscription status');
assert(overview.includes('subscriptionsByPlan'), 'overview aggregates subscription plans');
assert(overview.includes('monthlyRecurringRevenueFcfa'), 'overview reports normalized monthly recurring revenue');
assert(overview.includes("billingCycle === 'yearly'"), 'yearly subscriptions are normalized over twelve months');
console.log('Platform overview minimization and aggregate checks passed.');

const accountsStart = source.indexOf("if (action === 'staff_list' && isSuperAdmin(user)) {");
const accountsEnd = source.indexOf("// Owner and authorized manager staff administration", accountsStart);
assert(accountsStart >= 0 && accountsEnd > accountsStart, 'super-admin account audit exists before tenant staff authorization');
const accountAudit = source.slice(accountsStart, accountsEnd);
assert(accountAudit.includes("collection('managers').where('restaurantSlug', '==', slug)"), 'account audit reconciles global manager records for the selected restaurant');
assert(accountAudit.includes("collection('staff').get()"), 'account audit reads the restaurant staff subcollection');
assert(accountAudit.includes('restaurant.ownerUid') && accountAudit.includes('restaurant.ownerEmail'), 'account audit includes canonical owner identity fields');
assert(accountAudit.includes('emailConflict'), 'account audit flags conflicting email records');
assert(accountAudit.includes("actorRole: 'super_admin'") && accountAudit.includes('readOnly: true'), 'super-admin account audit is read-only');
assert(accountAudit.includes('accountLinked: false'), 'unlinked owner metadata is distinguished from an actual Firebase account');
console.log('Super-admin restaurant account audit and owner-email reconciliation checks passed.');

assert(accountAudit.includes('activeKnown'), 'account audit does not infer Firebase active status from the restaurant owner pointer');

const staffManagement = fs.readFileSync(new URL('../src/components/restaumax/StaffManagementView.tsx', import.meta.url), 'utf8');
const menuView = fs.readFileSync(new URL('../src/components/restaumax/ClientMenuView.tsx', import.meta.url), 'utf8');
const productModal = fs.readFileSync(new URL('../src/components/restaumax/ProductDetailModal.tsx', import.meta.url), 'utf8');
assert(source.includes("action === 'assign_server_tables'"), 'table assignment is a dedicated server action');
assert(source.includes("managerSnap.data().permissions.includes('tables.manage')"), 'managers need tables.manage to assign tables');
assert(source.includes("server.role !== 'server'") && source.includes("server.active !== true") && source.includes("serverMembership.active !== true"), 'only an active and consistently linked server can receive table assignments');
assert(source.includes("assignedWaiter: staffUid"), 'each table stores one canonical assigned server UID');
assert(source.includes("assignedWaiter: null"), 'old assignments can be released during reassignment or account lifecycle changes');
assert(source.includes('assignedWaiterUid: targetWaiterUid') && source.includes('assignedWaiterUid: null'), 'active orders follow table reassignment and are detached when a server leaves');
assert(source.includes("db.runTransaction(async (tx: any)"), 'table assignments are persisted transactionally');
assert(staffManagement.includes('multiple size=') && staffManagement.includes("action: 'assign_server_tables'"), 'manager UI supports assigning multiple tables to one server');
assert(menuView.includes('divide-y') && menuView.includes('Quantité') && menuView.includes('initialQuantity'), 'customer menu is a list with quantity selectors and passes the selected quantity');
assert(productModal.includes('initialQuantity = 1'), 'product configuration preserves the quantity selected in the menu list');
console.log('Server table assignment and customer menu list regression checks passed.');

const firestoreRules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const firebaseClient = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const orderService = fs.readFileSync(new URL('../src/server/orderService.ts', import.meta.url), 'utf8');
const orderTypes = fs.readFileSync(new URL('../src/types/restaumax.ts', import.meta.url), 'utf8');
assert(firestoreRules.includes("resource.data.get('assignedWaiter', '') == request.auth.uid"), 'Firestore restricts server table reads to the assigned server');
assert(firestoreRules.includes("resource.data.get('assignedWaiterUid', '') == request.auth.uid"), 'Firestore restricts server order reads to the assigned server');
assert(firebaseClient.includes("where('assignedWaiter', '==', assignedWaiterUid)"), 'server table subscription queries only assigned tables');
assert(firebaseClient.includes("where('assignedWaiterUid', '==', assignedWaiterUid)"), 'server order subscription queries only assigned orders');
assert(appSource.includes("authRestaurantRole === 'server' ? authUser?.uid : undefined"), 'the authenticated server identity scopes realtime subscriptions');
assert(orderService.includes("assignedWaiterUid = typeof matched.assignedWaiter === 'string'"), 'new table orders inherit the current table assignment');
assert(orderTypes.includes('assignedWaiterUid?: string | null'), 'orders expose the assigned server field');
console.log('Assigned server table/order isolation regression checks passed.');
