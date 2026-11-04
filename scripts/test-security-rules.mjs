import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc
} from 'firebase/firestore';

const projectId = 'demo-restaumax';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
});
let passed = 0;
let failed = 0;
function check(ok, label) {
  if (ok) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
}
async function denies(promise, label) {
  try { await assertFails(promise); check(true, label); }
  catch (error) { check(false, label + ' — ' + (error?.message || error)); }
}
async function allows(promise, label) {
  try { await assertSucceeds(promise); check(true, label); }
  catch (error) { check(false, label + ' — ' + (error?.message || error)); }
}
const restaurant = slug => doc(env.unauthenticatedContext().firestore(), 'restaurants', slug);
const order = (db, slug, id='order-1') => doc(db, 'restaurants', slug, 'orders', id);
const table = (db, slug, id='table-1') => doc(db, 'restaurants', slug, 'tables', id);

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const slug of ['rest-a', 'rest-b', 'rest-suspended', 'rest-provisioning']) {
      await setDoc(doc(db, 'restaurants', slug), {
        slug, name: slug, isOpen: true,
        status: slug === 'rest-suspended' ? 'suspended' : slug === 'rest-provisioning' ? 'provisioning' : 'active',
        ownerUid: 'owner-a', ownerEmail: 'owner@example.test'
      });
    }
    const members = [
      ['owner-a','rest-a','owner',['menu.manage','orders.manage','tables.manage','settings.manage','staff.manage']],
      ['manager-a','rest-a','manager',['menu.manage','orders.manage','orders.view','tables.view','tables.manage','pos.access','cash.view','cash.manage','reports.view','staff.manage','settings.view']],
      ['cashier-a','rest-a','cashier',['pos.access','cash.view','cash.manage','orders.view']],
      ['server-a','rest-a','server',['pos.access','orders.view','tables.view','orders.serve']],
      ['kitchen-a','rest-a','kitchen',['orders.view','kitchen.access']],
      ['cashier-escalated','rest-a','cashier',['menu.manage','orders.view','pos.access']],
      ['cashier-cancel','rest-a','cashier',['orders.view','pos.access','cash.view','cash.manage','orders.cancel']],
      ['old-token','rest-a','server',['orders.view','tables.view','pos.access','orders.serve']],
      ['stale-token','rest-a','server',['orders.view','tables.view','pos.access','orders.serve']]
    ];
    for (const [uid, restaurantSlug, role, permissions] of members) {
      await setDoc(doc(db, 'managers', uid), {
        uid, restaurantSlug, role, permissions, active: uid !== 'old-token',
        sessionVersion: uid === 'old-token' || uid === 'stale-token' ? 3 : 0
      });
    }
    const tableData = { id:'table-1', tableNumber:'1', capacity:4, isActive:true };
    await setDoc(doc(db,'restaurants/rest-a/tables/table-1'),tableData);
    await setDoc(doc(db,'restaurants/rest-b/tables/table-1'),tableData);
    const orderData = {
      id:'order-1', orderNumber:'#CMD-001', restaurantSlug:'rest-a',
      orderMode:'sur_place', tableNumber:'1',
      items:[{id:'line-1',name:'Plat test',quantity:1,unitPrice:1000}],
      totalAmount:1000, status:'pending'
    };
    await setDoc(doc(db,'restaurants/rest-a/orders/order-1'),orderData);
    await setDoc(doc(db,'restaurants/rest-a/orders/order-kitchen'),{...orderData,id:'order-kitchen',orderNumber:'#CMD-002'});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-server'),{...orderData,id:'order-server',orderNumber:'#CMD-003',status:'ready'});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-cashier'),{...orderData,id:'order-cashier',orderNumber:'#CMD-004'});
    await setDoc(doc(db,'restaurants/rest-b/orders/order-1'),{...orderData,restaurantSlug:'rest-b'});
    await setDoc(doc(db,'restaurants/rest-a/menuItems/dish-1'),{
      id:'dish-1',restaurantSlug:'rest-a',name:'Plat',category:'plats',price:1000,available:true
    });
    await setDoc(doc(db,'restaurants/rest-a/staff/manager-b'),{
      uid:'manager-b',role:'manager',active:true,restaurantSlug:'rest-a'
    });
  });

  const a = uid => env.authenticatedContext(uid).firestore();
  const anonymous = env.unauthenticatedContext().firestore();

  // 1. Strict tenant isolation.
  await denies(getDoc(table(a('manager-a'),'rest-b')), 'Restaurant A ne peut pas lire les tables de B');
  await denies(setDoc(table(a('manager-a'),'rest-b'),{id:'table-1',tableNumber:'X',capacity:2,isActive:true}), 'Restaurant A ne peut pas écrire dans B');
  await denies(deleteDoc(table(a('manager-a'),'rest-b')), 'Restaurant A ne peut pas supprimer dans B');

  // 2. A server cannot collect payment or cancel an order.
  await denies(setDoc(doc(a('server-a'),'restaurants/rest-a/payments/payment-1'),{amount:1000}), 'Un serveur ne peut pas créer un paiement');
  await denies(updateDoc(order(a('server-a'),'rest-a'),{status:'cancelled'}), 'Un serveur ne peut pas annuler une commande');

  // 3. A cashier cannot change menu prices or staff permissions.
  await denies(updateDoc(doc(a('cashier-a'),'restaurants/rest-a/menuItems/dish-1'),{price:1}), 'Un caissier ne peut pas modifier le prix du menu');
  await denies(updateDoc(doc(a('cashier-escalated'),'restaurants/rest-a/menuItems/dish-1'),{price:1}), 'Un droit menu.manage falsifié ne dépasse pas le plafond du caissier');
  await denies(updateDoc(doc(a('cashier-a'),'restaurants/rest-a/staff/manager-b'),{permissions:['settings.manage']}), 'Un caissier ne peut pas modifier les permissions du personnel');
  await allows(updateDoc(order(a('cashier-cancel'),'rest-a','order-cashier'),{status:'cancelled'}), 'Un caissier peut annuler uniquement si le droit explicite orders.cancel lui est accordé');

  // 4. Kitchen cannot cancel orders or collect payments.
  await denies(updateDoc(order(a('kitchen-a'),'rest-a'),{status:'cancelled'}), 'Cuisine/Bar ne peut pas annuler une commande');
  await allows(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'in_prep'}), 'Cuisine/Bar peut démarrer la préparation');
  await allows(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'ready'}), 'Cuisine/Bar peut marquer une commande prête');
  await denies(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'completed'}), 'Cuisine/Bar ne peut pas déclarer une commande servie');
  await allows(updateDoc(order(a('server-a'),'rest-a','order-server'),{status:'completed'}), 'Le serveur peut confirmer la remise d’une commande prête');
  await denies(setDoc(doc(a('kitchen-a'),'restaurants/rest-a/payments/payment-2'),{amount:1000}), 'Cuisine/Bar ne peut pas encaisser');

  // 5. A manager cannot change ownership or another manager's account.
  await denies(updateDoc(doc(a('manager-a'),'restaurants/rest-a'),{ownerUid:'manager-a'}), 'Un manager ne peut pas modifier le propriétaire');
  await denies(updateDoc(doc(a('manager-a'),'managers/manager-b'),{active:false}), 'Un manager ne peut pas modifier le compte d’un autre manager');

  // 6. A suspended account is denied even with an old token.
  await denies(getDoc(table(a('old-token'),'rest-a')), 'Un compte suspendu est refusé malgré un ancien token');
  await denies(
    getDoc(table(env.authenticatedContext('stale-token',{sessionVersion:2}).firestore(),'rest-a')),
    'Un ancien token reste refusé après réactivation avec une nouvelle version de session'
  );

  // 7. A platform super-admin claim is not restaurant membership.
  await denies(getDoc(table(env.authenticatedContext('platform-admin',{role:'super_admin'}).firestore(),'rest-a')), 'Le super-admin plateforme ne reçoit pas de droits opérationnels implicites');

  // 8. Anonymous customers cannot read any order by guessed ID.
  await denies(getDoc(order(anonymous,'rest-a')), 'Un client non authentifié ne peut pas lire une commande par son identifiant');
  await denies(getDocs(collection(anonymous,'restaurants/rest-a/orders')), 'Un client non authentifié ne peut pas lister les commandes');

  // 9. Direct field tampering is rejected even for an owner.
  await denies(updateDoc(doc(a('owner-a'),'restaurants/rest-a'),{ownerUid:'attacker'}), 'Le champ ownerUid est protégé contre la falsification directe');
  await denies(updateDoc(order(a('owner-a'),'rest-a'),{totalAmount:1}), 'Le montant d’une commande est immuable depuis le SDK client');

  // 10. Non-active restaurants cannot expose operational data or create QR sessions.
  await denies(getDoc(table(a('manager-a'),'rest-provisioning')), 'Un restaurant provisioning ne permet aucun accès opérationnel');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-provisioning/table_sessions/session-1'),{status:'active'}), 'Un client ne peut pas créer une session QR dans un restaurant provisioning');
  await denies(getDoc(table(a('manager-a'),'rest-suspended')), 'Un restaurant suspendu ne permet aucun accès opérationnel');

  console.log('\nRésultat tests règles Firestore : ' + passed + ' réussis / ' + failed + ' échoués.');
  if (failed) process.exitCode = 1;
} finally {
  await env.cleanup();
}
