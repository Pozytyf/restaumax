import React, { useState, useMemo } from 'react';
import { MenuItem, Category, CartItem, Table } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { CartLedger } from './CartLedger';
import { 
  Search, 
  Flame, 
  UtensilsCrossed, 
  Salad, 
  Cookie, 
  Wine, 
  PlusCircle, 
  Check, 
  Plus,
  Sparkles,
  Layers
} from 'lucide-react';

interface PosViewProps {
  menuItems: MenuItem[];
  cart: CartItem[];
  selectedTable: Table | null;
  tables: Table[];
  onSelectTable: (table: Table) => void;
  onAddToCart: (item: MenuItem) => void;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItemNotes: (itemId: string, notes: string) => void;
  onClearCart: () => void;
  discountPercent: number;
  onSetDiscountPercent: (discount: number) => void;
  onSendToKitchen: () => void;
  onOpenPayment: () => void;
  serverName: string;
}

const CATEGORIES: { id: Category; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'tous', label: 'Tout le Menu', icon: Layers },
  { id: 'grillades', label: 'Grillades au Feu', icon: Flame },
  { id: 'plats', label: 'Plats Signatures', icon: UtensilsCrossed },
  { id: 'entrees', label: 'Entrées & Tapas', icon: Salad },
  { id: 'accompagnements', label: 'Accompagnements', icon: PlusCircle },
  { id: 'boissons', label: 'Boissons & Cocktails', icon: Wine },
  { id: 'desserts', label: 'Desserts Fins', icon: Cookie }
];

