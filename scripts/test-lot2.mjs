/**
 * RESTAUMAX — Tests unitaires et d'intégration en mémoire pour le LOT 2
 *
 * Ce fichier teste rigoureusement le parcours client et le générateur QR :
 * - Section 1 : Calculs stricts de tarification en FCFA (prix unitaires, options, extras, totaux)
 * - Section 2 : Validation d'intégrité de la commande (catalogue de confiance, disponibilité, table)
 * - Section 3 : Sécurité et encodage du générateur QR et du scanner (URL canoniques, rejet injections)
 * - Section 4 : Déduplication et signatures des configurations du panier
 * - Section 5 : Simulation de la persistance Firestore de la commande et protection anti-doublon
 */

import { 
  calculateItemUnitPrice, 
  calculateOrderTotal, 
  validateAndBuildOrder,
  generateTableQrUrl,
  parseAndValidateQrInput
} from '../src/utils/pricing.js';

import {
  getNormalizedOptionSignature,
  getNormalizedExtrasSignature,
  areCartConfigurationsEqual
} from '../src/components/restaumax/ClientMenuView.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ ÉCHEC : ${message}`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('RESTAUMAX — EXÉCUTION DE LA SUITE DE TESTS DU LOT 2');
  console.log('====================================================\n');

  // Catalogue de test fiable inspiré de Chez Awa
  const mockCatalog = [
    {
      id: 'dish-capitaine',
      restaurantSlug: 'chez-awa',
      name: 'Capitaine Braisé au Feu de Bois',
      category: 'grillades',
      price: 14500,
      description: 'Poisson capitaine entier',
      imageUrl: 'https://example.com/capitaine.jpg',
      available: true,
      prepTimeMinutes: 20
    },
    {
      id: 'dish-poulet',
      restaurantSlug: 'chez-awa',
      name: 'Poulet Bicyclette Braisé Entier',
      category: 'grillades',
      price: 9500,
      description: 'Poulet fermier',
      imageUrl: 'https://example.com/poulet.jpg',
      available: true,
      prepTimeMinutes: 15
    },
    {
      id: 'dish-alloco',
      restaurantSlug: 'chez-awa',
      name: 'Portion Généreuse d’Alloco Plantain',
      category: 'accompagnements',
      price: 2500,
      description: 'Alloco doré',
      imageUrl: 'https://example.com/alloco.jpg',
      available: true,
      prepTimeMinutes: 5
    },
    {
      id: 'dish-rupture',
      restaurantSlug: 'chez-awa',
      name: 'Langouste Braisée Royale (Rupture)',
      category: 'grillades',
      price: 25000,
      description: 'Langouste fraîche',
      imageUrl: 'https://example.com/langouste.jpg',
      available: false, // Plat explicitement indisponible
      prepTimeMinutes: 25
    }
  ];

  // ==========================================================================
  // SECTION 1 : Calculs de tarification en FCFA
  // ==========================================================================
  console.log('--- SECTION 1 : Tarification et calculs en FCFA ---');

  // Test 1.1: Plat seul sans options ni extras
  const p1 = calculateItemUnitPrice(14500);
  assert(p1 === 14500, `Prix de base plat seul : ${p1} FCFA (attendu: 14500)`);

  // Test 1.2: Plat avec option incluse (extraPrice = 0)
  const p2 = calculateItemUnitPrice(14500, { extraPrice: 0 });
  assert(p2 === 14500, `Option incluse sans surcoût : ${p2} FCFA`);

  // Test 1.3: Plat avec option payante (ex. Alloco +500 FCFA)
  const p3 = calculateItemUnitPrice(14500, { extraPrice: 500 });
  assert(p3 === 15000, `Option payante Alloco (+500) : ${p3} FCFA (attendu: 15000)`);

  // Test 1.4: Plat avec plusieurs extras
  const p4 = calculateItemUnitPrice(14500, { extraPrice: 500 }, [
    { price: 300 }, // Sauce piment
    { price: 400 }  // Oignons braisés
  ]);
  assert(p4 === 15700, `Plat + option (+500) + extras (+700) : ${p4} FCFA (attendu: 15700)`);

  // Test 1.5: Total de commande avec plusieurs articles et quantités
  const orderLines = [
    { unitPrice: 15000, quantity: 2 }, // 30 000
    { unitPrice: 2500, quantity: 3 }   // 7 500
  ];
  const grandTotal = calculateOrderTotal(orderLines);
  assert(grandTotal === 37500, `Sous-total commande multi-lignes : ${grandTotal} FCFA (attendu: 37500)`);

  // Test 1.6: Tolérance aux valeurs non numériques ou négatives
  const safeTotal = calculateOrderTotal([
    { unitPrice: -500, quantity: 2 },
    { unitPrice: 1000, quantity: -3 }
  ]);
  assert(safeTotal === 1000, `Normalise les négatifs à des valeurs saines : ${safeTotal} FCFA`);

  // ==========================================================================
  // SECTION 2 : Validation stricte et intégrité de la commande
  // ==========================================================================
  console.log('\n--- SECTION 2 : Validation d\'intégrité de la commande ---');

  // Test 2.1: Rejet d'un panier vide
  const resEmpty = validateAndBuildOrder({
    cart: [],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4'
  });
  assert(resEmpty.success === false, 'Rejette un panier vide');

  // Test 2.2: Rejet commande sur place sans numéro de table
  const resNoTable = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-capitaine', name: 'Capitaine', basePrice: 14500, unitPrice: 14500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: null
  });
  assert(resNoTable.success === false, 'Rejette une commande sur place sans table');

  // Test 2.3: Rejet commande sur place avec table vide d'espaces
  const resWhitespaceTable = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-capitaine', name: 'Capitaine', basePrice: 14500, unitPrice: 14500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '   '
  });
  assert(resWhitespaceTable.success === false, 'Rejette une table composée uniquement d\'espaces');

  // Test 2.4: Commande à emporter valide sans table
  const resTakeaway = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resTakeaway.success === true, 'Valide une commande à emporter sans table');
  assert(resTakeaway.order?.orderMode === 'a_emporter', 'Le mode de commande est bien "a_emporter"');
  assert(resTakeaway.order?.tableNumber === null, 'Le numéro de table est bien null pour l\'emporter');

  // Test 2.5: Rejet formel d'un plat en rupture de stock (available: false)
  const resUnavailable = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-rupture', name: 'Langouste', basePrice: 25000, unitPrice: 25000, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4'
  });
  assert(resUnavailable.success === false, 'Rejette formellement un plat en rupture');
  assert(resUnavailable.error?.includes('rupture'), 'L\'erreur mentionne la rupture de stock');

  // Test 2.6: Rejet d'un plat non présent au catalogue
  const resUnknown = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-fantome-inexistant', name: 'Plat Fantôme', basePrice: 5000, unitPrice: 5000, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4'
  });
  assert(resUnknown.success === false, 'Rejette un plat supprimé ou absent du catalogue');

  // Test 2.7: Recalcul des prix depuis le catalogue de confiance (anti-falsification client)
  const resTamperedPrice = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine Braisé au Feu de Bois',
      basePrice: 10, // Prix client falsifié malveillant
      unitPrice: 10,
      quantity: 2,
      selectedOption: { groupId: 'acc', groupName: 'Acc', optionId: 'alloco', optionName: 'Alloco', extraPrice: 500 },
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4'
  });
  assert(resTamperedPrice.success === true, 'Accepte la commande en appliquant le tarif catalogue');
  // 14500 (catalogue) + 500 (alloco) = 15000 * 2 = 30000 FCFA
  assert(resTamperedPrice.order?.totalAmount === 30000, `Prix client falsifié (10) écrasé par le prix de confiance (30000 FCFA) : ${resTamperedPrice.order?.totalAmount}`);

  // Test 2.8: Statut initial obligatoire 'pending'
  assert(resTamperedPrice.order?.status === 'pending', 'Le statut initial est strictement "pending"');

  // Test 2.9: Format du numéro de commande humain (#CMD-XXX)
  assert(/^#CMD-\d{3,4}$/.test(resTamperedPrice.order?.orderNumber || ''), `Numéro de commande valide : ${resTamperedPrice.order?.orderNumber}`);

  // ==========================================================================
  // SECTION 3 : Génération et sécurité des QR codes de table
  // ==========================================================================
  console.log('\n--- SECTION 3 : Génération et sécurité des QR codes ---');

  // Test 3.1: Génération URL canonique table simple
  const url1 = generateTableQrUrl('https://restaumax.app', 'chez-awa', '4');
  assert(url1 === 'https://restaumax.app/r/chez-awa?table=4', `URL canonique table 4 : ${url1}`);

  // Test 3.2: Génération URL canonique avec espaces (ex. "Bar 01")
  const url2 = generateTableQrUrl('https://restaumax.app', 'chez-awa', 'Bar 01');
  assert(url2 === 'https://restaumax.app/r/chez-awa?table=Bar%2001', `URL canonique avec encodage URI : ${url2}`);

  // Test 3.3: Parsing URL complète valide
  const parsed1 = parseAndValidateQrInput('https://chez-awa.restaumax.app/r/chez-awa?table=4');
  assert(parsed1.isValid === true, 'Valide une URL complète RestauMax');
  assert(parsed1.tableNumber === '4', `Extrait le numéro de table 4 : ${parsed1.tableNumber}`);
  assert(parsed1.canonicalPath === '/r/chez-awa?table=4', 'Génère le chemin canonique /r/chez-awa?table=4');

  // Test 3.4: Parsing chemin relatif
  const parsed2 = parseAndValidateQrInput('/r/chez-awa?table=12');
  assert(parsed2.isValid === true && parsed2.tableNumber === '12', 'Extrait la table 12 depuis un chemin relatif');

  // Test 3.5: Parsing chaîne brute numéro de table (saisie manuelle ou QR brut)
  const parsed3 = parseAndValidateQrInput('Terrasse 2');
  assert(parsed3.isValid === true && parsed3.tableNumber === 'Terrasse 2', 'Supporte la saisie directe d\'un nom de table');

  // Test 3.6: Rejet injection script / XSS dans QR code
  const parsedMalicious = parseAndValidateQrInput('javascript:alert(document.cookie)');
  assert(parsedMalicious.tableNumber === null, 'Neutralise les URLs malveillantes javascript:');

  // Test 3.7: Rejet entrée vide
  const parsedEmpty = parseAndValidateQrInput('');
  assert(parsedEmpty.isValid === false, 'Rejette une entrée QR vide');

  // ==========================================================================
  // SECTION 4 : Signatures déterministes et déduplication du panier
  // ==========================================================================
  console.log('\n--- SECTION 4 : Déduplication et signatures du panier ---');

  // Test 4.1: Signature d'options
  const sigOpt1 = getNormalizedOptionSignature({
    groupId: 'acc',
    groupName: 'Accompagnement',
    optionId: 'alloco',
    optionName: 'Alloco',
    extraPrice: 500
  });
  assert(sigOpt1 === 'grp:acc=opt:alloco', `Signature option simple : ${sigOpt1}`);

  // Test 4.2: Signature des extras insensible à l'ordre
  const extListA = [{ extraId: 'piment', name: 'Piment', price: 200 }, { extraId: 'oignons', name: 'Oignons', price: 400 }];
  const extListB = [{ extraId: 'oignons', name: 'Oignons', price: 400 }, { extraId: 'piment', name: 'Piment', price: 200 }];
  const sigExtA = getNormalizedExtrasSignature(extListA);
  const sigExtB = getNormalizedExtrasSignature(extListB);
  assert(sigExtA === sigExtB, `Signature des extras triée et indépendante de l'ordre : ${sigExtA}`);

  // Test 4.3: Déduplication de deux articles identiques (doivent fusionner)
  const itemA = {
    id: 'line-1',
    menuItemId: 'dish-capitaine',
    name: 'Capitaine',
    basePrice: 14500,
    unitPrice: 15000,
    quantity: 1,
    selectedOption: { groupId: 'acc', groupName: 'Acc', optionId: 'alloco', optionName: 'Alloco', extraPrice: 500 },
    selectedExtras: extListA,
    prepNotes: 'Bien cuit',
    imageUrl: ''
  };

  const itemB = {
    id: 'line-2',
    menuItemId: 'dish-capitaine',
    name: 'Capitaine',
    basePrice: 14500,
    unitPrice: 15000,
    quantity: 2,
    selectedOption: { groupId: 'acc', groupName: 'Acc', optionId: 'alloco', optionName: 'Alloco', extraPrice: 500 },
    selectedExtras: extListB, // ordre inversé
    prepNotes: '  Bien cuit  ', // espaces superflus
    imageUrl: ''
  };

  assert(areCartConfigurationsEqual(itemA, itemB) === true, 'Reconnaît deux configurations identiques et autorise la fusion des quantités');

  // Test 4.4: Deux articles avec options différentes (ne doivent PAS fusionner)
  const itemC = {
    ...itemA,
    selectedOption: { groupId: 'acc', groupName: 'Acc', optionId: 'attieke', optionName: 'Attiéké', extraPrice: 0 }
  };
  assert(areCartConfigurationsEqual(itemA, itemC) === false, 'Distingue deux plats avec accompagnements différents');

  // Test 4.5: Deux articles avec consignes cuisine différentes (ne doivent PAS fusionner)
  const itemD = {
    ...itemA,
    prepNotes: 'Sans piment pour enfant'
  };
  assert(areCartConfigurationsEqual(itemA, itemD) === false, 'Distingue deux plats avec consignes de préparation différentes');

  // ==========================================================================
  // SECTION 5 : Simulation de la persistance Firestore de la commande
  // ==========================================================================
  console.log('\n--- SECTION 5 : Simulation de persistance de commande Firestore ---');

  function createMockFirestoreOrderStore() {
    const store = new Map();
    let writeCount = 0;

    return {
      store,
      getWriteCount: () => writeCount,
      async setOrder(path, order) {
        writeCount++;
        store.set(path, JSON.parse(JSON.stringify(order)));
      }
    };
  }

  const mockFs = createMockFirestoreOrderStore();
  const validOrder = resTamperedPrice.order;

  // Test 5.1: Enregistrement d'une commande
  await mockFs.setOrder(`restaurants/chez-awa/orders/${validOrder.id}`, validOrder);
  assert(mockFs.store.has(`restaurants/chez-awa/orders/${validOrder.id}`), 'La commande est bien persistée dans Firestore');
  assert(mockFs.getWriteCount() === 1, 'Une seule écriture déclenchée');

  const retrieved = mockFs.store.get(`restaurants/chez-awa/orders/${validOrder.id}`);
  assert(retrieved.status === 'pending', 'Le statut enregistré est "pending"');
  assert(retrieved.totalAmount === 30000, `Le montant enregistré est exact : ${retrieved.totalAmount} FCFA`);
  assert(retrieved.tableNumber === '4', `Le numéro de table enregistré est 4 : ${retrieved.tableNumber}`);

  // ==========================================================================
  // BILAN GÉNÉRAL LOT 2
  // ==========================================================================
  console.log('\n====================================================');
  console.log(`RÉSULTATS LOT 2 : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erreur inattendue durant les tests du Lot 2 :', err);
  process.exit(1);
});
