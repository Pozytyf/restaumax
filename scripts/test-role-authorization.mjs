import { readFileSync } from 'node:fs';
import { resolveRolePermissions, resolveManagerPermissionUpdate, canManageStaffMember } from '../src/server/platformAdmin.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
}

const cashierBase = resolveRolePermissions('cashier', undefined, false) || [];
const kitchenBase = resolveRolePermissions('kitchen', undefined, false) || [];
assert(cashierBase.includes('orders.view') && cashierBase.includes('cash.view'), 'Le caissier reçoit les commandes et consulte le journal des paiements par défaut.');
assert(kitchenBase.includes('orders.view') && kitchenBase.includes('kitchen.access') && kitchenBase.includes('orders.clear_pending'), 'Cuisine/Bar reçoit son espace KDS et peut vider les tickets en attente.');
assert(resolveRolePermissions('kitchen', ['bar.access'], true)?.includes('bar.access') === true, 'Le propriétaire peut accorder séparément l’accès au Bar.');
const cashierWithExtra = resolveRolePermissions('cashier', ['orders.cancel', 'payments.refund'], true);
assert(!cashierBase.includes('orders.cancel') && !cashierBase.includes('payments.refund'), 'Les droits annulation/remboursement ne sont pas attribués par défaut au caissier');
assert(cashierWithExtra?.includes('orders.cancel') && cashierWithExtra?.includes('payments.refund'), 'Le propriétaire peut accorder explicitement annulation et remboursement au caissier');
assert(resolveRolePermissions('cashier', ['menu.manage'], true) === null, 'Le caissier ne peut jamais recevoir menu.manage');
assert(resolveRolePermissions('server', ['cash.manage'], true) === null, 'Le serveur ne peut jamais recevoir cash.manage');
assert(resolveRolePermissions('kitchen', ['orders.cancel'], true) === null, 'Cuisine/Bar ne peut jamais recevoir une annulation générale');
assert(resolveRolePermissions('kitchen', ['orders.clear_pending'], true)?.includes('orders.clear_pending') === true, 'Cuisine/Bar peut vider uniquement les tickets en attente');
assert(kitchenBase.includes('orders.clear_pending'), 'Cuisine/Bar reçoit par défaut le droit limité de vider les tickets en attente');
assert(resolveRolePermissions('manager', ['settings.manage'], true) === null, 'Le manager ne peut jamais recevoir settings.manage');
assert(resolveRolePermissions('cashier', ['orders.cancel'], false) === null, 'Un manager ne peut pas accorder un droit supplémentaire au caissier');
assert(resolveRolePermissions('cashier', ['orders.cancel'], true)?.includes('orders.cancel') === true, 'Le propriétaire peut accorder un droit supplémentaire dans le plafond du caissier');

const cashierOwnerGrant = ['orders.view','tables.view','pos.access','cash.view','cash.manage','reports.cash.view','orders.cancel'];
assert(resolveManagerPermissionUpdate('cashier', 'cashier', cashierOwnerGrant)?.includes('orders.cancel') === true,
  'Un manager conserve une autorisation supplémentaire accordée par le propriétaire lors d’une modification du même rôle');
assert(resolveManagerPermissionUpdate('cashier', 'server', cashierOwnerGrant) === null,
  'Un manager ne peut pas supprimer indirectement un droit du propriétaire en changeant le rôle du caissier');
assert(resolveManagerPermissionUpdate('server', 'cashier', ['orders.view','tables.view','pos.access','orders.serve'])?.includes('cash.manage') === true,
  'Un manager peut changer un rôle lorsque cela ne retire aucun droit supplémentaire du propriétaire');

assert(resolveManagerPermissionUpdate('staff', 'server', ['orders.view','tables.view','pos.access','orders.cancel']) === null,
  'Un manager ne peut pas supprimer un droit supplémentaire d’un ancien compte staff en le reclassant');



assert(canManageStaffMember('manager', 'cashier'), 'Le manager peut administrer un caissier');
assert(canManageStaffMember('manager', 'server'), 'Le manager peut administrer un serveur');
assert(canManageStaffMember('manager', 'kitchen'), 'Le manager peut administrer Cuisine/Bar');
assert(!canManageStaffMember('manager', 'manager'), 'Le manager ne peut pas administrer un autre manager');
assert(!canManageStaffMember('manager', 'owner'), 'Le manager ne peut pas administrer le propriétaire');
assert(canManageStaffMember('owner', 'manager'), 'Le propriétaire peut administrer un manager');
assert(!canManageStaffMember('owner', 'owner'), 'Le propriétaire ne peut pas supprimer le rôle propriétaire depuis le personnel');

const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const firestoreRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(serverSource.includes('adminAuth.verifyIdToken(idToken, true)') &&
  serverSource.includes("member.restaurantSlug !== restaurantSlug") &&
  serverSource.includes("permissions.includes('reports.view')"),
  'Les rapports exigent un jeton actif et une permission liée au restaurant exact');
assert(serverSource.includes("permissions.includes('reports.cash.view')") &&
  serverSource.includes('includeCashDetails'),
  'Les rapprochements et détails de caisse exigent reports.cash.view');
assert(firestoreRules.includes("match /payments/{paymentId}") &&
  firestoreRules.includes('allow read, write: if false;'),
  'Les écritures de paiement restent interdites au client et accessibles seulement au serveur de confiance');

console.log('\nRésultat politique des rôles : ' + passed + ' réussis / ' + failed + ' échoués.');
if (failed) process.exitCode = 1;
