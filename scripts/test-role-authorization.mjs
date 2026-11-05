import { resolveRolePermissions, resolveManagerPermissionUpdate, canManageStaffMember } from '../src/server/platformAdmin.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
}

const cashierBase = resolveRolePermissions('cashier', undefined, false) || [];
const cashierWithExtra = resolveRolePermissions('cashier', ['orders.cancel', 'payments.refund'], true);
assert(!cashierBase.includes('orders.cancel') && !cashierBase.includes('payments.refund'), 'Les droits annulation/remboursement ne sont pas attribués par défaut au caissier');
assert(cashierWithExtra?.includes('orders.cancel') && cashierWithExtra?.includes('payments.refund'), 'Le propriétaire peut accorder explicitement annulation et remboursement au caissier');
assert(resolveRolePermissions('cashier', ['menu.manage'], true) === null, 'Le caissier ne peut jamais recevoir menu.manage');
assert(resolveRolePermissions('server', ['cash.manage'], true) === null, 'Le serveur ne peut jamais recevoir cash.manage');
assert(resolveRolePermissions('kitchen', ['orders.cancel'], true) === null, 'Cuisine/Bar ne peut jamais recevoir orders.cancel');
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


assert(canManageStaffMember('manager', 'cashier'), 'Le manager peut administrer un caissier');
assert(canManageStaffMember('manager', 'server'), 'Le manager peut administrer un serveur');
assert(canManageStaffMember('manager', 'kitchen'), 'Le manager peut administrer Cuisine/Bar');
assert(!canManageStaffMember('manager', 'manager'), 'Le manager ne peut pas administrer un autre manager');
assert(!canManageStaffMember('manager', 'owner'), 'Le manager ne peut pas administrer le propriétaire');
assert(canManageStaffMember('owner', 'manager'), 'Le propriétaire peut administrer un manager');
assert(!canManageStaffMember('owner', 'owner'), 'Le propriétaire ne peut pas supprimer le rôle propriétaire depuis le personnel');

console.log('\nRésultat politique des rôles : ' + passed + ' réussis / ' + failed + ' échoués.');
if (failed) process.exitCode = 1;
