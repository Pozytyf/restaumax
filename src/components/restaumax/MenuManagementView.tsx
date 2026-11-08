import React, { useState, useMemo } from 'react';
import { RestaurantInfo, RestauMenuItem } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { DishFormModal } from './DishFormModal';
import { 
  ArrowLeft, 
  BookOpen, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  SlidersHorizontal, 
  PlusCircle, 
  ExternalLink,
  UtensilsCrossed,
  Flame,
  Salad,
  Wine,
  Cookie,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  Info,
  Edit3,
  Plus,
  Trash2,
  Package
} from 'lucide-react';

export interface MenuManagementViewProps {
  restaurant: RestaurantInfo;
  menuItems: RestauMenuItem[];
  catalogLoading?: boolean;
  catalogError?: string | null;
  canManageCatalog?: boolean;
  onToggleAvailability: (dishId: string) => void;
  onCreateDish: (dish: RestauMenuItem) => Promise<void>;
  onUpdateDish: (dish: RestauMenuItem) => Promise<void>;
  onDeleteDish: (dishId: string) => void;
  onBackToHub: () => void;
  onNavigateToClientMenu: () => void;
}

type CategoryFilter = 'tous' | 'grillades' | 'plats' | 'entrees' | 'accompagnements' | 'boissons' | 'desserts';
type AvailabilityFilter = 'tous' | 'disponibles' | 'rupture';

const isMenuItemAvailable = (item: RestauMenuItem) =>
  item.available !== false && !(item.trackStock === true && Number(item.stockQuantity || 0) <= 0);

const CATEGORIES: { id: CategoryFilter; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'tous', label: 'Toutes les catégories', icon: UtensilsCrossed },
  { id: 'grillades', label: 'Grillades au feu', icon: Flame },
  { id: 'plats', label: 'Plats traditionnels', icon: UtensilsCrossed },
  { id: 'entrees', label: 'Entrées & Tapas', icon: Salad },
  { id: 'accompagnements', label: 'Accompagnements', icon: PlusCircle },
  { id: 'boissons', label: 'Boissons & Cocktails', icon: Wine },
  { id: 'desserts', label: 'Desserts', icon: Cookie }
];

