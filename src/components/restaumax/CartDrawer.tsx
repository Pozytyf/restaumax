import React, { useState } from 'react';
import { ClientCartItem } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ShoppingBag, 
  MapPin, 
  Info,
  ChefHat,
  AlertCircle,
  Loader2,
  CheckCircle2,
  MessageSquare
} from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: ClientCartItem[];
  tableNumber: string | null;
  onUpdateQuantity: (cartItemId: string, delta: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onClearCart: () => void;
  onConfirmOrder?: (customerNote?: string) => Promise<{ success: boolean; error?: string }>;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  tableNumber,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onConfirmOrder
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState<string>('');

  if (!isOpen) return null;

  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  const handleOrderSubmission = async () => {
    if (isSubmitting || cart.length === 0 || !onConfirmOrder) return;

    sounds.playTap();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await onConfirmOrder(customerNote.trim() || undefined);
      if (result.success) {
        // Successful submission: drawer is closed or transitioned by parent
        setCustomerNote('');
        setIsSubmitting(false);
      } else {
        // Failed submission: keep cart intact, display explicit message
        setSubmitError(result.error || "Une erreur est survenue lors de l'enregistrement de votre commande. Votre panier a été conservé.");
        setIsSubmitting(false);
        sounds.playAlert();
      }
    } catch (err: any) {
      setSubmitError(err?.message || "Erreur réseau. Votre panier a été conservé, veuillez réessayer.");
      setIsSubmitting(false);
      sounds.playAlert();
    }
  };

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
            disabled={isSubmitting}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors disabled:opacity-50"
            aria-label="Fermer le panier"
          >
            <X size={18} />
          </button>
        </div>

        {/* Clear cart button bar */}
        {cart.length > 0 && (
          <div className="bg-slate-50 border-b border-slate-200/80 px-4 py-2 flex items-center justify-between text-[11px] text-slate-600 font-semibold shrink-0">
            <div className="flex items-center gap-1.5">
              <ChefHat size={13} className="shrink-0 text-[#ff6500]" />
              <span>Plats préparés à la commande</span>
            </div>
            <button
              onClick={() => {
                if (window.confirm('Voulez-vous vider tous les articles du panier ?')) {
                  sounds.playTap();
                  onClearCart();
                }
              }}
              disabled={isSubmitting}
              className="text-rose-700 hover:text-rose-900 hover:underline flex items-center gap-1 font-bold text-[10px] disabled:opacity-50"
            >
              <Trash2 size={11} />
              Vider
            </button>
          </div>
        )}

        {/* Error notification if submission failed */}
        {submitError && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2 shrink-0 animate-in fade-in">
            <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 leading-snug">
              <span className="font-bold">Commande non transmise : </span>
              {submitError}
            </div>
          </div>
        )}

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
            <>
              {cart.map((line) => {
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
                            Note : « {line.prepNotes} »
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
                          disabled={isSubmitting}
                          onClick={() => {
                            sounds.playTap();
                            onUpdateQuantity(line.id, -1);
                          }}
                          className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-white transition-colors active:scale-95 disabled:opacity-50"
                          aria-label="Diminuer la quantité"
                        >
                          <Minus size={13} />
                        </button>

                        <span className="w-8 text-center text-xs font-extrabold text-slate-900 tnum select-none">
                          {line.quantity}
                        </span>

                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            sounds.playTap();
                            onUpdateQuantity(line.id, 1);
                          }}
                          className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-white transition-colors active:scale-95 disabled:opacity-50"
                          aria-label="Augmenter la quantité"
                        >
                          <Plus size={13} />
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          sounds.playTap();
                          onRemoveItem(line.id);
                        }}
                        className="text-xs text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors flex items-center gap-1 disabled:opacity-50"
                        title="Supprimer cet article"
                      >
                        <Trash2 size={13} />
                        <span className="text-[10px] font-semibold">Retirer</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Optional general note for the entire order */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  <MessageSquare size={12} className="text-slate-500" />
                  <span>Consigne globale pour la commande (optionnel) :</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex : Servir les boissons fraîches en premier, couverts supplémentaires..."
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  maxLength={180}
                  disabled={isSubmitting}
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg placeholder-slate-400 text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#ff6500]"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer Ledger & Active Confirmation Button */}
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
                <span className="font-bold text-emerald-400">Inclus</span>
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

            {/* LOT 2: Enabled, Responsive & Double-Click Protected Submit Button */}
            <div className="pt-1 space-y-2">
              <button
                type="button"
                disabled={isSubmitting || cart.length === 0}
                onClick={handleOrderSubmission}
                className="w-full h-13 bg-[#ff6500] hover:bg-[#e05800] disabled:bg-slate-700 disabled:text-slate-400 text-white font-black text-sm rounded-xl shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2 transition-all active:scale-[0.99] select-none cursor-pointer disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin text-white" />
                    <span>Transmission en cours...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    <span>
                      {tableNumber 
                        ? `Valider et envoyer en cuisine (Table ${tableNumber})` 
                        : 'Valider et commander à emporter'}
                    </span>
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                <span>Paiement en espèces ou Mobile Money au service</span>
                <span className="text-slate-300 font-semibold">TVA incluse (FCFA)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
