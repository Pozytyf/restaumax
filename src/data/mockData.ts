import { MenuItem, Table, KitchenTicket, CashDrawerState } from '../types/pos';

export const INITIAL_MENU_ITEMS: MenuItem[] = [
  // GRILLADES & SPÉCIALITÉS
  {
    id: 'grill-1',
    name: 'Capitaine Braisé au Feu de Bois',
    category: 'grillades',
    price: 14500,
    description: 'Poisson capitaine entier mariné aux épices kankankan, braisé braise douce, oignons caramélisés et piments doux.',
    imageUrl: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 20,
    course: 'plat',
    tags: ['Chef Special', 'Grillade']
  },
  {
    id: 'grill-2',
    name: 'Dibi d’Agneau Traditionnel',
    category: 'grillades',
    price: 12000,
    description: 'Tranches tendres d’agneau grillées à l’étouffée, moutarde de Dijon au piment doux et oignons émincés.',
    imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 18,
    course: 'plat',
    tags: ['Best Seller']
  },
  {
    id: 'grill-3',
    name: 'Poulet Bicyclette Braisé Entier',
    category: 'grillades',
    price: 9500,
    description: 'Poulet fermier mariné au gingembre, ail sauvage et citron vert, doré sur grille au charbon de bois.',
    imageUrl: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 15,
    course: 'plat',
    tags: ['Fermier']
  },
  {
    id: 'grill-4',
    name: 'Gambas Royales Flambées au Pastis',
    category: 'grillades',
    price: 18000,
    description: 'Grosses gambas fraîches sautées à l’ail persillé et flambées devant vous, sauce crémeuse anisée.',
    imageUrl: 'https://images.unsplash.com/photo-1559742811-822873691df8?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 14,
    course: 'plat',
    tags: ['Fruits de Mer']
  },
  {
    id: 'grill-5',
    name: 'Brochettes de Mérou & Poivrons',
    category: 'grillades',
    price: 11500,
    description: 'Dés de mérou noble enfilés avec poivrons tricolores, badigeonnés d’huile d’olive vierge au thym.',
    imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 12,
    course: 'plat',
    tags: ['Poisson']
  },

  // PLATS SIGNATURE
  {
    id: 'plat-1',
    name: 'Garba Prestige Thon Rouge',
    category: 'plats',
    price: 8500,
    description: 'Semoule d’attiéké fine servie avec pavé de thon rouge frit croustillant, tomates fraîches et piment rouge concassé.',
    imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 10,
    course: 'plat',
    tags: ['Signature']
  },
  {
    id: 'plat-2',
    name: 'Riz Gras Sénégalais au Mérou Royal',
    category: 'plats',
    price: 13500,
    description: 'Thiéboudienne rouge authentique cuit dans le bouillon épicé aux légumes racines mijotés.',
    imageUrl: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 16,
    course: 'plat',
    tags: ['Tradition']
  },
  {
    id: 'plat-3',
    name: 'Filet de Bœuf Sauce Poivre Vert',
    category: 'plats',
    price: 16000,
    description: 'Cœur de filet charolais 250g, réduction de crème fraîche au poivre vert frais de Madagascar.',
    imageUrl: 'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 14,
    course: 'plat',
    tags: ['Bœuf']
  },

  // ENTRÉES
  {
    id: 'entree-1',
    name: 'Salade Exotique Mangue & Avocat',
    category: 'entrees',
    price: 4500,
    description: 'Jeunes pousses de salade, dés de mangue greffée, avocat Hass, vinaigrette passion et graines de sésame grillées.',
    imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 6,
    course: 'entree',
    tags: ['Fraîcheur']
  },
  {
    id: 'entree-2',
    name: 'Pastels Dorés au Thon (6 pcs)',
    category: 'entrees',
    price: 3500,
    description: 'Petits chaussons sénégalais croustillants farcis au poisson épicé, accompagnés de sauce tomate relevée.',
    imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 8,
    course: 'entree',
    tags: ['Tapas']
  },
  {
    id: 'entree-3',
    name: 'Carpaccio de Mérou au Combava',
    category: 'entrees',
    price: 6500,
    description: 'Fines lamelles de poisson cru marinées au jus de combava, baies roses et huile d’olive douce.',
    imageUrl: 'https://images.unsplash.com/photo-1539136788836-5699e78bfc75?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 6,
    course: 'entree',
    tags: ['Cru']
  },

  // ACCOMPAGNEMENTS
  {
    id: 'acc-1',
    name: 'Alloco Banane Plantain Dorée',
    category: 'accompagnements',
    price: 2500,
    description: 'Bananes plantains mûres frites à la minute, dorées et fondantes avec petite sauce pimentée.',
    imageUrl: 'https://images.unsplash.com/photo-1628294895950-9805252327bc?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 5,
    course: 'plat',
    tags: ['Indispensable']
  },
  {
    id: 'acc-2',
    name: 'Attiéké Traditionnel de Grand-Lahou',
    category: 'accompagnements',
    price: 2000,
    description: 'Semoule de manioc fermentée étuvée à la vapeur, arrosée d’un filet d’huile d’arachide parfumée.',
    imageUrl: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 3,
    course: 'plat'
  },
  {
    id: 'acc-3',
    name: 'Frites Maison Croustillantes',
    category: 'accompagnements',
    price: 2000,
    description: 'Pommes de terre fraîches coupées au couteau, double cuisson à la graisse végétale.',
    imageUrl: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 6,
    course: 'plat'
  },

  // BOISSONS & COCKTAILS
  {
    id: 'bev-1',
    name: 'Cocktail Hibiscus Bissap & Menthe',
    category: 'boissons',
    price: 2500,
    description: 'Infusion fraîche de fleurs d’hibiscus, feuilles de menthe pilées, touche de fleur d’oranger.',
    imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 3,
    course: 'boisson',
    tags: ['Frais']
  },
  {
    id: 'bev-2',
    name: 'Jus de Gingembre Pressé & Ananas',
    category: 'boissons',
    price: 2500,
    description: 'Pur jus de gingembre frais tonique marié à la douceur de l’ananas pain de sucre.',
    imageUrl: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 3,
    course: 'boisson'
  },
  {
    id: 'bev-3',
    name: 'Bière Ivoire Spéciale 50cl',
    category: 'boissons',
    price: 2000,
    description: 'Bière blonde locale brassée à Abidjan, servie glacée dans un verre givré.',
    imageUrl: 'https://images.unsplash.com/photo-1608270192799-59e8f8d836a1?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 2,
    course: 'boisson'
  },
  {
    id: 'bev-4',
    name: 'Eau Minérale Awa Prestige 1.5L',
    category: 'boissons',
    price: 1500,
    description: 'Bouteille en verre tempérée ou frappée.',
    imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 1,
    course: 'boisson'
  },

  // DESSERTS
  {
    id: 'des-1',
    name: 'Moelleux Chocolat & Piment Doux',
    category: 'desserts',
    price: 4500,
    description: 'Chocolat ivoirien pure plantation 70%, cœur coulant relevé d’une larme de piment doux d’Espelette.',
    imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 8,
    course: 'dessert',
    tags: ['Gourmand']
  },
  {
    id: 'des-2',
    name: 'Coupe Glacée Mangue & Fruit de la Passion',
    category: 'desserts',
    price: 4000,
    description: 'Sorbets artisanaux plein fruit, morceaux de mangue fraîche et coulis acidulé.',
    imageUrl: 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?auto=format&fit=crop&w=600&q=80',
    available: true,
    prepTimeMinutes: 4,
    course: 'dessert'
  }
];

