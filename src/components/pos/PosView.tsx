import React, { useState, useMemo, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { MenuItem, Category, CartItem, Table } from '../../types/pos';
import { RestauOrder } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { CartLedger } from './CartLedger';
import { ProductDetailModal } from '../restaumax/ProductDetailModal';
import type { ClientCartItem, RestauMenuItem } from '../../types/restaumax';
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
  onAddToCart: (item: ClientCartItem) => boolean | void;
  restaurantSlug: string;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItemNotes: (itemId: string, notes: string) => void;
  onClearCart: () => void;
  discountPercent: number;
  onSetDiscountPercent: (discount: number) => void;
  onSendToKitchen: (customerId?: string) => void;
  isSendingOrder: boolean;
  onOpenPayment: () => void;
  serverName: string;
  unpaidOrders: RestauOrder[];
  onCollectOrder: (order: RestauOrder) => void;
  alreadyPaidAmount?: number;
  isExistingOrder?: boolean;
  taxRatePercent?: number;
  taxMode?: 'exclusive' | 'inclusive';
  canSelectCustomer?: boolean;
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
  restaurantSlug,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateItemNotes,
  onClearCart,
  discountPercent,
  onSetDiscountPercent,
  onSendToKitchen,
  isSendingOrder,
  onOpenPayment,
  serverName,
  unpaidOrders,
  onCollectOrder,
  alreadyPaidAmount = 0,
  isExistingOrder = false,
  taxRatePercent = 0,
  taxMode = 'exclusive',
  canSelectCustomer = false
}) => {
  const [selectedCategory, setSelectedCategory] = useState<Category>('tous');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  useEffect(() => {
    if (!canSelectCustomer) {
      setCustomers([]);
      setSelectedCustomerId('');
      return;
    }
    return onSnapshot(collection(db, 'restaurants', restaurantSlug, 'customers'), snapshot => {
      setCustomers(snapshot.docs.map(entry => ({
        id: entry.id,
        name: String(entry.data().name || ''),
        phone: String(entry.data().phone || '')
      })).filter(customer => customer.name && customer.phone)
        .sort((a, b) => a.name.localeCompare(b.name)));
    }, error => {
      console.warn('[RestauMax POS] Customer list unavailable:', error.message);
      setCustomers([]);
    });
  }, [restaurantSlug, canSelectCustomer]);
 
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
      const matchesAvailability = item.available === true;
      const matchesCategory = selectedCategory === 'tous' || item.category === selectedCategory;
      const matchesQuery = !searchQuery || 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.tags && item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())));
      return matchesAvailability && matchesCategory && matchesQuery;
    });
  }, [menuItems, selectedCategory, searchQuery]);

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
              type="button"
              disabled
              title="Disponible après mise en place d'une création sécurisée côté serveur."
              aria-label="Article libre indisponible : utilisez un article du catalogue"
              className="text-xs font-bold px-3 py-2 bg-slate-100 text-slate-500 rounded-lg flex items-center gap-1.5 self-start sm:self-auto shrink-0 cursor-not-allowed opacity-70"
            >
              <Plus size={14} />
              Article Libre (indisponible)
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

        {unpaidOrders.length > 0 && (
          <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-amber-900">Commandes à solder</span>
              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">{unpaidOrders.length}</span>
              <span className="text-[10px] text-amber-800">Reprenez un encaissement en attente</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {unpaidOrders.map((order) => {
                const remaining = Math.max(0, Number(order.remainingAmount ?? (order.totalAmount - Number(order.paidAmount || 0))));
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => onCollectOrder(order)}
                    className="shrink-0 min-w-[170px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-left hover:border-amber-400 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-black text-slate-900">{order.orderNumber}</span>
                      <span className="text-[9px] font-bold uppercase text-amber-800">{order.paymentStatus === 'partial' ? 'Partiel' : 'À régler'}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{order.tableNumber ? `Table ${order.tableNumber}` : 'À emporter'}</div>
                    <div className="text-xs font-black text-[#ff6500] tnum mt-1">{formatFCFA(remaining)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
                      setSelectedProduct(dish);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedProduct(dish);
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
          isSendingOrder={isSendingOrder}
          onOpenPayment={onOpenPayment}
          serverName={serverName}
          alreadyPaidAmount={alreadyPaidAmount}
          isExistingOrder={isExistingOrder}
          taxRatePercent={taxRatePercent}
          taxMode={taxMode}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          onSelectCustomer={setSelectedCustomerId}
        />
      </div>

      {selectedProduct && (
        <ProductDetailModal
          item={{ ...selectedProduct, restaurantSlug } as RestauMenuItem}
          isAvailable={selectedProduct.available === true}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={onAddToCart}
        />
      )}


    </div>
  );
};
