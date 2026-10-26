import React, { useState } from 'react';
import { RestaurantInfo, RestauMenuItem } from '../../types/restaumax';
import { MenuManagementView } from './MenuManagementView';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  Building2, 
  BookOpen, 
  SlidersHorizontal, 
  ShoppingBag, 
  Flame, 
  LayoutGrid, 
  Calculator, 
  Users, 
  Package, 
  BarChart3, 
  UserCheck, 
  Settings, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Calendar, 
  ShieldAlert, 
  ArrowLeft,
  UtensilsCrossed,
  Receipt
} from 'lucide-react';

export type ModuleStatus = 'active' | 'to_activate' | 'unavailable';

export interface RestaurantHubViewProps {
  restaurant: RestaurantInfo;
  menuItems: RestauMenuItem[];
  menuItemsCount: number;
  tablesCount: number;
  activeKitchenTicketsCount: number;
  totalSessionSales: number;
  onNavigateHome: () => void;
  onNavigateToClientMenu: () => void;
  onNavigateToStaffRole: (role: 'pos' | 'floor' | 'kds' | 'manager') => void;
  onToggleDishAvailability: (dishId: string) => void;
}

interface ModuleDefinition {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  description: string;
  status: ModuleStatus;
  statusLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

export const RestaurantHubView: React.FC<RestaurantHubViewProps> = ({
  restaurant,
  menuItems,
  menuItemsCount,
  tablesCount,
  activeKitchenTicketsCount,
  totalSessionSales,
  onNavigateHome,
  onNavigateToClientMenu,
  onNavigateToStaffRole,
  onToggleDishAvailability
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'menu_catalog'>('overview');
  // Format current date in French standard
  const todayFormatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());

  const capitalizedDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

  // Exact catalog of the 12 target modules with honest real-world states
  const modules: ModuleDefinition[] = [
    {
      id: 'hub',
      order: 1,
      title: 'Gestion du restaurant',
      subtitle: 'Point central & Supervision générale',
      description: 'Pilotage unifié de l’établissement, état de service en direct et coordination des espaces.',
      status: 'active',
      statusLabel: 'Actif — Espace Actuel',
      icon: Building2,
      actionLabel: 'Centre actif',
      onAction: undefined
    },
    {
      id: 'menu',
      order: 2,
      title: 'Menu et catalogue des plats',
      subtitle: 'Carte client & spécialités',
      description: 'Consultation de la carte complète, fiches techniques et pilotage de la disponibilité en direct.',
      status: 'active',
      statusLabel: 'Actif',
      icon: BookOpen,
      actionLabel: 'Gérer le catalogue & disponibilités',
      onAction: () => {
        sounds.playTap();
        setActiveTab('menu_catalog');
      }
    },
    {
      id: 'options-prices',
      order: 3,
      title: 'Options, suppléments et prix',
      subtitle: 'Personnalisations & Tarifs en FCFA',
      description: 'Accompagnements inclus ou payants (ex. alloco +500 FCFA), suppléments sauces et consignes cuisine.',
      status: 'active',
      statusLabel: 'Actif',
      icon: SlidersHorizontal,
      actionLabel: 'Voir les options du menu',
      onAction: () => {
        sounds.playTap();
        onNavigateToClientMenu();
      }
    },
    {
      id: 'orders',
      order: 4,
      title: 'Commandes',
      subtitle: 'Prise de commande & Ventes directes',
      description: 'Terminal de saisie rapide sur place et à emporter avec affectation aux tables et remises.',
      status: 'active',
      statusLabel: 'Actif',
      icon: ShoppingBag,
      actionLabel: 'Accéder au Terminal POS',
      onAction: () => {
        sounds.playTap();
        onNavigateToStaffRole('pos');
      }
    },
    {
      id: 'kitchen',
      order: 5,
      title: 'Cuisine et préparation',
      subtitle: 'Écran de production KDS',
      description: 'Affichage des bons de commande en temps réel, pointage des plats préparés et gestion des statuts.',
      status: 'active',
      statusLabel: 'Actif',
      icon: Flame,
      actionLabel: 'Accéder à l’écran Cuisine',
      onAction: () => {
        sounds.playTap();
        onNavigateToStaffRole('kds');
      }
    },
    {
      id: 'floor',
      order: 6,
      title: 'Salle, tables et service',
      subtitle: 'Plan interactif & Affectations',
      description: 'Gestion visuelle des zones (salle, terrasse, bar), suivi des couverts et des additions en cours.',
      status: 'active',
      statusLabel: 'Actif',
      icon: LayoutGrid,
      actionLabel: 'Voir le plan de salle',
      onAction: () => {
        sounds.playTap();
        onNavigateToStaffRole('floor');
      }
    },
    {
      id: 'cash-register',
      order: 7,
      title: 'Caisse et paiements',
      subtitle: 'Supervision & Clôture Z',
      description: 'Encaissements en espèces, Mobile Money et carte, audit des règlements et clôture de shift.',
      status: 'active',
      statusLabel: 'Actif',
      icon: Calculator,
      actionLabel: 'Supervision & Caisse',
      onAction: () => {
        sounds.playTap();
        onNavigateToStaffRole('manager');
      }
    },
    {
      id: 'customers',
      order: 8,
      title: 'Clients et fidélité',
      subtitle: 'Répertoire & Historique client',
      description: 'Fichier des clients réguliers, préférences de table et programmes de fidélisation prévus.',
      status: 'to_activate',
      statusLabel: 'À activer',
      icon: Users
    },
    {
      id: 'inventory',
      order: 9,
      title: 'Stocks et approvisionnements',
      subtitle: 'Matières premières & Alertes',
      description: 'Fiches techniques des ingrédients, suivi des niveaux d’inventaire et alertes de réapprovisionnement.',
      status: 'to_activate',
      statusLabel: 'À activer',
      icon: Package
    },
    {
      id: 'reports',
      order: 10,
      title: 'Rapports et statistiques',
      subtitle: 'Analyses consolidées & Exports',
      description: 'Tableaux de bord des ventes par période, analyse de marge et exports comptables périodiques.',
      status: 'to_activate',
      statusLabel: 'À activer',
      icon: BarChart3
    },
    {
      id: 'staff',
      order: 11,
      title: 'Personnel et rôles',
      subtitle: 'Serveurs, Équipes & Droits',
      description: 'Gestion des profils employés, plannings de service et attribution des droits par poste.',
      status: 'to_activate',
      statusLabel: 'À activer',
      icon: UserCheck
    },
    {
      id: 'settings',
      order: 12,
      title: 'Paramètres du restaurant',
      subtitle: 'Configuration de l’établissement',
      description: 'Coordonnées de l’entreprise, horaires d’ouverture, taxes locales et imprimantes de caisse.',
      status: 'to_activate',
      statusLabel: 'À activer',
      icon: Settings
    }
  ];

  if (activeTab === 'menu_catalog') {
    return (
      <MenuManagementView
        restaurant={restaurant}
        menuItems={menuItems}
        onToggleAvailability={onToggleDishAvailability}
        onBackToHub={() => setActiveTab('overview')}
        onNavigateToClientMenu={onNavigateToClientMenu}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* Top Header / Bar */}
      <header className="bg-[#101d2d] text-white border-b border-slate-800 px-4 lg:px-8 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                sounds.playTap();
                onNavigateHome();
              }}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors"
              title="Retour à l'accueil RestauMax"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="w-10 h-10 rounded-xl bg-[#ff6500] flex items-center justify-center font-black text-white text-base shadow-sm">
              RM
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-tight">
                  Centre de Gestion
                </h1>
                {restaurant.isOpen ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Service Ouvert
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    Service Fermé
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 font-medium">
                {restaurant.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-300">
            <div className="flex items-center gap-1.5 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-700/60">
              <Calendar size={14} className="text-[#ff6500]" />
              <span className="font-semibold">{capitalizedDate}</span>
            </div>

            <div className="hidden md:flex items-center gap-1.5 text-slate-400">
              <MapPin size={14} className="text-amber-400" />
              <span>{restaurant.city}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full p-4 lg:p-8 space-y-8">
        {/* Restaurant Identity & Overview Banner */}
        <section className="bg-white rounded-3xl p-6 lg:p-8 border border-slate-200/90 shadow-2xs space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 pb-6">
            <div className="space-y-1.5 max-w-2xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[#ff6500] flex items-center gap-1.5">
                <UtensilsCrossed size={14} />
                <span>Plateforme Opérationnelle RestauMax</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-[#101d2d] tracking-tight">
                {restaurant.name}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Ce centre de gestion constitue le point central de coordination de l'établissement : accès direct aux terminaux de commande, à la cuisine, au plan de salle, à la caisse et à la carte client QR en FCFA.
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-500 font-medium">
                <span>📍 {restaurant.address}, {restaurant.city}</span>
                <span>📞 {restaurant.phone}</span>
                <span>⏰ {restaurant.openingHours || '11h30 – 23h30'}</span>
              </div>
            </div>

            <div className="bg-[#101d2d] text-white p-4 rounded-2xl shrink-0 space-y-2 text-center md:text-right border border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Devise d'exploitation
              </span>
              <div className="text-xl font-extrabold text-[#ff6500]">
                {restaurant.currency} (Zone UEMOA)
              </div>
              <div className="text-[11px] text-slate-400">
                Tarification et encaissements sans centimes
              </div>
            </div>
          </div>

          {/* Operational Metrics (Derived strictly from real state, no fabricated indicators) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div 
              onClick={() => {
                sounds.playTap();
                setActiveTab('menu_catalog');
              }}
              className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 hover:bg-slate-100/70 transition-all cursor-pointer group"
              title="Cliquez pour gérer le catalogue et les disponibilités"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1 group-hover:text-[#ff6500] transition-colors">
                  Plats à la Carte
                </span>
                <span className="text-[10px] font-bold text-[#ff6500] opacity-0 group-hover:opacity-100 transition-opacity">
                  Gérer →
                </span>
              </div>
              <div className="text-2xl font-black text-[#101d2d] tnum">
                {menuItemsCount}
              </div>
              <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
                Catalogue actif Chez Awa
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Tables configurées
              </span>
              <div className="text-2xl font-black text-[#101d2d] tnum">
                {tablesCount}
              </div>
              <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
                Configurées en salle, terrasse & bar
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Bons Cuisine en Cours
              </span>
              <div className="text-2xl font-black text-amber-600 tnum">
                {activeKitchenTicketsCount}
              </div>
              <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
                Commandes en préparation
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Chiffre de Caisse du Shift
              </span>
              <div className="text-2xl font-black text-[#ff6500] tnum">
                {formatFCFA(totalSessionSales)}
              </div>
              <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
                Total encaissé de la session
              </span>
            </div>
          </div>
        </section>

        {/* Modules Catalog Section */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xl font-black text-[#101d2d] tracking-tight">
                Catalogue des Modules Métier
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Organisation des 12 modules cibles de RestauMax avec leur état de disponibilité réel.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                <CheckCircle2 size={13} />
                <span>7 Modules Actifs</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold border border-slate-200">
                <Clock size={13} />
                <span>5 À Activer</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((mod) => {
              const Icon = mod.icon;
              const isActive = mod.status === 'active';

              return (
                <div
                  key={mod.id}
                  className={`rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                    isActive
                      ? 'bg-white border-slate-200/90 shadow-2xs hover:shadow-md hover:border-slate-300'
                      : 'bg-slate-50/70 border-slate-200/60 opacity-90'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-orange-50 text-[#ff6500]'
                            : 'bg-slate-200/80 text-slate-500'
                        }`}
                      >
                        <Icon size={20} />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-400 font-mono">
                          #{mod.order.toString().padStart(2, '0')}
                        </span>
                        {isActive ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                            Actif
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700 border border-slate-300 flex items-center gap-1">
                            <Clock size={10} />
                            À activer
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-extrabold text-[#101d2d] leading-snug">
                        {mod.title}
                      </h4>
                      <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                        {mod.subtitle}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed mt-2">
                        {mod.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 mt-2 border-t border-slate-100">
                    {isActive && mod.onAction ? (
                      <button
                        onClick={mod.onAction}
                        className="w-full py-2.5 px-3 bg-[#101d2d] hover:bg-[#1a2c42] text-white text-xs font-bold rounded-xl flex items-center justify-between transition-colors shadow-2xs group"
                      >
                        <span>{mod.actionLabel}</span>
                        <ArrowRight size={14} className="text-[#ff6500] group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    ) : isActive ? (
                      <div className="py-2 px-3 bg-emerald-50 text-emerald-800 text-[11px] font-bold rounded-xl text-center border border-emerald-200/60">
                        {mod.statusLabel}
                      </div>
                    ) : (
                      <div className="py-2 px-3 bg-slate-100 text-slate-500 text-[11px] font-medium rounded-xl text-center border border-slate-200/60 flex items-center justify-center gap-1.5">
                        <Clock size={12} className="text-slate-400" />
                        <span>Prévu dans les étapes ultérieures</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Informative Roadmap Notice (Honest and clear) */}
        <section className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 text-xs text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldAlert size={18} />
            </div>
            <div className="space-y-1">
              <div className="font-extrabold text-sm text-amber-900">
                Activation progressive des modules
              </div>
              <p className="text-amber-800 leading-relaxed text-[11px] sm:text-xs max-w-3xl">
                Seuls les modules disposant d'un parcours réellement fonctionnel sont marqués « Actifs ». Les cartes des modules futurs (Fidélité, Stocks, Rapports périodiques, Personnel et Paramètres) sont présentées à titre informatif et n'ouvrent aucune page factice.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
