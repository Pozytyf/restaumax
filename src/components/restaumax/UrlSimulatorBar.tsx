import React from 'react';
import { Globe, MapPin, ShoppingBag, Home, Monitor, Building2, ExternalLink, Camera, QrCode } from 'lucide-react';
import { sounds } from '../../utils/audio';

interface UrlSimulatorBarProps {
  currentPath: string; // e.g. "/r/chez-awa?table=4" or "/"
  onNavigate: (path: string) => void;
  onOpenScanner?: () => void;
}

export const UrlSimulatorBar: React.FC<UrlSimulatorBarProps> = ({
  currentPath,
  onNavigate,
  onOpenScanner
}) => {
  return (
    <div className="bg-[#0b1726] border-b border-slate-800 text-white px-3 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2 z-50">
      <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300 overflow-hidden">
        <span className="flex items-center gap-1 text-slate-400 shrink-0">
          <Globe size={13} className="text-amber-400" />
          <span>URL active :</span>
        </span>
        <span className="font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-700/80 truncate max-w-xs sm:max-w-md">
          {currentPath}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {onOpenScanner && (
          <button
            onClick={() => {
              sounds.playTap();
              onOpenScanner();
            }}
            className="px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all mr-1"
            title="Scanner le QR code d'une table avec la caméra du téléphone ou de l'ordinateur"
          >
            <Camera size={11} className="text-amber-400" />
            <span>Scanner QR</span>
          </button>
        )}

        <span className="text-[10px] text-slate-400 uppercase font-bold mr-1 hidden sm:inline">
          Scénarios QR :
        </span>

        <button
          onClick={() => {
            sounds.playTap();
            onNavigate('/r/chez-awa?table=4');
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
            currentPath === '/r/chez-awa?table=4'
              ? 'bg-[#ff6500] text-white shadow-xs'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title="Tester le menu avec la table 4"
        >
          <MapPin size={11} className="text-amber-400" />
          <span>Table 4</span>
        </button>

        <button
          onClick={() => {
            sounds.playTap();
            onNavigate('/r/chez-awa');
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
            currentPath === '/r/chez-awa'
              ? 'bg-[#ff6500] text-white shadow-xs'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title="Tester le menu sans numéro de table (À emporter)"
        >
          <ShoppingBag size={11} className="text-blue-400" />
          <span>À emporter</span>
        </button>

        <button
          onClick={() => {
            sounds.playTap();
            onNavigate('/');
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
            currentPath === '/'
              ? 'bg-[#ff6500] text-white shadow-xs'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title="Retour à la page d'accueil RestauMax"
        >
          <Home size={11} />
          <span>Accueil</span>
        </button>

        <button
          onClick={() => {
            sounds.playTap();
            onNavigate('/gestion');
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
            currentPath === '/gestion'
              ? 'bg-[#ff6500] text-white shadow-xs'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title="Accéder au centre de gestion du restaurant"
        >
          <Building2 size={11} className="text-emerald-400" />
          <span>Gestion</span>
        </button>

        <button
          onClick={() => {
            sounds.playTap();
            onNavigate('/staff');
          }}
          className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
            currentPath === '/staff'
              ? 'bg-[#ff6500] text-white shadow-xs'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
          }`}
          title="Accéder aux outils de caisse et cuisine (POS / KDS)"
        >
          <Monitor size={11} />
          <span>Espace Staff</span>
        </button>
      </div>
    </div>
  );
};
