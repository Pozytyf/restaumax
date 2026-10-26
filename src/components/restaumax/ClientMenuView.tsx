import React, { useState, useMemo } from 'react';
import { RestauMenuItem, ClientCartItem, RestaurantInfo, SelectedOption, SelectedExtra } from '../../types/restaumax';
import { ProductDetailModal } from './ProductDetailModal';
import { CartDrawer } from './CartDrawer';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  Search, 
  MapPin, 
  ShoppingBag, 
  Flame, 
  UtensilsCrossed, 
  Salad, 
  Cookie, 
  Wine, 
  PlusCircle, 
  Clock, 
  ChevronRight, 
  Info,
  Phone,
  ArrowLeft
} from 'lucide-react';

interface ClientMenuViewProps {
  restaurant: RestaurantInfo;
  menuItems: RestauMenuItem[];
  tableNumber: string | null;
  onNavigateHome: () => void;
  onSelectTableDemo: (table: string | null) => void;
}

type CategoryFilter = 'tous' | 'grillades' | 'plats' | 'entrees' | 'accompagnements' | 'boissons' | 'desserts';

const CATEGORIES: { id: CategoryFilter; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'tous', label: 'Toute la carte', icon: UtensilsCrossed },
  { id: 'grillades', label: 'Grillades au feu', icon: Flame },
  { id: 'plats', label: 'Plats traditionnels', icon: UtensilsCrossed },
  { id: 'entrees', label: 'Entrées & Tapas', icon: Salad },
  { id: 'accompagnements', label: 'Accompagnements', icon: PlusCircle },
  { id: 'boissons', label: 'Boissons & Cocktails', icon: Wine },
  { id: 'desserts', label: 'Desserts', icon: Cookie }
];

// Normalise la signature d'une option composite ou simple de façon déterministe
const getNormalizedOptionSignature = (selectedOption?: SelectedOption): string => {
  if (!selectedOption) return '';
  const groupParts = selectedOption.groupId ? selectedOption.groupId.split('+') : [];
  const optionParts = selectedOption.optionId ? selectedOption.optionId.split('+') : [];

  if (groupParts.length > 0 && groupParts.length === optionParts.length) {
    const pairs = groupParts.map((gid, idx) => ({
      groupId: gid.trim(),
      optionId: (optionParts[idx] || '').trim()
    }));
    pairs.sort((a, b) => a.groupId.localeCompare(b.groupId) || a.optionId.localeCompare(b.optionId));
    return pairs.map(p => `grp:${p.groupId}=opt:${p.optionId}`).join('|');
  }

  return `grp:${selectedOption.groupId || ''}=opt:${selectedOption.optionId || ''}`;
};

// Normalise la signature des extras sélectionnés pour être indépendant de l'ordre
const getNormalizedExtrasSignature = (extras?: SelectedExtra[]): string => {
  if (!extras || extras.length === 0) return '';
  const sorted = [...extras].sort((a, b) => a.extraId.localeCompare(b.extraId));
  return sorted.map(e => `extra:${e.extraId}`).join('|');
};

// Vérifie si deux articles de panier partagent la même configuration produit
const areCartConfigurationsEqual = (itemA: ClientCartItem, itemB: ClientCartItem): boolean => {
  if (itemA.menuItemId !== itemB.menuItemId) return false;

  const optA = getNormalizedOptionSignature(itemA.selectedOption);
  const optB = getNormalizedOptionSignature(itemB.selectedOption);
  if (optA !== optB) return false;

  const extA = getNormalizedExtrasSignature(itemA.selectedExtras);
  const extB = getNormalizedExtrasSignature(itemB.selectedExtras);
  if (extA !== extB) return false;

  const noteA = (itemA.prepNotes || '').trim();
  const noteB = (itemB.prepNotes || '').trim();
  if (noteA !== noteB) return false;

  return true;
};