export const INITIAL_TABLES: Table[] = [
  // SALLE PRINCIPALE
  { id: 't-01', number: '01', name: 'Table 01', zone: 'salle', capacity: 2, status: 'available' },
  { id: 't-02', number: '02', name: 'Table 02', zone: 'salle', capacity: 4, status: 'occupied', currentTotal: 34500, assignedWaiter: 'Moussa D.', seatedAt: new Date(Date.now() - 48 * 60 * 1000), covers: 3 },
  { id: 't-03', number: '03', name: 'Table 03', zone: 'salle', capacity: 4, status: 'billing', currentTotal: 26000, assignedWaiter: 'Aïcha K.', seatedAt: new Date(Date.now() - 72 * 60 * 1000), covers: 4 },
  { id: 't-04', number: '04', name: 'Table 04', zone: 'salle', capacity: 6, status: 'available' },
  { id: 't-05', number: '05', name: 'Table 05', zone: 'salle', capacity: 8, status: 'reserved' },
  { id: 't-06', number: '06', name: 'Table 06', zone: 'salle', capacity: 4, status: 'occupied', currentTotal: 42000, assignedWaiter: 'Moussa D.', seatedAt: new Date(Date.now() - 25 * 60 * 1000), covers: 4 },

  // TERRASSE VIP
  { id: 't-07', number: '07', name: 'Terrasse 07', zone: 'terrasse', capacity: 4, status: 'occupied', currentTotal: 58500, assignedWaiter: 'Yao F.', seatedAt: new Date(Date.now() - 14 * 60 * 1000), covers: 4 },
  { id: 't-08', number: '08', name: 'Terrasse 08', zone: 'terrasse', capacity: 6, status: 'available' },
  { id: 't-09', number: '09', name: 'Terrasse 09 VIP', zone: 'terrasse', capacity: 10, status: 'occupied', currentTotal: 148000, assignedWaiter: 'Aïcha K.', seatedAt: new Date(Date.now() - 85 * 60 * 1000), covers: 8 },
  { id: 't-10', number: '10', name: 'Terrasse 10', zone: 'terrasse', capacity: 4, status: 'available' },

  // BAR & LOUNGE
  { id: 't-11', number: 'B1', name: 'Bar Tabouret 1', zone: 'bar', capacity: 1, status: 'available' },
  { id: 't-12', number: 'B2', name: 'Bar Tabouret 2', zone: 'bar', capacity: 1, status: 'occupied', currentTotal: 7000, assignedWaiter: 'Barman', seatedAt: new Date(Date.now() - 10 * 60 * 1000), covers: 1 },
  { id: 't-13', number: 'L1', name: 'Lounge Canapé 1', zone: 'bar', capacity: 5, status: 'billing', currentTotal: 45000, assignedWaiter: 'Yao F.', seatedAt: new Date(Date.now() - 55 * 60 * 1000), covers: 3 }
];

