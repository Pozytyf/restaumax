import React from 'react';
import { Role } from '../types/pos';
import { Volume2, VolumeX, Plus, Building2, ShoppingCart, LayoutGrid, ChefHat, Wine, Wallet } from 'lucide-react';
import { sounds } from '../utils/audio';

interface HeaderProps {
  currentRole: Role;
  onSelectRole: (role: Role) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onQuickNewOrder: () => void;
  kitchenTicketsCount: number;
  onNavigateToHub?: () => void;
  permissions?: string[];
  canAccessCash?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole, onSelectRole, audioEnabled, onToggleAudio, onQuickNewOrder,
  kitchenTicketsCount, onNavigateToHub, permissions = [], canAccessCash = false
}) => {
  const navItems: Array<{ role: Role; label: string; description: string; icon: React.ElementType; tone: string; activeTone: string; badge?: number }> = [
    { role: 'pos', label: 'Terminal POS', description: 'Ventes et encaissements', icon: ShoppingCart, tone: 'text-orange-300', activeTone: 'border-orange-400 bg-orange-500/15' },
    { role: 'floor', label: 'Plan de Salle', description: 'Tables et occupation', icon: LayoutGrid, tone: 'text-sky-300', activeTone: 'border-sky-400 bg-sky-500/15' },
    { role: 'kds', label: 'Écran Cuisine', description: 'Préparation des commandes', icon: ChefHat, tone: 'text-amber-300', activeTone: 'border-amber-400 bg-amber-500/15', badge: kitchenTicketsCount },
    { role: 'bar', label: 'Écran Bar', description: 'Boissons et commandes bar', icon: Wine, tone: 'text-cyan-300', activeTone: 'border-cyan-400 bg-cyan-500/15' },
    { role: 'manager', label: 'Supervision & Caisse', description: 'Sessions, recettes et contrôle', icon: Wallet, tone: 'text-emerald-300', activeTone: 'border-emerald-400 bg-emerald-500/15' }
  ];
  const visibleItems = navItems.filter(item => {
    if (item.role === 'pos') return permissions.includes('pos.access');
    if (item.role === 'floor') return permissions.includes('tables.manage');
    if (item.role === 'kds') return permissions.includes('kitchen.access');
    if (item.role === 'bar') return permissions.includes('bar.access');
    return canAccessCash || permissions.includes('cash.view') || permissions.includes('cash.manage');
  });

  return (
    <aside aria-label="Navigation des espaces de travail" className="z-40 flex w-[68px] shrink-0 flex-col border-r border-slate-800 bg-[#101d2d] text-white sm:w-64">
      <div className="border-b border-white/10 px-2 py-4 sm:px-4">
        <div className="flex items-center justify-center gap-3 sm:justify-start">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff6500] text-base font-black tracking-tight shadow-sm">RM</div>
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-extrabold tracking-tight">RestauMax</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Espace de travail</p>
          </div>
        </div>
      </div>
      {onNavigateToHub && (
        <div className="border-b border-white/10 p-2 sm:p-3">
          <button type="button" onClick={() => { sounds.playTap(); onNavigateToHub(); }}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-emerald-100 transition hover:bg-emerald-500/20 sm:justify-start">
            <Building2 size={19} /><span className="hidden text-left text-sm font-extrabold sm:block">Centre de Gestion</span>
          </button>
        </div>
      )}
      <nav className="flex-1 space-y-2 overflow-y-auto p-2 sm:p-3" aria-label="Espaces RestauMax">
        <p className="hidden px-2 pb-2 pt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-400 sm:block">Espaces de travail</p>
        {visibleItems.map(item => {
          const Icon = item.icon, active = currentRole === item.role;
          return (
            <button key={item.role} type="button" aria-current={active ? 'page' : undefined}
              onClick={() => { sounds.playTap(); onSelectRole(item.role); }} title={item.label}
              className={`relative flex min-h-[68px] w-full items-center justify-center gap-3 rounded-xl border p-3 text-left transition sm:justify-start sm:p-3.5 ${active ? item.activeTone + ' text-white shadow-sm' : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white'}`}>
              <Icon size={20} className={active ? 'text-white' : item.tone} />
              <span className="hidden min-w-0 flex-1 sm:block">
                <span className="block text-sm font-extrabold leading-5">{item.label}</span>
                <span className="mt-1 block whitespace-normal text-xs leading-4 text-slate-300">{item.description}</span>
              </span>
              {!!item.badge && item.badge > 0 && <span className="absolute right-1 top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-slate-950 sm:static">{item.badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-white/10 p-2 sm:p-3">
        {permissions.includes('pos.access') && (
          <button type="button" onClick={() => { sounds.playTap(); onQuickNewOrder(); }}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#ff6500] p-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#e05800] sm:justify-start">
            <Plus size={18} strokeWidth={2.5} /><span className="hidden sm:inline">Nouvelle commande</span>
          </button>
        )}
        <button type="button" onClick={onToggleAudio} title={audioEnabled ? 'Désactiver le son' : 'Activer le son'}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 p-3 text-slate-300 transition hover:bg-white/5 hover:text-white sm:justify-start">
          {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span className="hidden text-sm font-semibold sm:inline">{audioEnabled ? 'Son activé' : 'Son désactivé'}</span>
        </button>
      </div>
    </aside>
  );
};