export const ClientMenuView: React.FC<ClientMenuViewProps> = ({
  restaurant,
  menuItems,
  tableNumber,
  onNavigateHome,
  onSelectTableDemo
}) => {
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('tous');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeItemModal, setActiveItemModal] = useState<RestauMenuItem | null>(null);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [cart, setCart] = useState<ClientCartItem[]>([]);

  // Filtered menu items (only available dishes are displayed and searchable)
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchAvailable = item.available !== false;
      const matchCat = selectedCategory === 'tous' || item.category === selectedCategory;
      const matchQuery = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.tags && item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())));
      return matchAvailable && matchCat && matchQuery;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Cart totals
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // Cart operations (immutable updates)
  const handleAddToCart = (newItem: ClientCartItem) => {
    setCart(prev => {
      // Comparaison robuste : même plat, mêmes options (indépendamment de l'ordre), mêmes extras et même note
      const existingIdx = prev.findIndex(item => areCartConfigurationsEqual(item, newItem));

      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx
            ? { ...item, quantity: item.quantity + newItem.quantity }
            : item
        );
      } else {
        return [...prev, newItem];
      }
    });
  };

  const handleUpdateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev => 
      prev.map(item => {
        if (item.id === cartItemId) {
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) {
            // Prompt or delete
            return null;
          }
          return { ...item, quantity: nextQty };
        }
        return item;
      }).filter(Boolean) as ClientCartItem[]
    );
  };

  const handleRemoveItem = (cartItemId: string) => {
    setCart(prev => prev.filter(item => item.id !== cartItemId));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] pb-28 text-[#181c1f]">
      {/* Top Banner / Restaurant Profile Header */}
      <div className="relative bg-[#101d2d] text-white">
        {/* Banner image with overlay */}
        <div className="h-44 sm:h-52 w-full relative overflow-hidden">
          <img
            src={restaurant.bannerUrl}
            alt={restaurant.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#101d2d] via-[#101d2d]/60 to-black/30" />

          {/* Navigation link back to landing */}
          <div className="absolute top-4 left-4 z-10">
            <button
              onClick={onNavigateHome}
              className="px-3 py-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white text-xs font-bold backdrop-blur-sm flex items-center gap-1.5 transition-all active:scale-95"
            >
              <ArrowLeft size={14} />
              <span>Accueil RestauMax</span>
            </button>
          </div>

          {/* Table / Order Mode Switcher quick pills */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            <button
              onClick={() => {
                sounds.playTap();
                onSelectTableDemo('4');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                tableNumber === '4'
                  ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-white/50'
                  : 'bg-black/60 text-white/90 hover:bg-black/80 backdrop-blur-sm'
              }`}
            >
              Table 4
            </button>
            <button
              onClick={() => {
                sounds.playTap();
                onSelectTableDemo(null);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                tableNumber === null
                  ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-white/50'
                  : 'bg-black/60 text-white/90 hover:bg-black/80 backdrop-blur-sm'
              }`}
            >
              À emporter
            </button>
          </div>
        </div>

        {/* Restaurant Header Information */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-5 -mt-12 relative z-10">
          <div className="bg-white text-slate-900 rounded-2xl p-4 sm:p-5 shadow-xl border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-orange-100 text-[#ff6500]">
                  QR Menu Client
                </span>

                {/* Table or Takeout indicator */}
                {tableNumber ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                    <MapPin size={12} className="text-amber-600" />
                    Table {tableNumber} (Sur place)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-900 border border-blue-300">
                    <ShoppingBag size={12} className="text-blue-600" />
                    Commande À emporter
                  </span>
                )}

                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                  restaurant.isOpen
                    ? 'text-emerald-700 bg-emerald-50'
                    : 'text-rose-700 bg-rose-50'
                }`}>
                  {restaurant.isOpen ? 'Ouvert' : 'Fermé'}
                </span>
              </div>

              <h1 className="text-lg sm:text-2xl font-black text-[#101d2d] tracking-tight mt-1.5">
                {restaurant.name}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {restaurant.address} · {restaurant.city} · {restaurant.openingHours}
              </p>
            </div>

            <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
              <a
                href={`tel:${restaurant.phone.replace(/\s+/g, '')}`}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
              >
                <Phone size={14} />
                <span className="hidden sm:inline">{restaurant.phone}</span>
                <span className="sm:hidden">Appeler</span>
              </a>

              <button
                onClick={() => setIsCartOpen(true)}
                className="px-4 py-2 bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-extrabold rounded-xl shadow-md flex items-center gap-2 transition-transform active:scale-95"
              >
                <ShoppingBag size={15} />
                <span>Panier ({totalItemCount})</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-5 space-y-5">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="text"
            placeholder="Rechercher une grillade, un plat, alloco, boisson..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs sm:text-sm pl-10 pr-8 py-3 bg-white border border-slate-200/90 rounded-xl text-slate-900 placeholder:text-slate-400 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  sounds.playTap();
                  setSelectedCategory(cat.id);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                  isSelected
                    ? 'bg-[#101d2d] text-white shadow-sm'
                    : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className={isSelected ? 'text-[#ff6500]' : 'text-slate-400'} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Product Cards List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
              {CATEGORIES.find(c => c.id === selectedCategory)?.label} ({filteredItems.length})
            </h2>
            <span className="text-[11px] text-slate-500 font-medium">
              Prix affichés en FCFA (TVA incluse)
            </span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center">
              <p className="text-sm font-bold text-slate-800">Aucun plat ne correspond à votre recherche</p>
              <p className="text-xs text-slate-500 mt-1">Essayez un autre mot-clé ou réinitialisez les filtres.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('tous');
                }}
                className="mt-3 px-4 py-2 bg-[#101d2d] text-white text-xs font-bold rounded-xl"
              >
                Voir toute la carte
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredItems.map((dish) => (
                <div
                  key={dish.id}
                  onClick={() => {
                    sounds.playTap();
                    setActiveItemModal(dish);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveItemModal(dish);
                    }
                  }}
                  className="group bg-white rounded-2xl border border-slate-200/90 hover:border-slate-300 p-3.5 shadow-2xs hover:shadow-md transition-all cursor-pointer flex gap-3 text-left active:scale-[0.99]"
                >
                  {/* Dish Thumbnail */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                    <img
                      src={dish.imageUrl}
                      alt={dish.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold text-white bg-black/60 backdrop-blur-2xs px-1.5 py-0.5 rounded tnum">
                      {dish.prepTimeMinutes}m
                    </span>
                  </div>

                  {/* Dish Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#ff6500] transition-colors line-clamp-1 leading-snug">
                          {dish.name}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        {dish.description}
                      </p>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-xs sm:text-sm font-black text-[#ff6500] tnum">
                        {formatFCFA(dish.price)}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          sounds.playTap();
                          setActiveItemModal(dish);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-orange-50 group-hover:bg-[#ff6500] text-[#ff6500] group-hover:text-white font-bold text-[11px] transition-colors flex items-center gap-1"
                      >
                        <span>Choisir</span>
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Persistent Floating Bottom Cart Bar (Mobile & Desktop) */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-3 sm:p-4 bg-gradient-to-t from-slate-900/40 via-slate-900/10 to-transparent pointer-events-none">
          <div className="max-w-md mx-auto pointer-events-auto">
            <button
              onClick={() => {
                sounds.playTap();
                setIsCartOpen(true);
              }}
              className="w-full h-14 bg-[#ff6500] hover:bg-[#e05800] text-white rounded-2xl shadow-xl shadow-orange-600/30 flex items-center justify-between px-5 transition-transform active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-black text-xs tnum">
                  {totalItemCount}
                </div>
                <div className="text-left">
                  <div className="text-xs font-black uppercase tracking-wider">
                    Voir le panier
                  </div>
                  <div className="text-[11px] text-white/90">
                    {tableNumber ? `Table ${tableNumber}` : 'À emporter'}
                  </div>
                </div>
              </div>

              <div className="text-base font-black tracking-tight tnum bg-black/20 px-3 py-1 rounded-xl">
                {formatFCFA(cartSubtotal)}
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      <ProductDetailModal
        item={activeItemModal}
        onClose={() => setActiveItemModal(null)}
        onAddToCart={handleAddToCart}
      />

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        tableNumber={tableNumber}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={handleClearCart}
      />
    </div>
  );
};
