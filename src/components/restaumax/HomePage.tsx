import React from 'react';
import { QrCode, Utensils, Smartphone, ShoppingBag, ShieldCheck, ArrowRight, Sparkles, MapPin, CheckCircle } from 'lucide-react';
import { sounds } from '../../utils/audio';

interface HomePageProps {
  onGoToMenuWithTable: (table: string | null) => void;
  onGoToStaffTools: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onGoToMenuWithTable,
  onGoToStaffTools
}) => {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#181c1f]">
      {/* Top Bar for RestauMax */}
      <header className="bg-[#101d2d] text-white border-b border-slate-800 px-4 lg:px-8 py-3.5 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#ff6500] flex items-center justify-center font-black text-white text-base shadow-sm">
              RM
            </div>
            <div>
              <span className="text-lg font-extrabold tracking-tight text-white block leading-none">
                RestauMax
              </span>
              <span className="text-[10px] text-amber-400 font-semibold tracking-wider uppercase">
                Étape 1 — Menu Client QR & Panier
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                sounds.playTap();
                onGoToMenuWithTable('4');
              }}
              className="px-4 py-2 bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-extrabold rounded-xl shadow-sm transition-all flex items-center gap-1.5 active:scale-95"
            >
              <Utensils size={14} />
              <span>Accéder au Menu (Table 4)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 sm:py-16 px-4 max-w-5xl mx-auto">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-[#ff6500] text-xs font-extrabold border border-orange-200">
            <Sparkles size={13} />
            <span>Solution Digitale Restauration en Afrique & Zone FCFA</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-[#101d2d] tracking-tight leading-tight">
            Le Menu Client Accessible par <span className="text-[#ff6500]">QR Code</span> en Toute Simplicité
          </h1>

          <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
            Vos clients scannent le QR code posé sur leur table, parcourent vos spécialités avec options et suppléments, et constituent leur panier en FCFA sans attendre.
          </p>

          {/* Primary Action Buttons */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => {
                sounds.playTap();
                onGoToMenuWithTable('4');
              }}
              className="w-full sm:w-auto px-6 py-3.5 bg-[#ff6500] hover:bg-[#e05800] text-white font-extrabold text-sm rounded-xl shadow-lg shadow-orange-600/20 flex items-center justify-center gap-2 transition-transform active:scale-95"
            >
              <QrCode size={18} />
              <span>Tester le Menu Client (Table 4)</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={() => {
                sounds.playTap();
                onGoToMenuWithTable(null);
              }}
              className="w-full sm:w-auto px-6 py-3.5 bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 font-extrabold text-sm rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors"
            >
              <ShoppingBag size={18} className="text-blue-600" />
              <span>Tester en Mode « À emporter »</span>
            </button>
          </div>
        </div>

        {/* Live Interactive Card: Chez Awa Demo Restaurant */}
        <div className="mt-12 bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden max-w-3xl mx-auto">
          <div className="p-6 sm:p-8 bg-[#101d2d] text-white flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center sm:text-left">
              <span className="text-xs font-extrabold uppercase tracking-widest text-[#ff6500]">
                Restaurant Pilote
              </span>
              <h2 className="text-2xl font-black">Chez Awa — Grillades & Saveurs</h2>
              <p className="text-xs text-slate-300 max-w-md">
                Spécialités de poissons capitaine braisé, dibi d’agneau, attiéke et alloco plantain à Abidjan, Zone 4C.
              </p>
            </div>

            {/* Simulated QR Code Card */}
            <div className="bg-white p-4 rounded-2xl shadow-md text-slate-900 text-center shrink-0 w-44">
              <div className="w-28 h-28 mx-auto bg-slate-900 rounded-xl p-2 flex items-center justify-center text-white mb-2">
                <QrCode size={80} className="text-white" />
              </div>
              <div className="text-[11px] font-extrabold text-slate-800">
                Table n° 4
              </div>
              <div className="text-[9px] text-slate-400">
                /r/chez-awa?table=4
              </div>
            </div>
          </div>

          {/* Quick link tester grid */}
          <div className="p-6 bg-slate-50 border-t border-slate-200">
            <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider mb-3">
              Tester les scénarios de l'Étape 1 :
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <button
                onClick={() => {
                  sounds.playTap();
                  onGoToMenuWithTable('4');
                }}
                className="p-3.5 bg-white hover:bg-orange-50/60 border border-slate-200 hover:border-[#ff6500] rounded-xl text-left flex items-start justify-between transition-all"
              >
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <MapPin size={14} className="text-amber-500" />
                    Scénario 1 : Table 4 (Sur place)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    URL : <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">/r/chez-awa?table=4</code>
                  </div>
                </div>
                <ArrowRight size={14} className="text-slate-400 shrink-0 mt-1" />
              </button>

              <button
                onClick={() => {
                  sounds.playTap();
                  onGoToMenuWithTable(null);
                }}
                className="p-3.5 bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-500 rounded-xl text-left flex items-start justify-between transition-all"
              >
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ShoppingBag size={14} className="text-blue-500" />
                    Scénario 2 : Sans table (À emporter)
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    URL : <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">/r/chez-awa</code>
                  </div>
                </div>
                <ArrowRight size={14} className="text-slate-400 shrink-0 mt-1" />
              </button>
            </div>

            {/* Note on Step 1 status */}
            <div className="mt-5 p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-950">
                <ShieldCheck size={16} className="text-amber-600" />
                Statut Étape 1 : Frontend & Panier actifs — Backend non connecté
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Tant que l'Étape 2 n'est pas validée, aucune commande n'est transmise en base de données et le bouton « Confirmer la commande » dans le panier est volontairement désactivé pour respecter l'état réel du produit.
              </p>
            </div>
          </div>
        </div>

        {/* Feature Checkpoints for Step 1 */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#ff6500] flex items-center justify-center">
              <Utensils size={20} />
            </div>
            <h3 className="text-sm font-extrabold text-slate-900">Options & Suppléments</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Choix d'accompagnement (ex. Alloco à +500 FCFA), suppléments personnalisés et notes de préparation directes pour la cuisine.
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingBag size={20} />
            </div>
            <h3 className="text-sm font-extrabold text-slate-900">Panier en FCFA Fiable</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Calcul strict des totaux avec options, contrôles de quantité (min. 1, pas de négatif) et suppression d'articles.
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Smartphone size={20} />
            </div>
            <h3 className="text-sm font-extrabold text-slate-900">100% Mobile & Ergonomique</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Affichage optimisé smartphone pour les clients en salle et comptoir avec boutons d'action larges et confortables.
            </p>
          </div>
        </div>

        {/* Internal Management Link */}
        <div className="mt-10 text-center">
          <button
            onClick={onGoToStaffTools}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 underline transition-colors"
          >
            Accéder à l'espace Terminal & Supervision Restaurant (Staff) →
          </button>
        </div>
      </section>
    </div>
  );
};
