import React from 'react';
import { Role } from '../types/pos';
import { Volume2, VolumeX, Plus } from 'lucide-react';
import { sounds } from '../utils/audio';

interface HeaderProps {
  currentRole: Role;
  onSelectRole: (role: Role) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onQuickNewOrder: () => void;
  kitchenTicketsCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onSelectRole,
  audioEnabled,
  onToggleAudio,
  onQuickNewOrder,
  kitchenTicketsCount
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#101d2d] text-white border-b border-[#1f2e42] px-4 lg:px-8 py-3.5 shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark (single line, no descriptor) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#ff6500] flex items-center justify-center font-black text-white text-base tracking-tighter shadow-sm">
            CV
          </div>
          <span className="text-lg lg:text-xl font-extrabold tracking-tight text-white whitespace-nowrap">
            Culinary Velocity
          </span>
        </div>

        {/* Zone 2: Navigation Links (single line, whitespace-nowrap) */}
        <nav className="flex items-center gap-1 sm:gap-2 md:gap-4 overflow-x-auto py-1 scrollbar-none">
          <button
            onClick={() => onSelectRole('pos')}
            className={`px-3 py-1.5 text-xs lg:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              currentRole === 'pos'
                ? 'bg-[#ff6500] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            Terminal POS
          </button>

          <button
            onClick={() => onSelectRole('floor')}
            className={`px-3 py-1.5 text-xs lg:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              currentRole === 'floor'
                ? 'bg-[#ff6500] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            Plan de Salle
          </button>

          <button
            onClick={() => onSelectRole('kds')}
            className={`px-3 py-1.5 text-xs lg:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              currentRole === 'kds'
                ? 'bg-[#ff6500] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>Écran Cuisine</span>
            {kitchenTicketsCount > 0 && (
              <span className="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.2 rounded-full tnum">
                {kitchenTicketsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectRole('manager')}
            className={`px-3 py-1.5 text-xs lg:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              currentRole === 'manager'
                ? 'bg-[#ff6500] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            Supervision & Caisse
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleAudio}
            title={audioEnabled ? 'Désactiver le son' : 'Activer le son'}
            className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors"
          >
            {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} className="text-slate-500" />}
          </button>

          <button
            onClick={() => {
              sounds.playTap();
              onQuickNewOrder();
            }}
            className="px-3.5 py-2 text-xs lg:text-sm font-bold bg-[#ff6500] hover:bg-[#e05800] text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">Nouvelle Commande</span>
            <span className="sm:hidden">Nouveau</span>
          </button>
        </div>
      </div>
    </header>
  );
};
