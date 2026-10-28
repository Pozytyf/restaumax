import React from 'react';
import { RestauOrder } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  CheckCircle2, 
  Clock, 
  MapPin, 
  ShoppingBag, 
  X, 
  ChefHat, 
  Receipt, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface OrderConfirmationModalProps {
  order: RestauOrder | null;
  onClose: () => void;
  onNewOrder: () => void;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  order,
  onClose,
  onNewOrder
}) => {
  if (!order) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-confirmed-title"
      >
        {/* Header Hero Banner with celebration */}
        <div className="relative bg-gradient-to-br from-[#101d2d] to-[#1a2e46] text-white p-6 text-center shrink-0">
          <button
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>

          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center mb-3 shadow-lg">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>

          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 inline-block mb-1">
            Commande confirmée & transmise
          </span>

          <h2 id="order-confirmed-title" className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
            Votre commande est en cuisine !
          </h2>

          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-white font-mono text-sm sm:text-base font-black">
            <span>Ticket n° :</span>
            <span className="text-amber-300 tracking-wider">{order.orderNumber}</span>
          </div>
        </div>

        {/* Order Details Body */}
        <div className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto max-h-[60vh]">
          {/* Status and Location Badge */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Lieu du service
              </span>
              <div className="font-extrabold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                {order.orderMode === 'sur_place' && order.tableNumber ? (
                  <>
                    <MapPin size={15} className="text-[#ff6500]" />
                    <span>Table {order.tableNumber}</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag size={15} className="text-blue-600" />
                    <span>À emporter</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Statut actuel
              </span>
              <div className="font-extrabold text-xs sm:text-sm text-amber-700 flex items-center gap-1.5">
                <ChefHat size={15} className="text-amber-600" />
                <span>En préparation</span>
              </div>
            </div>
          </div>

          {/* Items Summary Table */}
          <div className="border border-slate-200/90 rounded-2xl p-4 space-y-3 bg-white shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <Receipt size={14} className="text-slate-500" />
                <span>Récapitulatif des plats</span>
              </span>
              <span className="text-xs text-slate-500 font-bold">
                {order.itemsCount} article{order.itemsCount > 1 ? 's' : ''}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {order.items.map((item, idx) => (
                <div key={item.id || idx} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-orange-100 text-[#ff6500] font-black text-[11px] flex items-center justify-center shrink-0 tnum">
                        {item.quantity}×
                      </span>
                      <span className="font-bold text-slate-900 leading-snug">
                        {item.name}
                      </span>
                    </div>

                    {item.selectedOption && (
                      <p className="text-[11px] text-slate-500 ml-7 mt-0.5">
                        ↳ {item.selectedOption.optionName}
                        {item.selectedOption.extraPrice > 0 && (
                          <span className="text-[#ff6500] font-bold ml-1">
                            (+{formatFCFA(item.selectedOption.extraPrice)})
                          </span>
                        )}
                      </p>
                    )}

                    {item.selectedExtras && item.selectedExtras.length > 0 && (
                      <p className="text-[10px] text-slate-400 ml-7 mt-0.5">
                        Extras : {item.selectedExtras.map(e => `${e.name} (+${formatFCFA(e.price)})`).join(', ')}
                      </p>
                    )}

                    {item.prepNotes && (
                      <p className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded ml-7 mt-1 inline-block">
                        Note : « {item.prepNotes} »
                      </p>
                    )}
                  </div>

                  <span className="font-extrabold text-slate-900 tnum whitespace-nowrap">
                    {formatFCFA(item.totalPrice)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total Ledger */}
            <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
              <div>
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Total Commande
                </span>
                <span className="text-[10px] text-slate-400">
                  TVA et service inclus · Règlement au serveur ou en caisse
                </span>
              </div>
              <span className="text-lg sm:text-xl font-black text-[#ff6500] tnum">
                {formatFCFA(order.totalAmount)}
              </span>
            </div>
          </div>

          {/* Info callout */}
          <div className="p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
            <Sparkles size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold text-emerald-900">Préparation en cours :</span> Le chef et l'équipe de Chez Awa ont reçu votre ticket. Installez-vous confortablement, le service sera assuré dès que vos plats seront prêts.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onNewOrder();
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all active:scale-95"
          >
            Passer une autre commande
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-black shadow-md transition-all flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>Retour au menu</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
