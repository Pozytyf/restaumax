import React from 'react';
import { ClientCartItem } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ShoppingBag, 
  AlertTriangle, 
  MapPin, 
  Clock, 
  Info,
  ChefHat
} from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: ClientCartItem[];
  tableNumber: string | null;
  onUpdateQuantity: (cartItemId: string, delta: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onClearCart: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  tableNumber,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart
}) => {
  if (!isOpen) return null;

  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex justify-end animate-in fade-in duration-150">
      <div 
        className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
      >
        {/* Header */}
        <div className="bg-[#101d2d] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#ff6500] flex items-center justify-center text-white shadow-sm">
              <ShoppingBag size={18} />
            </div>
            <div>
              <h2 id="cart-drawer-title" className="text-base font-extrabold tracking-tight">
                Votre Panier
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5">
                {tableNumber ? (
                  <span className="font-bold text-amber-300 flex items-center gap-1">
                    <MapPin size={11} /> Table {tableNumber} (Sur place)
                  </span>
                ) : (
                  <span className="font-bold text-slate-300 flex items-center gap-1">
                    <ShoppingBag size={11} /> Commande À emporter
                  </span>
                )}
                <span>·</span>
                <span>{totalItemCount} {totalItemCount > 1 ? 'articles' : 'article'}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            aria-label="Fermer le panier"
          >
            <X size={18} />
          </button>
        </div>

        {/* Demo Mode Notice Banner */}
        <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2 flex items-center justify-between text-[11px] text-amber-900 font-semibold shrink-0">
          <div className="flex items-center gap-1.5">
            <Info size={13} className="shrink-0 text-amber-600" />
            <span>Mode Démo Client — Étape 1 RestauMax</span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Voulez-vous vider tous les articles du panier ?')) {
                  sounds.playTap();
                  onClearCart();
                }
              }}
              className="text-rose-700 hover:text-rose-900 hover:underline flex items-center gap-1 font-bold text-[10px]"
            >
              <Trash2 size={11} />
              Vider
            </button>
          )}
        </div>

        {/* Cart Item Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
                <ShoppingBag size={36} strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mb-1">Votre panier est vide</h3>
              <p className="text-xs text-slate-500 max-w-xs mb-5 leading-relaxed">
                Parcourez le menu de Chez Awa et ajoutez vos grillades, accompagnements et boissons préférés.
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-[#101d2d] hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
              >
                Parcourir la carte
              </button>
            </div>
          ) : (
            cart.map((line) => {
              const lineTotal = line.unitPrice * line.quantity;
              return (
                <div
                  key={line.id}
                  className="p-3.5 rounded-xl border border-slate-200/90 bg-white hover:border-slate-300 transition-colors shadow-2xs flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs sm:text-sm font-extrabold text-slate-900 leading-snug">
                        {line.name}
                      </h4>

                      {/* Selected option detail */}
                      {line.selectedOption && (
                        <div className="text-[11px] text-slate-600 font-medium mt-0.5">
                          Accompagnement : <span className="font-bold text-slate-800">{line.selectedOption.optionName}</span>
                          {line.selectedOption.extraPrice > 0 && (
                            <span className="text-[#ff6500] font-bold ml-1 tnum">
                              (+{formatFCFA(line.selectedOption.extraPrice)})
                            </span>
                          )}
                        </div>
                      )}

                      {/* Selected extras */}
                      {line.selectedExtras && line.selectedExtras.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5 space-x-1">
                          {line.selectedExtras.map((ext) => (
                            <span key={ext.extraId} className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                              +{ext.name} ({formatFCFA(ext.price)})
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Preparation note */}
                      {line.prepNotes && (
                        <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded px-2 py-0.5 mt-1.5 inline-block">
                          Note cuisine : « {line.prepNotes} »
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs sm:text-sm font-black text-[#ff6500] tnum">
                        {formatFCFA(lineTotal)}
                      </div>
                      <div className="text-[10px] text-slate-400 tnum">
                        {formatFCFA(line.unitPrice)} / u
                      </div>
                    </div>
                  </div>

                  {/* Quantity Controls & Delete */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          sounds.playTap();
                          onUpdateQuantity(line.id, -1);
                        }}
                        className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-white transition-colors active:scale-95"
                        aria-label="Diminuer la quantité"
                      >
                        <Minus size={13} />
                      </button>

                      <span className="w-8 text-center text-xs font-extrabold text-slate-900 tnum select-none">
                        {line.quantity}
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          sounds.playTap();
                          onUpdateQuantity(line.id, 1);
                        }}
                        className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-white transition-colors active:scale-95"
                        aria-label="Augmenter la quantité"
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        sounds.playTap();
                        onRemoveItem(line.id);
                      }}
                      className="text-xs text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors flex items-center gap-1"
                      title="Supprimer cet article"
                    >
                      <Trash2 size={13} />
                      <span className="text-[10px] font-semibold">Retirer</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Ledger & Disabled Confirmation Button */}
        {cart.length > 0 && (
          <div className="bg-[#101d2d] text-white p-5 border-t border-slate-800 shrink-0 space-y-3">
            {/* Calculation details */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Sous-total articles</span>
                <span className="font-bold tnum">{formatFCFA(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Frais de service & couverts</span>
                <span className="font-bold text-emerald-400">Gratuit</span>
              </div>
              <div className="pt-2 border-t border-slate-700 flex items-baseline justify-between">
                <span className="text-xs uppercase font-extrabold tracking-wider text-slate-300">
                  Total à Payer
                </span>
                <span className="text-xl sm:text-2xl font-black text-white tracking-tight tnum">
                  {formatFCFA(subtotal)}
                </span>
              </div>
            </div>

            {/* MANDATORY: Clear & Transparent Inactive Button with explanation */}
            <div className="pt-1 space-y-2">
              <button
                type="button"
                disabled={true}
                className="w-full h-13 bg-slate-800 text-slate-400 border border-slate-700/80 rounded-xl cursor-not-allowed font-bold text-xs sm:text-sm flex flex-col items-center justify-center gap-0.5 select-none"
                aria-disabled="true"
              >
                <span className="font-extrabold uppercase tracking-wide text-slate-300 flex items-center gap-1.5">
                  <AlertTriangle size={15} className="text-amber-400" />
                  Confirmer la commande (Indisponible)
                </span>
                <span className="text-[10px] text-slate-400">
                  En attente du backend (Étape 2)
                </span>
              </button>

              <div className="p-2.5 rounded-lg bg-black/30 border border-white/10 text-[10px] text-slate-400 leading-normal">
                <p className="font-semibold text-slate-300">
                  ⚠️ Validation Étape 1 :
                </p>
                <p className="mt-0.5">
                  Aucune commande n'est transmise et aucun paiement n'est débité tant que la base de données persistante n'est pas connectée.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
