/**
 * RESTAUMAX — Script d'initialisation contrôlée du catalogue (Admin SDK)
 *
 * Utilisation :
 * 1. Télécharger une clé de compte de service depuis la console Firebase :
 *    Paramètres du projet > Comptes de service > Générer une nouvelle clé privée.
 * 2. Exécuter ce script hors de la portée client :
 *    GOOGLE_APPLICATION_CREDENTIALS=~/serviceAccountKey.json node scripts/seed-catalog.mjs
 *    (Ajouter le drapeau --force pour écraser des données existantes si nécessaire)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

const CHEZ_AWA_RESTAURANT = {
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

const CHEZ_AWA_MENU_ITEMS = [
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
  {
    id: 'dish-poulet-bicyclette',
    restaurantSlug: 'chez-awa',
    name: 'Poulet Bicyclette Braisé Entier',
    category: 'grillades',
    price: 9500,
    description: 'Poulet fermier africain tendre et musclé, mariné 12 heures au gingembre, ail sauvage et citronnelle.',
    imageUrl: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 25,
    tags: ['Signature', 'Populaire'],
    optionGroups: [
      {
        id: 'acc-poulet',
        name: 'Accompagnement principal',
        required: true,
        options: [
          { id: 'opt-attieke-p', name: 'Attiéké fin garantissant fraîcheur', extraPrice: 0, isDefault: true },
          { id: 'opt-alloco-p', name: 'Alloco plantain bien mûr', extraPrice: 500 },
          { id: 'opt-frites-p', name: 'Frites croustillantes', extraPrice: 500 }
        ]
      }
    ],
    availableExtras: [
      { id: 'ext-piment-p', name: 'Sauce verte aux aromates', price: 300 },
      { id: 'ext-jus-oignon', name: 'Jus de marinade réduit', price: 500 }
    ]
  },
  {
    id: 'dish-sauce-graine',
    restaurantSlug: 'chez-awa',
    name: 'Sauce Graine Traditionnelle au Boeuf & Foutou',
    category: 'plats',
    price: 11000,
    description: 'Sauce onctueuse issue du jus de noix de palme fraîches, mijotée avec morceaux choisis de bœuf braisé et tripes tendres. Servie avec foutou banane pilé.',
    imageUrl: 'https://images.unsplash.com/photo-1547496502-affa22d38842?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 15,
    tags: ['Traditionnel'],
    optionGroups: [
      {
        id: 'opt-foutou',
        name: 'Type de féculent pilé',
        required: true,
        options: [
          { id: 'foutou-banane', name: 'Foutou Banane traditionnel ivoirien', extraPrice: 0, isDefault: true },
          { id: 'foutou-igname', name: 'Foutou Igname doux', extraPrice: 0 },
          { id: 'riz-sauce', name: 'Riz blanc cassé 1 fois', extraPrice: 0 }
        ]
      }
    ]
  },
  {
    id: 'dish-alloco-simple',
    restaurantSlug: 'chez-awa',
    name: 'Grande Barquette d’Alloco Doré',
    category: 'entrees',
    price: 3000,
    description: 'Bananes plantains mûres frites à point dans l’huile végétale pure. Croustillantes à l’extérieur et fondantes à cœur. Servies avec sauce tomate-oignon pimentée.',
    imageUrl: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 10,
    tags: ['Incontournable', 'Végétarien'],
    availableExtras: [
      { id: 'ext-oeuf-dur', name: '2 Œufs durs assaisonnés', price: 600 },
      { id: 'ext-poisson-frit', name: 'Petit poisson frit en accompagnement', price: 1500 }
    ]
  },
  {
    id: 'dish-bissap-gingembre',
    restaurantSlug: 'chez-awa',
    name: 'Jus de Bissap Royal & Menthe Fraîche (50cl)',
    category: 'boissons',
    price: 1500,
    description: 'Infusion artisanale de fleurs d’hibiscus sabdariffa du Sahel, menthe poivrée fraîche et un soupçon de fleur d’oranger. Très frais et désaltérant.',
    imageUrl: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80',
    available: true,
    prepTimeMinutes: 3,
    tags: ['Fait Maison', 'Boisson Locale']
  }
];

async function main() {
  const isForce = process.argv.includes('--force');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credPath) {
    console.error('Erreur : variable GOOGLE_APPLICATION_CREDENTIALS manquante.');
    console.error('Exemple : GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/cle.json node scripts/seed-catalog.mjs');
    process.exit(1);
  }

  if (!fs.existsSync(credPath)) {
    console.error('Erreur : fichier de clé de compte de service introuvable.');
    process.exit(1);
  }

  if (!getApps().length) {
    const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  }

  const db = getFirestore();
  const restRef = db.collection('restaurants').doc(CHEZ_AWA_RESTAURANT.slug);
  const snap = await restRef.get();

  if (snap.exists && !isForce) {
    console.log(`Le restaurant "${CHEZ_AWA_RESTAURANT.slug}" existe déjà dans Firestore.`);
    console.log('Pour forcer la réinitialisation, ajoutez l\'option --force.');
    process.exit(0);
  }

  console.log(`Initialisation contrôlée du catalogue pour "${CHEZ_AWA_RESTAURANT.name}"...`);

  const batch = db.batch();
  batch.set(restRef, CHEZ_AWA_RESTAURANT, { merge: true });

  for (const item of CHEZ_AWA_MENU_ITEMS) {
    const itemRef = restRef.collection('menuItems').doc(item.id);
    batch.set(itemRef, item, { merge: true });
  }

  await batch.commit();
  console.log(`✓ Données initialisées avec succès dans Firestore (${CHEZ_AWA_MENU_ITEMS.length} plats enregistrés).`);
}

main().catch((err) => {
  console.error('Échec de l\'initialisation :', err.message || 'Erreur interne.');
  process.exit(1);
});
