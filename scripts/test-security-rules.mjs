import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc
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
      });
      await setDoc(doc(db, 'restaurants', slug, 'private', 'ownership'), {
        ownerUid: slug === 'rest-b' ? 'owner-b' : 'owner-a',
        ownerEmail: slug === 'rest-b' ? 'owner-b@example.test' : 'owner@example.test'
      });
    }
    const members = [
      ['owner-a','rest-a','owner',['menu.manage','orders.manage','tables.manage','settings.manage','staff.manage','inventory.view','inventory.manage']],
      ['owner-b','rest-b','owner',['menu.manage','orders.manage','tables.manage','settings.manage','staff.manage','inventory.view','inventory.manage']],
      ['manager-b','rest-b','manager',['menu.manage','orders.manage','orders.view','tables.view','tables.manage','pos.access','cash.view','cash.manage','reports.view','staff.manage','settings.view','inventory.view','inventory.manage']],
      ['manager-a','rest-a','manager',['menu.manage','orders.manage','orders.view','tables.view','tables.manage','pos.access','cash.view','cash.manage','reports.view','staff.manage','settings.view','inventory.view','inventory.manage']],
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
    await setDoc(doc(db,'restaurants/rest-a/orders/order-kitchen'),{...orderData,id:'order-kitchen',orderNumber:'#CMD-002',kitchenItemsCompletedCount:1});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-kitchen-incomplete'),{...orderData,id:'order-kitchen-incomplete',orderNumber:'#CMD-005',status:'in_prep',kitchenItemsCompletedCount:0});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-manager-incomplete'),{...orderData,id:'order-manager-incomplete',orderNumber:'#CMD-006',status:'in_prep',kitchenItemsCompletedCount:0});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-owner-incomplete'),{...orderData,id:'order-owner-incomplete',orderNumber:'#CMD-007',status:'in_prep',kitchenItemsCompletedCount:0});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-server'),{...orderData,id:'order-server',orderNumber:'#CMD-003',status:'ready'});
    await setDoc(doc(db,'restaurants/rest-a/orders/order-cashier'),{...orderData,id:'order-cashier',orderNumber:'#CMD-004'});
    await setDoc(doc(db,'restaurants/rest-b/orders/order-1'),{...orderData,restaurantSlug:'rest-b'});
    await setDoc(doc(db,'restaurants/rest-a/inventoryItems/rice'),{
      id:'rice',name:'Riz',unit:'kg',quantity:10,minQuantity:2,unitCost:500,active:true
    });
    await setDoc(doc(db,'restaurants/rest-a/stockMovements/initial-rice'),{
      itemId:'rice',itemName:'Riz',unit:'kg',quantityBefore:0,delta:10,quantityAfter:10,reason:'Stock initial'
    });
    await setDoc(doc(db,'restaurants/rest-a/menuItems/dish-1'),{
      id:'dish-1',restaurantSlug:'rest-a',name:'Plat A',category:'plats',price:1000,available:true
    });
    await setDoc(doc(db,'restaurants/rest-a/menuRecipes/dish-1'),{
      menuItemId:'dish-1', ingredients:[{itemId:'rice',quantityPerDish:0.2,unit:'kg'}]
    });
    await setDoc(doc(db,'restaurants/rest-b/menuItems/dish-1'),{
      id:'dish-1',restaurantSlug:'rest-b',name:'Plat B',category:'plats',price:1200,available:true
    });
    await setDoc(doc(db,'restaurants/rest-b/inventoryItems/rice'),{
      id:'rice',name:'Riz B',unit:'kg',quantity:7,minQuantity:1,unitCost:900,active:true
    });
    await setDoc(doc(db,'restaurants/rest-b/menuRecipes/dish-1'),{
      menuItemId:'dish-1',menuItemName:'Plat B',lines:[{inventoryItemId:'rice',itemName:'Riz B',unit:'kg',quantityPerDish:0.3}]
    });
    await setDoc(doc(db,'restaurants/rest-a/staff/manager-b'),{
      uid:'manager-b',role:'manager',active:true,restaurantSlug:'rest-a'
    });
    await setDoc(doc(db, 'restaurantSubscriptions/rest-a'), {
      planName: 'Pro', priceFcfa: 15000, currency: 'XOF',
      billingCycle: 'monthly', status: 'active',
      startsAt: 1793836800000, endsAt: 1795046400000
    });
  });

  const a = uid => env.authenticatedContext(uid).firestore();
  const anonymous = env.unauthenticatedContext().firestore();

  // 1. Strict tenant isolation.
  await denies(getDoc(doc(a('manager-a'),'restaurants/rest-b')), 'Restaurant A ne peut pas lire le profil privé de B lorsqu’il est authentifié');
  await denies(getDoc(doc(a('manager-a'),'restaurants/rest-b/menuItems/dish-1')), 'Restaurant A ne peut pas lire le menu privé de B lorsqu’il est authentifié');
  await denies(getDocs(collection(a('manager-a'),'restaurants/rest-b/menuItems')), 'Restaurant A ne peut pas lister le menu de B');
  await denies(getDoc(doc(a('owner-a'),'restaurants/rest-b/menuItems/dish-1')), 'Le propriétaire A ne peut pas lire le menu du propriétaire B');
  await allows(getDoc(doc(a('owner-b'),'restaurants/rest-b/menuItems/dish-1')), 'Le propriétaire B peut lire son propre menu');
  await allows(getDoc(doc(a('manager-b'),'restaurants/rest-b/menuItems/dish-1')), 'Le manager B peut lire le menu de son restaurant');
  await denies(getDoc(doc(a('manager-b'),'restaurants/rest-a/menuItems/dish-1')), 'Le manager B ne peut pas lire le menu du restaurant A');
  await allows(getDoc(doc(anonymous,'restaurants/rest-b')), 'Le profil public reste lisible pour un client non authentifié');
  const publicRestaurantSnapshot = await getDoc(doc(anonymous, 'restaurants/rest-a'));
  check(publicRestaurantSnapshot.exists() && !('subscription' in (publicRestaurantSnapshot.data() || {})),
    'Le document restaurant public ne contient aucun champ d’abonnement');
  await allows(getDoc(doc(anonymous,'restaurants/rest-b/menuItems/dish-1')), 'Le menu public reste lisible pour un client non authentifié');
  await denies(getDoc(table(a('manager-a'),'rest-b')), 'Restaurant A ne peut pas lire les tables de B');
  await denies(setDoc(table(a('manager-a'),'rest-b'),{id:'table-1',tableNumber:'X',capacity:2,isActive:true}), 'Restaurant A ne peut pas écrire dans B');
  await denies(deleteDoc(table(a('manager-a'),'rest-b')), 'Restaurant A ne peut pas supprimer dans B');

  // 1b. Inventory is readable by authorized staff, but every mutation is backend-only.
  await allows(getDocs(collection(a('owner-a'),'restaurants/rest-a/inventoryItems')), 'Le propriétaire peut consulter le catalogue de stock');
  await allows(getDocs(collection(a('manager-a'),'restaurants/rest-a/inventoryItems')), 'Le manager avec inventory.view peut consulter le stock');
  await allows(getDocs(collection(a('owner-b'),'restaurants/rest-b/inventoryItems')), 'Le propriétaire B consulte uniquement son stock');
  await denies(getDocs(collection(a('owner-a'),'restaurants/rest-b/inventoryItems')), 'Le propriétaire A ne peut pas lister le stock B');
  await denies(getDocs(collection(a('manager-a'),'restaurants/rest-b/inventoryItems')), 'Le manager A ne peut pas lister le stock B');
  await allows(getDoc(doc(a('owner-a'),'restaurants/rest-a/menuRecipes/dish-1')), 'Le propriétaire A consulte sa fiche technique privée');
  await allows(getDoc(doc(a('manager-a'),'restaurants/rest-a/menuRecipes/dish-1')), 'Le manager A autorisé consulte sa fiche technique privée');
  await denies(getDoc(doc(a('owner-b'),'restaurants/rest-a/menuRecipes/dish-1')), 'Le propriétaire B ne peut pas lire les coûts de recette A');
  await denies(getDoc(doc(a('manager-b'),'restaurants/rest-a/menuRecipes/dish-1')), 'Le manager B ne peut pas lire les coûts de recette A');
  await denies(getDoc(doc(anonymous,'restaurants/rest-a/menuRecipes/dish-1')), 'Les clients QR ne peuvent pas lire les fiches techniques ni les coûts');
  await denies(setDoc(doc(a('owner-a'),'restaurants/rest-a/inventoryItems/rice-forged'),{
    id:'rice-forged',name:'Riz falsifié',unit:'kg',quantity:999,minQuantity:0,unitCost:1,active:true
  }), 'Même le propriétaire ne peut pas créer directement un article de stock via le SDK client');
  await denies(updateDoc(doc(a('manager-a'),'restaurants/rest-a/inventoryItems/rice'),{quantity:1}), 'Le manager ne peut pas modifier directement une quantité de stock');
  await denies(deleteDoc(doc(a('manager-a'),'restaurants/rest-a/inventoryItems/rice')), 'Le manager ne peut pas supprimer directement un article de stock');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/stockMovements/forged'),{
    itemId:'rice',delta:999,quantityAfter:1009
  }), 'Le manager ne peut pas fabriquer une entrée dans le journal des mouvements');
  await denies(updateDoc(doc(a('manager-a'),'restaurants/rest-a/stockMovements/initial-rice'),{quantityAfter:0}), 'Le journal des mouvements est immuable');
  await denies(deleteDoc(doc(a('manager-a'),'restaurants/rest-a/stockMovements/initial-rice')), 'Le journal des mouvements ne peut pas être supprimé');

  // 2. Subscription metadata is private and never readable through the client SDK.
  await denies(getDoc(doc(anonymous, 'restaurantSubscriptions/rest-a')), 'Un client QR anonyme ne peut pas lire les données privées d’abonnement');
  await denies(getDoc(doc(a('owner-a'), 'restaurantSubscriptions/rest-a')), 'Même le propriétaire ne lit pas les données privées d’abonnement via Firestore client');
  await denies(getDocs(collection(anonymous, 'restaurantSubscriptions')), 'Un client ne peut pas lister les abonnements de la plateforme');
  await denies(setDoc(doc(a('owner-a'), 'restaurantSubscriptions/rest-a'), { status: 'cancelled' }), 'Un propriétaire ne peut pas modifier son abonnement directement');

  // 3. A server cannot collect payment or cancel an order.
  await denies(setDoc(doc(a('server-a'),'restaurants/rest-a/payments/payment-1'),{amount:1000}), 'Un serveur ne peut pas créer un paiement');
  await denies(updateDoc(order(a('server-a'),'rest-a'),{status:'cancelled'}), 'Un serveur ne peut pas annuler une commande');

  // 2b. Catalogue writes are tenant-scoped and require the menu.manage role ceiling.
  const managerDish = doc(a('manager-a'), 'restaurants/rest-a/menuItems/dish-manager-created');
  await allows(setDoc(managerDish, {
    id:'dish-manager-created', restaurantSlug:'rest-a', name:'Plat manager',
    category:'plats', price:2500, available:true, description:'Test', imageUrl:'',
    prepTimeMinutes:15, lowStockThreshold:4, allergens:['arachides','lait'], spiceLevel:2,
    pairings:['attiéké','alloco'], translations:{en:{name:'Manager dish',description:'Test description'},pt:{name:'Prato do gerente'}}
  }), 'Un manager autorisé peut créer un plat avec allergènes, piquant, accompagnements et traductions');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-invalid-spice'),{
    id:'dish-invalid-spice',restaurantSlug:'rest-a',name:'Piment invalide',category:'plats',price:2500,available:true,spiceLevel:4
  }), 'Le catalogue refuse un niveau de piquant hors plage');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-invalid-translation'),{
    id:'dish-invalid-translation',restaurantSlug:'rest-a',name:'Traduction invalide',category:'plats',price:2500,available:true,
    translations:{en:{name:'x'.repeat(201)}}
  }), 'Le catalogue refuse une traduction trop longue');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-b/menuItems/dish-cross-tenant'),{
    id:'dish-cross-tenant',restaurantSlug:'rest-b',name:'Plat croisé',category:'plats',price:2500,available:true
  }), 'Le manager A ne peut pas créer un plat dans le catalogue B');
  await allows(updateDoc(doc(a('owner-b'),'restaurants/rest-b/menuItems/dish-1'),{price:1300}), 'Le propriétaire B peut modifier le prix de son propre menu');
  await denies(updateDoc(doc(a('owner-a'),'restaurants/rest-b/menuItems/dish-1'),{price:1}), 'Le propriétaire A ne peut pas modifier le prix du menu B');
  const invalidMenuBase = { restaurantSlug:'rest-a', name:'Plat invalide', category:'plats', price:2500, available:true };
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-float-price'),{
    ...invalidMenuBase, id:'dish-float-price', price:2500.5
  }), 'Le catalogue refuse un prix FCFA non entier');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-zero-price'),{
    ...invalidMenuBase, id:'dish-zero-price', price:0
  }), 'Le catalogue refuse un prix nul comme le formulaire de gestion');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-zero-prep'),{
    ...invalidMenuBase, id:'dish-zero-prep', prepTimeMinutes:0
  }), 'Le catalogue refuse un temps de préparation nul');

  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-invalid-category'),{
    ...invalidMenuBase, id:'dish-invalid-category', category:'autre'
  }), 'Le catalogue refuse une catégorie hors nomenclature');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-invalid-options'),{
    ...invalidMenuBase, id:'dish-invalid-options', optionGroups:'corrompu'
  }), 'Le catalogue refuse une structure de groupes d’options qui n’est pas une liste');
  await denies(setDoc(doc(a('manager-a'),'restaurants/rest-a/menuItems/dish-invalid-prep-time'),{
    ...invalidMenuBase, id:'dish-invalid-prep-time', prepTimeMinutes:1441
  }), 'Le catalogue refuse un temps de préparation hors plage');

  await allows(updateDoc(managerDish, { price:2750 }), 'Un manager autorisé peut modifier le prix d’un plat');
  await denies(updateDoc(managerDish, { restaurantSlug:'rest-b' }), 'Un manager ne peut pas déplacer un plat vers un autre restaurant');
  await allows(deleteDoc(managerDish), 'Un manager autorisé peut supprimer un plat du catalogue');
  await denies(deleteDoc(doc(a('cashier-a'),'restaurants/rest-a/menuItems/dish-1')), 'Un caissier ne peut pas supprimer un plat du catalogue');
  await denies(deleteDoc(doc(a('cashier-escalated'),'restaurants/rest-a/menuItems/dish-1')), 'Un droit menu.manage falsifié ne permet pas de supprimer un plat hors plafond de rôle');
  await denies(updateDoc(doc(a('server-a'),'restaurants/rest-a/menuItems/dish-1'),{price:1}), 'Un serveur sans menu.manage ne peut pas modifier le catalogue');

  // 3. A cashier cannot change menu prices or staff permissions.
  await denies(updateDoc(doc(a('cashier-a'),'restaurants/rest-a/menuItems/dish-1'),{price:1}), 'Un caissier ne peut pas modifier le prix du menu');
  await denies(updateDoc(doc(a('cashier-escalated'),'restaurants/rest-a/menuItems/dish-1'),{price:1}), 'Un droit menu.manage falsifié ne dépasse pas le plafond du caissier');

  const managerMenuDb = a('manager-a');
  const recipeRef = doc(managerMenuDb,'restaurants/rest-a/menuRecipes/dish-1');
  const linkedDishRef = doc(managerMenuDb,'restaurants/rest-a/menuItems/dish-1');
  await denies(deleteDoc(recipeRef), 'Un manager ne peut pas supprimer une recette sans supprimer le plat associé');
  await denies(deleteDoc(linkedDishRef), 'Un manager ne peut pas supprimer un plat tant que sa recette associée subsiste');
  await allows(runTransaction(managerMenuDb, async transaction => {
    const [dishSnapshot, recipeSnapshot] = await Promise.all([
      transaction.get(linkedDishRef),
      transaction.get(recipeRef)
    ]);
    if (recipeSnapshot.exists()) transaction.delete(recipeRef);
    if (dishSnapshot.exists()) transaction.delete(linkedDishRef);
  }), 'Le manager peut supprimer atomiquement le plat et sa fiche recette liée');
  const [deletedDish, deletedRecipe] = await Promise.all([getDoc(linkedDishRef), getDoc(recipeRef)]);
  check(!deletedDish.exists() && !deletedRecipe.exists(), 'La suppression atomique ne laisse aucune recette orpheline');

  await denies(updateDoc(doc(a('cashier-a'),'restaurants/rest-a/staff/manager-b'),{permissions:['settings.manage']}), 'Un caissier ne peut pas modifier les permissions du personnel');
  await denies(updateDoc(order(a('cashier-cancel'),'rest-a','order-cashier'),{status:'cancelled'}), 'Même un caissier autorisé doit passer par le backend transactionnel pour annuler');

  // 4. Kitchen cannot cancel orders or collect payments.
  await denies(updateDoc(order(a('kitchen-a'),'rest-a'),{status:'cancelled'}), 'Cuisine/Bar ne peut pas annuler une commande');
  await denies(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'in_prep'}), 'Cuisine/Bar démarre la préparation uniquement via le backend transactionnel');
  await denies(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'ready'}), 'Cuisine/Bar marque une commande prête uniquement via le backend transactionnel');
  await denies(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen-incomplete'),{status:'ready'}), 'Cuisine/Bar ne peut pas déclarer prête une commande avec des lignes non terminées');
  await denies(updateDoc(order(a('manager-a'),'rest-a','order-manager-incomplete'),{status:'ready'}), 'Le manager ne peut pas contourner le pointage des lignes cuisine');
  await denies(updateDoc(order(a('owner-a'),'rest-a','order-owner-incomplete'),{status:'ready'}), 'Le propriétaire ne peut pas contourner le pointage des lignes cuisine');
  await denies(updateDoc(order(a('owner-a'),'rest-a','order-owner-incomplete'),{kitchenItemsCompletedCount:1}), 'Le compteur de lignes terminées est modifiable uniquement par le backend');
  await denies(updateDoc(order(a('kitchen-a'),'rest-a','order-kitchen'),{status:'completed'}), 'Cuisine/Bar ne peut pas déclarer une commande servie');
  await denies(updateDoc(order(a('server-a'),'rest-a','order-server'),{status:'completed'}), 'Le serveur confirme la remise uniquement via le backend transactionnel');
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
  await denies(getDoc(doc(a('owner-a'),'restaurants/rest-a/private/ownership')), 'Le propriétaire ne peut pas lire directement ses métadonnées privées');
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
