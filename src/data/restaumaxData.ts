import { RestaurantInfo, RestauMenuItem } from '../types/restaumax';

export const CHEZ_AWA_RESTAURANT: RestaurantInfo = {
  slug: 'chez-awa',
  name: 'Chez Awa — Grillades & Saveurs d’Afrique',
  tagline: 'Spécialités braisées au feu de bois, poissons frais et mets authentiques',
  address: 'Boulevard de Marseille, Zone 4C',
  city: 'Abidjan, Côte d’Ivoire',
  phone: '+225 07 88 99 00 11',
  currency: 'FCFA',
  bannerUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
  logoUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
  isOpen: true,
  openingHours: '11h30 – 23h30 (7j/7)'
};

export const CHEZ_AWA_MENU_ITEMS: RestauMenuItem[] = [
  // 1. CAPITAINE BRAISÉ
  {
    id: 'dish-capitaine',
    restaurantSlug: 'chez-awa',
    name: 'Capitaine Braisé au Feu de Bois',
    category: 'grillades',
    price: 14500,
    description: 'Poisson capitaine entier frais de la lagune, mariné aux épices traditionnelles kankankan et braisé à point. Servi avec oignons braisés.',
    imageUrl: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 20,
    tags: ['Recommandé', 'Signature'],
    optionGroups: [
      {
        id: 'acc-capitaine',
        name: 'Choix de l’accompagnement (1 inclus)',
        required: true,
        options: [
          { id: 'opt-attieke', name: 'Attiéké traditionnel de Grand-Lahou', extraPrice: 0, isDefault: true },
          { id: 'opt-riz-blanc', name: 'Riz parfumé au jasmin', extraPrice: 0 },
          { id: 'opt-alloco', name: 'Alloco banane plantain dorée', extraPrice: 500 },
          { id: 'opt-frites', name: 'Frites maison croustillantes', extraPrice: 500 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-sauce-piment', name: 'Sauce piment kankan maison', price: 300 },
      { id: 'ext-oignons-plus', name: 'Portion double d’oignons braisés', price: 400 },
      { id: 'ext-piment-vert', name: 'Piment vert frais écrasé', price: 200 },
      { id: 'ext-alloco-supp', name: 'Barquette alloco supplémentaire', price: 2000 }
    ]
  },

  // 2. POULET BICYCLETTE BRAISÉ
  {
    id: 'dish-poulet-bicyclette',
    restaurantSlug: 'chez-awa',
    name: 'Poulet Bicyclette Braisé Entier',
    category: 'grillades',
    price: 9500,
    description: 'Poulet fermier africain tendre et musclé, mariné 12 heures au gingembre, ail sauvage et citronnelle.',
    imageUrl: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 15,
    tags: ['Fermier', 'Best Seller'],
    optionGroups: [
      {
        id: 'acc-poulet',
        name: 'Choix de l’accompagnement (1 inclus)',
        required: true,
        options: [
          { id: 'opt-p-alloco', name: 'Alloco banane plantain dorée', extraPrice: 500, isDefault: false },
          { id: 'opt-p-attieke', name: 'Attiéké traditionnel', extraPrice: 0, isDefault: true },
          { id: 'opt-p-frites', name: 'Frites de pommes de terre fraîches', extraPrice: 500 },
          { id: 'opt-p-riz-gras', name: 'Riz rouge sénégalais aux épices', extraPrice: 700 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-sauce-arachide', name: 'Sauce pâte d’arachide onctueuse', price: 500 },
      { id: 'ext-sauce-verte', name: 'Sauce verte persillade & piment doux', price: 300 },
      { id: 'ext-oignons', name: 'Supplément oignons frits', price: 400 }
    ]
  },

  // 3. DIBI D'AGNEAU TRADITIONNEL
  {
    id: 'dish-dibi-agneau',
    restaurantSlug: 'chez-awa',
    name: 'Dibi d’Agneau Traditionnel',
    category: 'grillades',
    price: 12000,
    description: 'Tranches fondantes d’agneau grillées à l’étouffée au feu de bois, assaisonnées au sel gris et moutarde douce.',
    imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 18,
    tags: ['Gourmand'],
    optionGroups: [
      {
        id: 'acc-dibi',
        name: 'Choix de l’accompagnement',
        required: true,
        options: [
          { id: 'opt-d-alloco', name: 'Alloco banane plantain dorée', extraPrice: 500 },
          { id: 'opt-d-pain', name: 'Pain baguette artisanale tiède', extraPrice: 0, isDefault: true },
          { id: 'opt-d-attieke', name: 'Attiéké de Grand-Lahou', extraPrice: 0 },
          { id: 'opt-d-frites', name: 'Frites dorées', extraPrice: 500 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-moutarde-forte', name: 'Dose moutarde forte de Dijon', price: 200 },
      { id: 'ext-piment-dibi', name: 'Piment kankankan sec en poudre', price: 200 },
      { id: 'ext-oignons-dibi', name: 'Émincé d’oignons frais en salade', price: 300 }
    ]
  },

  // 4. GARBA PRESTIGE THON ROUGE
  {
    id: 'dish-garba-prestige',
    restaurantSlug: 'chez-awa',
    name: 'Garba Prestige Thon Rouge',
    category: 'plats',
    price: 8500,
    description: 'Attiéké fin haut de gamme avec beau pavé de thon rouge frit croustillant, tomates fraîches coupées en dés et piment pilé.',
    imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 10,
    tags: ['Incontournable'],
    optionGroups: [
      {
        id: 'niveau-piment',
        name: 'Niveau de piment souhaité',
        required: true,
        options: [
          { id: 'piment-doux', name: 'Piment doux (très léger)', extraPrice: 0, isDefault: true },
          { id: 'piment-moyen', name: 'Piment moyen (relevé traditionnel)', extraPrice: 0 },
          { id: 'piment-fort', name: 'Piment très fort (amateurs avertis)', extraPrice: 0 },
          { id: 'piment-a-part', name: 'Piment servi à part dans une coupelle', extraPrice: 0 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-pave-supp', name: 'Second pavé de thon rouge frit', price: 3500 },
      { id: 'ext-alloco-garba', name: 'Alloco plantain en accompagnement', price: 500 },
      { id: 'ext-cube-maggi', name: 'Assaisonnement aromatique supplémentaire', price: 100 }
    ]
  },

  // 5. PASTELS DORÉS AU THON (6 PCS)
  {
    id: 'dish-pastels',
    restaurantSlug: 'chez-awa',
    name: 'Pastels Dorés au Thon (6 pièces)',
    category: 'entrees',
    price: 3500,
    description: 'Petits beignets croustillants fourrés à la farce de thon assaisonnée, servis bien chauds avec sauce tomate pimentée.',
    imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 8,
    tags: ['À partager'],
    availableExtras: [
      { id: 'ext-sauce-pastel', name: 'Pot de sauce tomate relevée supplémentaire', price: 300 },
      { id: 'ext-3-pastels', name: 'Supplément 3 pastels (+3 pcs)', price: 1500 }
    ]
  },

  // 6. SALADE EXOTIQUE MANGUE & AVOCAT
  {
    id: 'dish-salade',
    restaurantSlug: 'chez-awa',
    name: 'Salade Exotique Mangue & Avocat',
    category: 'entrees',
    price: 4500,
    description: 'Pousses croquantes, dés de mangue greffée fraîche, avocat local crémeux, vinaigrette au fruit de la passion et sésame grillé.',
    imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 6,
    tags: ['Fraîcheur'],
    availableExtras: [
      { id: 'ext-avocat-supp', name: 'Demi-avocat supplémentaire', price: 1000 },
      { id: 'ext-crevettes', name: 'Poignée de crevettes sautées à l’ail', price: 2500 }
    ]
  },

  // 7. ALLOCO CROUSTILLANT (PORTION SEULE)
  {
    id: 'dish-alloco-solo',
    restaurantSlug: 'chez-awa',
    name: 'Portion Généreuse d’Alloco Plantain',
    category: 'accompagnements',
    price: 2500,
    description: 'Bananes plantains mûres sélectionnées à point, frites minute dans de l’huile végétale pure. Fondantes au cœur et caramélisées.',
    imageUrl: 'https://images.unsplash.com/photo-1628294895950-9805252327bc?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 5,
    tags: ['Favori'],
    availableExtras: [
      { id: 'ext-sauce-tomate-oignon', name: 'Sauce tomate aux oignons caramélisés', price: 500 },
      { id: 'ext-piment-alloco', name: 'Piment rouge doux écrasé', price: 200 }
    ]
  },

  // 8. COCKTAIL BISSAP MENTHE FRAÎCHE
  {
    id: 'dish-bissap',
    restaurantSlug: 'chez-awa',
    name: 'Cocktail Hibiscus Bissap & Menthe (50cl)',
    category: 'boissons',
    price: 2500,
    description: 'Infusion artisanale de fleurs d’hibiscus rouge de première qualité, menthe fraîche froissée et eau de fleur d’oranger.',
    imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 3,
    tags: ['Maison'],
    optionGroups: [
      {
        id: 'opt-glacons',
        name: 'Service de fraîcheur',
        required: true,
        options: [
          { id: 'glace-frappee', name: 'Avec glaçons bien frappé', extraPrice: 0, isDefault: true },
          { id: 'sans-glace', name: 'Tempéré / Sans glaçons', extraPrice: 0 }
        ]
      }
    ]
  },

  // 9. JUS DE GINGEMBRE & ANANAS PRESSÉ
  {
    id: 'dish-gingembre',
    restaurantSlug: 'chez-awa',
    name: 'Jus de Gingembre Pressé & Ananas (50cl)',
    category: 'boissons',
    price: 2500,
    description: 'Jus de gingembre naturel corsé et rafraîchissant adouci avec la pulpe d’ananas pain de sucre de Bonoua.',
    imageUrl: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 3,
    tags: ['Énergisant']
  },

  // 10. MOELLEUX AU CHOCOLAT IVOIRIEN
  {
    id: 'dish-dessert-chocolat',
    restaurantSlug: 'chez-awa',
    name: 'Fondant Pur Cacao Ivoirien & Piment Doux',
    category: 'desserts',
    price: 4500,
    description: 'Chocolat noir 70% pure plantation de Tiassalé, cœur coulant avec pointe de piment doux d’Espelette et boule de glace vanille.',
    imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 8,
    tags: ['Fait Maison']
  }
];