export const INITIAL_KITCHEN_TICKETS: KitchenTicket[] = [
  {
    id: 'k-101',
    ticketNumber: '#T-104',
    tableNumber: 'Table 07',
    orderType: 'sur_place',
    waiter: 'Yao F.',
    createdAt: new Date(Date.now() - 22 * 60 * 1000), // > 20 min => URGENT / RED
    status: 'in_prep',
    urgent: true,
    items: [
      { id: 'ki-1', name: 'Capitaine Braisé au Feu de Bois', quantity: 2, course: 'plat', notes: 'Cuisson bien grillée, sauce piment douce à part', completed: false },
      { id: 'ki-2', name: 'Alloco Banane Plantain Dorée', quantity: 2, course: 'plat', notes: 'Bien croustillant', completed: true },
      { id: 'ki-3', name: 'Salade Exotique Mangue & Avocat', quantity: 1, course: 'entree', notes: 'Sans sésame', completed: true }
    ]
  },
  {
    id: 'k-102',
    ticketNumber: '#T-107',
    tableNumber: 'Table 02',
    orderType: 'sur_place',
    waiter: 'Moussa D.',
    createdAt: new Date(Date.now() - 12 * 60 * 1000), // > 10 min => AMBER WARNING
    status: 'in_prep',
    items: [
      { id: 'ki-4', name: 'Dibi d’Agneau Traditionnel', quantity: 2, course: 'plat', notes: 'Moutarde forte', completed: false },
      { id: 'ki-5', name: 'Garba Prestige Thon Rouge', quantity: 1, course: 'plat', notes: 'Piment rouge très chaud', completed: false },
      { id: 'ki-6', name: 'Attiéké Traditionnel', quantity: 2, course: 'plat', completed: true }
    ]
  },
  {
    id: 'k-103',
    ticketNumber: '#T-110',
    tableNumber: 'Table 06',
    orderType: 'sur_place',
    waiter: 'Moussa D.',
    createdAt: new Date(Date.now() - 4 * 60 * 1000), // < 10 min => NEUTRAL
    status: 'in_prep',
    items: [
      { id: 'ki-7', name: 'Gambas Royales Flambées au Pastis', quantity: 2, course: 'plat', notes: 'Flambage soigné', completed: false },
      { id: 'ki-8', name: 'Poulet Bicyclette Braisé Entier', quantity: 1, course: 'plat', completed: false },
      { id: 'ki-9', name: 'Frites Maison Croustillantes', quantity: 2, course: 'plat', completed: false }
    ]
  },
  {
    id: 'k-104',
    ticketNumber: '#T-102',
    tableNumber: 'À Emporter #44',
    orderType: 'emporter',
    waiter: 'Caisse 1',
    createdAt: new Date(Date.now() - 7 * 60 * 1000),
    status: 'ready',
    items: [
      { id: 'ki-10', name: 'Pastels Dorés au Thon (6 pcs)', quantity: 3, course: 'entree', completed: true },
      { id: 'ki-11', name: 'Cocktail Hibiscus Bissap & Menthe', quantity: 3, course: 'boisson', completed: true }
    ]
  }
];

export const INITIAL_DRAWER_STATE: CashDrawerState = {
  openingBalance: 150000, // 150 000 FCFA fond de caisse
  currentCash: 620000,
  totalSales: 1845000,
  cashSales: 470000,
  mobileMoneySales: 925000, // Wave + Orange Money
  cardSales: 450000,
  discountsTotal: 35000,
  transactionCount: 42
};