export const MenuManagementView: React.FC<MenuManagementViewProps> = ({
  restaurant,
  menuItems,
  catalogLoading = false,
  catalogError = null,
  canManageCatalog = false,
  onToggleAvailability,
  onCreateDish,
  onUpdateDish,
  onDeleteDish,
  onBackToHub,
  onNavigateToClientMenu
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('tous');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('tous');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDishToEdit, setSelectedDishToEdit] = useState<RestauMenuItem | null>(null);

  // Stats calculation
  const totalDishes = menuItems.length;
  const availableCount = menuItems.filter(isMenuItemAvailable).length;
  const unavailableCount = menuItems.filter(item => !isMenuItemAvailable(item)).length;
  const lowStockItems = menuItems.filter(item => item.trackStock === true && Number(item.stockQuantity || 0) > 0 && Number(item.lowStockThreshold ?? 5) > 0 && Number(item.stockQuantity || 0) <= Number(item.lowStockThreshold ?? 5));
  const depletedItems = menuItems.filter(item => item.trackStock === true && Number(item.stockQuantity || 0) <= 0);

  // Filtered dishes
  const filteredDishes = useMemo(() => {
    return menuItems.filter(item => {
      // Category match
      const matchCat = selectedCategory === 'tous' || item.category === selectedCategory;

      // Availability match
      const isAvailable = isMenuItemAvailable(item);
      const matchAvailability = 
        availabilityFilter === 'tous' ||
        (availabilityFilter === 'disponibles' && isAvailable) ||
        (availabilityFilter === 'rupture' && !isAvailable);

      // Search match
      const query = searchQuery.trim().toLowerCase();
      const matchQuery = !query ||
        item.name.toLowerCase().includes(query) ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.tags && item.tags.some(t => t.toLowerCase().includes(query)));

      return matchCat && matchAvailability && matchQuery;
    });
  }, [menuItems, selectedCategory, availabilityFilter, searchQuery]);

  const handleToggle = (dishId: string) => {
    if (!canManageCatalog) return;
    sounds.playTap();
    onToggleAvailability(dishId);
  };

  const handleOpenCreateModal = () => {
    if (!canManageCatalog) return;
    sounds.playTap();
    setSelectedDishToEdit(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (dish: RestauMenuItem) => {
    if (!canManageCatalog) return;
    sounds.playTap();
    setSelectedDishToEdit(dish);
    setIsModalOpen(true);
  };

  const handleSaveDish = async (dish: RestauMenuItem): Promise<void> => {
    if (!canManageCatalog) throw new Error('Permission menu.manage requise.');
    if (selectedDishToEdit) {
      await onUpdateDish(dish);
    } else {
      await onCreateDish(dish);
    }
  };

  const handleDeleteDish = (dish: RestauMenuItem) => {
    if (!canManageCatalog) return;
    const confirmed = window.confirm(
      `Supprimer définitivement « ${dish.name} » du catalogue ? Cette action ne peut pas être annulée.`
    );
    if (!confirmed) return;
    sounds.playAlert();
    onDeleteDish(dish.id);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* Subheader / Navigation Bar */}
      <div className="bg-[#101d2d] text-white border-b border-slate-800 px-4 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                sounds.playTap();
                onBackToHub();
              }}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Revenir à la vue d'ensemble du Centre de Gestion"
            >
              <ArrowLeft size={16} />
              <span>Centre de Gestion</span>
            </button>
            <div className="h-6 w-px bg-slate-700 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Module n° 02
                </span>
                <h1 className="text-xl font-black text-white tracking-tight">
                  Menu et catalogue des plats
                </h1>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {restaurant.name} — Consultation, ajout & modification de plats, et pilotage des disponibilités
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {canManageCatalog && <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-[#ff6500] hover:bg-[#e05800] text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
              title="Ajouter un nouveau plat au catalogue"
            >
              <Plus size={16} />
              <span>Nouveau plat</span>
            </button>}

            <button
              onClick={() => {
                sounds.playTap();
                onNavigateToClientMenu();
              }}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold border border-slate-700 transition-all shadow-xs flex items-center gap-1.5 active:scale-95"
              title="Ouvrir le menu client QR dans une nouvelle vue"
            >
              <BookOpen size={14} className="text-emerald-400" />
              <span>Aperçu Menu QR</span>
              <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 space-y-6">
        {/* Metric summary banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Total Plats au Catalogue
              </p>
              <p className="text-2xl font-black text-slate-900 mt-1">
                {totalDishes}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Répertoire complet de l’établissement
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
              <UtensilsCrossed size={22} />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                Disponibles en Ligne
              </p>
              <p className="text-2xl font-black text-emerald-800 mt-1">
                {availableCount}
              </p>
              <p className="text-[11px] text-emerald-600 mt-0.5">
                Visibles et commandables par les clients
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CheckCircle2 size={24} />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-rose-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">
                En Rupture / Masqués
              </p>
              <p className="text-2xl font-black text-rose-800 mt-1">
                {unavailableCount}
              </p>
              <p className="text-[11px] text-rose-600 mt-0.5">
                Retirés automatiquement du menu client
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
              <AlertCircle size={24} />
            </div>
          </div>
        </div>

        {(lowStockItems.length > 0 || depletedItems.length > 0) && (
          <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-3"><AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-700"/>
              <div className="min-w-0 flex-1"><h2 className="text-sm font-black text-amber-950">Alertes intelligentes de stock</h2>
                <p className="mt-1 text-xs text-amber-900">{depletedItems.length} article(s) épuisé(s) · {lowStockItems.length} article(s) au seuil de réapprovisionnement.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[...depletedItems, ...lowStockItems].map(item=><div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-bold text-slate-800">{item.name}</span>
                    <span className={Number(item.stockQuantity||0)<=0?"shrink-0 font-black text-rose-700":"shrink-0 font-bold text-amber-800"}>{Number(item.stockQuantity||0)<=0?"Épuisé":String(item.stockQuantity)+" restant(s) · seuil "+String(item.lowStockThreshold ?? 5)}</span>
                  </div>)}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Operational Notice Banner */}
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <Info size={18} className="text-amber-700 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <span className="font-bold">Règle de gestion en direct :</span> Basculer la disponibilité d’un plat met à jour immédiatement le menu client QR de {restaurant.name} (<code className="px-1 py-0.5 bg-amber-100 rounded text-[11px] font-mono">{`/r/${restaurant.slug}`}</code>) sans rechargement. Les plats marqués « En rupture » sont masqués de la sélection client. Tout article déjà présent dans le panier d’un client est rigoureusement préservé.
          </div>
        </div>

        {/* Controls and filters */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher un plat par nom ou ingrédient..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Availability Filter Buttons */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0">
              <button
                onClick={() => {
                  sounds.playTap();
                  setAvailabilityFilter('tous');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  availabilityFilter === 'tous'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tous ({totalDishes})
              </button>
              <button
                onClick={() => {
                  sounds.playTap();
                  setAvailabilityFilter('disponibles');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  availabilityFilter === 'disponibles'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-700 hover:text-emerald-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Disponibles ({availableCount})
              </button>
              <button
                onClick={() => {
                  sounds.playTap();
                  setAvailabilityFilter('rupture');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  availabilityFilter === 'rupture'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-700 hover:text-rose-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                En rupture ({unavailableCount})
              </button>
            </div>
          </div>

          {/* Clickable category tiles */}
          <div className="pt-1 border-t border-slate-100 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-slate-900">Parcourir le menu</h2>
                <p className="text-[11px] text-slate-500">Touchez une catégorie pour afficher ses articles.</p>
              </div>
              <span className="text-[11px] font-bold text-slate-500">{menuItems.length} articles au total</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const isSelected = selectedCategory === cat.id;
                const countInCat = cat.id === 'tous' ? menuItems.length : menuItems.filter(i => i.category === cat.id).length;
                const isDrinks = cat.id === 'boissons';
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => { sounds.playTap(); setSelectedCategory(cat.id); }}
                    className={`min-h-[104px] rounded-2xl border p-3 sm:p-4 text-left flex flex-col justify-between transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#ff6500] ${
                      isSelected
                        ? 'bg-[#101d2d] text-white border-[#101d2d] shadow-lg'
                        : isDrinks
                          ? 'bg-amber-50 border-amber-200 text-amber-950 hover:border-amber-400 hover:shadow-md'
                          : 'bg-white border-slate-200 text-slate-800 hover:border-slate-400 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${isSelected ? 'bg-white/10 text-amber-300' : isDrinks ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                        <Icon size={19} />
                      </span>
                      <span className={`text-[11px] font-black rounded-full px-2 py-1 ${isSelected ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'}`}>{countInCat}</span>
                    </div>
                    <span className="text-xs sm:text-sm font-extrabold leading-snug">{cat.label}</span>
                  </button>
                );
              })}
            </div>
            {selectedCategory === 'boissons' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Onglet Boissons — seuls les jus, eaux, sodas et autres boissons de cet établissement sont affichés.
              </div>
            )}
          </div>
        </div>

        {/* Dishes List */}
        {catalogLoading ? (
          <div role="status" className="bg-white rounded-2xl p-12 text-center border border-slate-200/80">
            <p className="text-sm font-bold text-slate-800">Chargement du catalogue…</p>
            <p className="text-xs text-slate-500 mt-1">Synchronisation avec les données du restaurant.</p>
          </div>
        ) : catalogError ? (
          <div role="alert" className="bg-rose-50 rounded-2xl p-8 text-center border border-rose-200">
            <p className="text-sm font-bold text-rose-900">Catalogue non disponible</p>
            <p className="text-xs text-rose-800 mt-1">{catalogError}</p>
          </div>
        ) : filteredDishes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80">
            <UtensilsCrossed size={36} className="mx-auto text-slate-300 mb-3" />
            <h3 className="text-base font-bold text-slate-800">
              Aucun plat ne correspond à vos filtres
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Modifiez votre recherche ou réinitialisez les filtres pour afficher les plats du restaurant.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('tous');
                setAvailabilityFilter('tous');
              }}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredDishes.map((item) => {
              const isAvailable = isMenuItemAvailable(item);
              const optionGroupsCount = item.optionGroups?.length || 0;
              const extrasCount = item.availableExtras?.length || 0;

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl border transition-all duration-200 p-4 flex flex-col justify-between ${
                    isAvailable
                      ? 'border-slate-200/80 shadow-xs hover:border-slate-300'
                      : 'border-rose-200 bg-rose-50/20 shadow-xs'
                  }`}
                >
                  <div className="flex gap-4">
                    {/* Thumbnail Image */}
                    <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-slate-100 border border-slate-200">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className={`w-full h-full object-cover transition-opacity duration-200 ${
                          isAvailable ? 'opacity-100' : 'opacity-40 grayscale'
                        }`}
                      />
                      {!isAvailable && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-1 text-center">
                          <span className="text-[10px] font-black text-rose-200 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-500/50 uppercase tracking-wider">
                            Rupture
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            {item.category}
                          </span>
                          <h3 className={`text-sm sm:text-base font-extrabold leading-snug line-clamp-1 ${
                            isAvailable ? 'text-slate-900' : 'text-slate-600'
                          }`}>
                            {item.name}
                          </h3>
                        </div>

                        {/* Price Badge */}
                        <span className="text-sm sm:text-base font-black text-[#ff6500] shrink-0 whitespace-nowrap">
                          {formatFCFA(item.price)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        {item.description}
                      </p>

                      {/* Tags & Metadata */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                          <Clock size={11} className="text-slate-400" />
                          <span>~{item.prepTimeMinutes} min</span>
                        </span>
                        {item.trackStock === true && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${(item.stockQuantity || 0) > 0 ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700'}`}>
                            <Package size={11} />
                            {item.stockQuantity || 0} en stock
                          </span>
                        )}

                        {item.allergens?.length ? <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Allergènes : {item.allergens.join(', ')}</span> : null}
                        {item.spiceLevel ? <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">Piquant : {'🌶️'.repeat(item.spiceLevel)}</span> : null}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                          <SlidersHorizontal size={11} className="text-slate-400" />
                          <span>{optionGroupsCount} groupe(s) d'options</span>
                        </span>

                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                          <PlusCircle size={11} className="text-slate-400" />
                          <span>{extrasCount} supplément(s)</span>
                        </span>

                        {item.tags && item.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/60 text-[10px] font-bold"
                          >
                            <Sparkles size={9} className="text-amber-500" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Footer / Action Bar */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {/* Status indicator */}
                    <div className="flex items-center gap-2">
                      {isAvailable ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/80">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Disponible en ligne</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                          <AlertCircle size={13} className="text-rose-600" />
                          <span>En rupture de stock</span>
                        </div>
                      )}
                    </div>

                    {/* Actions: Modifier & Disponibilité */}
                    <div className="flex items-center gap-2">
                      {canManageCatalog && <>
                      <button
                        onClick={() => handleOpenEditModal(item)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 transition-all flex items-center gap-1.5 active:scale-95 border border-slate-200"
                        title="Modifier ce plat, ses tarifs ou ses options"
                      >
                        <Edit3 size={13} className="text-slate-600" />
                        <span>Modifier</span>
                      </button>

                      {/* Toggle button */}
                      <button
                        onClick={() => handleDeleteDish(item)}
                        className="p-2 rounded-xl text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                        title={`Supprimer ${item.name} du catalogue`}
                        aria-label={`Supprimer ${item.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => handleToggle(item.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 ${
                          isAvailable
                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 border border-rose-200/80 shadow-2xs'
                            : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs'
                        }`}
                        title={isAvailable ? 'Marquer le plat comme indisponible' : 'Rendre le plat à nouveau disponible'}
                      >
                        {isAvailable ? (
                          <>
                            <ToggleRight size={15} className="text-rose-500" />
                            <span>En rupture</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft size={15} className="text-emerald-200" />
                            <span>Rétablir</span>
                          </>
                        )}
                      </button>
                      </>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dish Form Modal (Creation & Edition) */}
      <DishFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        dishToEdit={selectedDishToEdit}
        restaurant={restaurant}
        onSave={handleSaveDish}
      />
    </div>
  );
};