export const PosView: React.FC<PosViewProps> = ({
  menuItems,
  cart,
  selectedTable,
  tables,
  onSelectTable,
  onAddToCart,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateItemNotes,
  onClearCart,
  discountPercent,
  onSetDiscountPercent,
  onSendToKitchen,
  onOpenPayment,
  serverName
}) => {
  const [selectedCategory, setSelectedCategory] = useState<Category>('tous');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');

  // Cart item count map for badge display on item cards
  const cartCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      map.set(item.menuItem.id, (map.get(item.menuItem.id) || 0) + item.quantity);
    }
    return map;
  }, [cart]);

  // Filtered menu
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesCategory = selectedCategory === 'tous' || item.category === selectedCategory;
      const matchesQuery = !searchQuery || 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.tags && item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())));
      return matchesCategory && matchesQuery;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseInt(customPrice.replace(/\D/g, ''), 10);
    if (!customName.trim() || isNaN(priceNum) || priceNum <= 0) return;

    const newItem: MenuItem = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      category: 'plats',
      price: priceNum,
      description: 'Article spécial sur mesure',
      imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
      available: true,
      prepTimeMinutes: 10,
      course: 'plat'
    };

    onAddToCart(newItem);
    setCustomName('');
    setCustomPrice('');
    setShowCustomItemModal(false);
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-60px)] overflow-hidden bg-[#f4f7fb]">
      {/* Left / Center Catalog Zone */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Sub Header / Search & Category Bar */}
        <div className="bg-white border-b border-slate-200/80 px-4 py-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Rechercher un plat, ingrédient, boisson..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs sm:text-sm pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Action Button for Custom Item */}
            <button
              onClick={() => setShowCustomItemModal(true)}
              className="text-xs font-bold px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-auto shrink-0"
            >
              <Plus size={14} />
              Article Libre
            </button>
          </div>

          {/* Category Horizontal Filter Bar */}
          <div className="flex items-center gap-2 overflow-x-auto pt-3 pb-1 scrollbar-none">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    sounds.playTap();
                    setSelectedCategory(cat.id);
                  }}
                  className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                    isSelected
                      ? 'bg-[#101d2d] text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={14} className={isSelected ? 'text-[#ff6500]' : 'text-slate-500'} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-5">
          {filteredItems.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center">
              <p className="text-sm font-bold text-slate-700 mb-1">Aucun plat trouvé</p>
              <p className="text-xs text-slate-500 mb-3">
                Aucun résultat pour "{searchQuery}". Essayez une autre recherche.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('tous');
                }}
                className="px-3 py-1.5 text-xs font-bold bg-[#101d2d] text-white rounded-md"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {filteredItems.map((dish) => {
                const inCartQty = cartCounts.get(dish.id) || 0;
                return (
                  <div
                    key={dish.id}
                    onClick={() => {
                      sounds.playTap();
                      onAddToCart(dish);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onAddToCart(dish);
                      }
                    }}
                    className={`group cursor-pointer select-none relative bg-white border rounded-xl overflow-hidden shadow-2xs hover:shadow-md transition-all flex flex-col text-left active:scale-[0.98] ${
                      inCartQty > 0
                        ? 'border-[#ff6500] ring-1 ring-[#ff6500]/50'
                        : 'border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    {/* Dish Image */}
                    <div className="relative h-28 sm:h-32 bg-slate-100 overflow-hidden">
                      <img
                        src={dish.imageUrl}
                        alt={dish.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

                      {/* Prep time chip */}
                      <span className="absolute bottom-2 left-2 text-[10px] font-bold text-white/90 bg-black/50 backdrop-blur-2xs px-1.5 py-0.5 rounded tnum">
                        {dish.prepTimeMinutes} min
                      </span>

                      {/* Cart Quantity Badge (Top Right) */}
                      {inCartQty > 0 && (
                        <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#ff6500] text-white flex items-center justify-center font-extrabold text-xs shadow-md animate-in zoom-in-50 tnum">
                          {inCartQty}
                        </div>
                      )}

                      {/* Special tags */}
                      {dish.tags && dish.tags[0] && (
                        <span className="absolute top-2 left-2 text-[10px] font-extrabold text-amber-900 bg-amber-300/90 px-1.5 py-0.5 rounded shadow-2xs">
                          {dish.tags[0]}
                        </span>
                      )}
                    </div>

                    {/* Dish Info */}
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-1 leading-snug group-hover:text-[#ff6500] transition-colors">
                          {dish.name}
                        </h3>
                        <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                          {dish.description}
                        </p>
                      </div>

                      <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs sm:text-sm font-extrabold text-[#ff6500] tnum tracking-tight">
                          {formatFCFA(dish.price)}
                        </span>
                        
                        <div className="w-6 h-6 rounded-md bg-slate-100 group-hover:bg-[#ff6500] group-hover:text-white text-slate-600 flex items-center justify-center transition-colors">
                          <Plus size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Fixed Anchor Panel (360px - 420px on Desktop) */}
      <div className="w-full lg:w-96 xl:w-[410px] shrink-0 h-auto lg:h-full border-t lg:border-t-0">
        <CartLedger
          cart={cart}
          selectedTable={selectedTable}
          tables={tables}
          onSelectTable={onSelectTable}
          onUpdateQuantity={onUpdateQuantity}
          onRemoveItem={onRemoveItem}
          onUpdateItemNotes={onUpdateItemNotes}
          onClearCart={onClearCart}
          discountPercent={discountPercent}
          onSetDiscountPercent={onSetDiscountPercent}
          onSendToKitchen={onSendToKitchen}
          onOpenPayment={onOpenPayment}
          serverName={serverName}
        />
      </div>

      {/* Custom Item Modal */}
      {showCustomItemModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddCustomItem}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 p-5 w-full max-w-sm"
          >
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                Ajouter un article sur mesure
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomItemModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nom du plat / article
                </label>
                <input
                  type="text"
                  placeholder="Ex: Supplément Homard, Bouteille Champagne..."
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#ff6500] focus:outline-none"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Prix en FCFA
                </label>
                <input
                  type="number"
                  placeholder="Ex: 5000"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#ff6500] focus:outline-none tnum"
                  required
                  min="100"
                  step="100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCustomItemModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold bg-[#ff6500] text-white hover:bg-[#e05800] rounded-md shadow-sm"
              >
                Ajouter au panier
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
