/**
 * Menu de démonstration transcrit de la carte « RESTO Sweet and Hot ».
 * Les formats sont modélisés comme options tarifées pour rester compatibles
 * avec le calcul du panier RestauMax. Tous les montants sont en FCFA.
 */
const sizes = (entries) => entries.map(([name, price], index) => ({
  id: `format-${index + 1}`,
  name,
  extraPrice: price - entries[0][1],
  isDefault: index === 0
}));

const item = (id, name, category, prices, description = '') => ({
  id: `sweet-hot-${id}`,
  restaurantSlug: 'chez-awa',
  name,
  category,
  price: prices[0][1],
  description: description || `${name}, spécialité de la carte RESTO Sweet and Hot.`,
  imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80',
  available: true,
  prepTimeMinutes: 20,
  tags: ['Menu test', 'Sweet and Hot'],
  ...(prices.length > 1 ? {
    optionGroups: [{
      id: `formats-${id}`,
      name: 'Choisir le format',
      required: true,
      options: sizes(prices)
    }]
  } : {})
});

export const SWEET_AND_HOT_TEST_MENU_ITEMS = [
  // En soupe / Kédjénou
  item('marmite-pecheur', 'La Marmite du Pêcheur', 'plats', [['2 à 3 personnes', 8000], ['4 à 6 personnes', 15000]]),
  item('kedjenou-pintade', 'Kédjénou de pintade', 'plats', [['Petit format', 6500], ['Grand format', 12000]]),
  item('kedjenou-lapin', 'Kédjénou de lapin', 'plats', [['Portion', 12000]]),
  item('kedjenou-poulet-africain', 'Kédjénou de poulet africain / pondeuse', 'plats', [['Petit format', 4500], ['Grand format', 8000]]),
  item('kedjenou-poulet-chair', 'Kédjénou de poulet de chair', 'plats', [['Petit format', 3500], ['Grand format', 6000]]),
  item('kedjenou-caille', 'Kédjénou de caille', 'plats', [['Portion', 6000]]),
  item('kedjenou-carpe', 'Kédjénou de carpe', 'plats', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('kedjenou-okoyo', 'Kédjénou d’Okoyo (poisson zèbre)', 'plats', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('kedjenou-saint-pierre', 'Kédjénou de Saint-Pierre', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-arrale', 'Kédjénou d’Arrale', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-machoiron', 'Kédjénou de mâchoiron', 'plats', [['Petit format', 7000], ['Grand format', 10000]]),
  item('kedjenou-merou', 'Kédjénou de mérou', 'plats', [['Petit format', 15000], ['Moyen format', 20000], ['Grand format', 25000]]),

  // À la braise
  item('poulet-qg', 'Poulet QG (miel & épices)', 'grillades', [['Demi-poulet', 2500], ['Poulet entier', 5000]]),
  item('caille-braisee', 'Caille braisée', 'grillades', [['Pièce', 2500]]),
  item('pintade-braisee', 'Pintade braisée', 'grillades', [['Demi-pintade', 6000], ['Pintade entière', 10000]]),
  item('cotelettes-echine-porc', 'Côtelettes / échine de porc', 'grillades', [['Portion', 6000]]),
  item('lapin-braise', 'Lapin braisé', 'grillades', [['Portion', 12000]]),
  item('carpe-braisee', 'Carpe braisée', 'grillades', [['Petit format', 5000], ['Moyen format', 8000], ['Grand format', 10000]]),
  item('machoiron-braise', 'Mâchoiron braisé', 'grillades', [['Petit format', 8000], ['Moyen format', 10000], ['Grand format', 15000]]),
  item('sole-braisee', 'Sole braisée', 'grillades', [['Petit format', 7000], ['Moyen format', 10000], ['Grand format', 15000]]),
  item('merou-braise', 'Mérou braisé', 'grillades', [['Petit format', 15000], ['Moyen format', 20000], ['Grand format', 25000]]),

  // En brochettes
  item('brochette-gambas', 'Brochette de gambas', 'grillades', [['Brochette', 5000]]),
  item('brochette-merou', 'Brochette de mérou', 'grillades', [['Brochette', 2500]]),
  item('brochette-filet-boeuf', 'Brochette de filet de bœuf', 'grillades', [['Brochette', 1500]]),
  item('brochette-escargots', 'Brochette d’escargots', 'grillades', [['Brochette', 1500]]),
  item('brochette-gesiers', 'Brochette de gésiers', 'grillades', [['Brochette', 1500]]),
  item('brochette-ecrevisses', 'Brochette d’écrevisses', 'grillades', [['Brochette', 1500]]),
  item('brochette-langue-boeuf', 'Brochette de langue de bœuf', 'grillades', [['Brochette', 1500]]),

  // Accompagnements
  item('accompagnement', 'Frites, alloco, attiéké, igname ou riz', 'accompagnements', [['Portion', 500]])
];
