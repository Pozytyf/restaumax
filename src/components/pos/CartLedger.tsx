import React, { useState } from 'react';
import { CartItem, Table } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  Trash2, 
  Plus, 
  Minus, 
  ChefHat, 
  CreditCard, 
  Percent, 
  Users, 
  MessageSquare,
  X
} from 'lucide-react';

interface CartLedgerProps {
  cart: CartItem[];
  selectedTable: Table | null;
  tables: Table[];
  onSelectTable: (table: Table) => void;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItemNotes: (itemId: string, notes: string) => void;
  onClearCart: () => void;
  discountPercent: number;
  onSetDiscountPercent: (discount: number) => void;
  onSendToKitchen: () => void;
  onOpenPayment: () => void;
  serverName: string;
}

export const CartLedger: React.FC<CartLedgerProps> = ({
  cart,
  selectedTable,
  tables,
  onSelectTable,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateItemNotes,
  onClearCart,
  discountPercent,
  onSetDiscountPercent,
  onSendToKitchen,
  onOpenPayment,
  serverName
}) => {
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [showDiscountInput, setShowDiscountInput] = useState(false);

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  const discountAmount = Math.round((subtotal * discountPercent) / 100);
  const taxAmount = 0; // Tax included or 0% in standard restaurant display
  const grandTotal = Math.max(0, subtotal - discountAmount + taxAmount);
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleOpenNoteModal = (item: CartItem) => {
    setEditingNotesItemId(item.id);
    setNoteInput(item.specialInstructions || '');
  };

  const handleSaveNote = () => {
    if (editingNotesItemId) {
      onUpdateItemNotes(editingNotesItemId, noteInput.trim());
      setEditingNotesItemId(null);
      setNoteInput('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200/80 shadow-sm relative">
      {/* Ledger Header */}
      <div className="p-4 border-b border-slate-200 bg-[#f8fafc]">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Commande en cours
            </span>
            <span className="bg-slate-200 text-slate-800 text-xs font-bold px-2 py-0.5 rounded-full tnum">
              {totalItemCount} {totalItemCount > 1 ? 'articles' : 'article'}
            </span>
          </div>

          {cart.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Voulez-vous vider le panier actuel ?')) {
                  onClearCart();
                }
              }}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1"
            >
              <Trash2 size={13} />
              Vider
            </button>
          )}
        </div>

        {/* Table & Server Assignment */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
              Table / Emplacement
            </label>
            <select
              value={selectedTable?.id || ''}
              onChange={(e) => {
                const tbl = tables.find((t) => t.id === e.target.value);
                if (tbl) onSelectTable(tbl);
              }}
              className="w-full text-xs font-bold bg-white text-slate-900 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
            >
              <option value="">Sélectionner table</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.zone}) - {t.status === 'available' ? 'Libre' : 'Occupée'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
              Serveur
            </label>
            <div className="text-xs font-semibold bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 flex items-center gap-1.5 truncate">
              <Users size={13} className="text-slate-500 shrink-0" />
              <span className="truncate">{serverName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
              <ChefHat size={30} strokeWidth={1.5} />
            </div>
            <p className="text-sm font-bold text-slate-700 mb-1">Le panier est vide</p>
            <p className="text-xs text-slate-500 max-w-xs">
              Touchez ou cliquez sur des articles du menu au centre pour commencer l’addition.
            </p>
          </div>
        ) : (
          cart.map((item) => (
            <div
              key={item.id}
              className="group p-2.5 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 flex flex-col gap-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-1">
                    {item.menuItem.name}
                  </h4>
                  <div className="text-[11px] font-semibold text-[#ff6500] tnum">
                    {formatFCFA(item.menuItem.price)} / unité
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-slate-900 tnum">
                    {formatFCFA(item.menuItem.price * item.quantity)}
                  </div>
                </div>
              </div>

              {/* Special instructions badge or trigger */}
              {item.specialInstructions ? (
                <div 
                  onClick={() => handleOpenNoteModal(item)}
                  className="cursor-pointer text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200/80 rounded px-2 py-0.5 inline-flex items-center gap-1.5"
                >
                  <MessageSquare size={11} className="shrink-0 text-amber-600" />
                  <span className="truncate">{item.specialInstructions}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOpenNoteModal(item)}
                  className="self-start text-[10px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
                >
                  <MessageSquare size={11} />
                  + Note cuisine
                </button>
              )}

              {/* Touch Quantity Controls (>= 40px touch targets) */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playTap();
                      onUpdateQuantity(item.id, -1);
                    }}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors active:scale-95"
                    title="Diminuer"
                  >
                    <Minus size={14} />
                  </button>

                  <span className="w-8 text-center text-xs font-extrabold text-slate-900 tnum">
                    {item.quantity}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      sounds.playTap();
                      onUpdateQuantity(item.id, 1);
                    }}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors active:scale-95"
                    title="Augmenter"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    onRemoveItem(item.id);
                  }}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  title="Supprimer la ligne"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Discount & Modifiers Bar */}
      {cart.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDiscountInput(!showDiscountInput)}
              className="text-slate-700 hover:text-[#ff6500] flex items-center gap-1 font-semibold"
            >
              <Percent size={13} />
              Remise {discountPercent > 0 ? `(${discountPercent}%)` : ''}
            </button>
          </div>

          {showDiscountInput && (
            <div className="flex items-center gap-1">
              {[0, 5, 10, 15, 20].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    onSetDiscountPercent(rate);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    discountPercent === rate
                      ? 'bg-[#101d2d] text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {rate}%
                </button>
              ))}
            </div>
          )}

          {discountAmount > 0 && (
            <span className="font-bold text-rose-600 tnum">
              -{formatFCFA(discountAmount)}
            </span>
          )}
        </div>
      )}

      {/* Permanently Locked #101D2D Container with Grand Total & #FF6500 Payment Triggers */}
      <div className="p-4 bg-[#101d2d] text-white border-t border-slate-800 shadow-xl">
        <div className="space-y-1.5 mb-3 text-xs">
          <div className="flex justify-between text-slate-300 font-medium">
            <span>Sous-total</span>
            <span className="font-bold tnum">{formatFCFA(subtotal)}</span>
          </div>
          {discountPercent > 0 && (
            <div className="flex justify-between text-amber-300 font-medium">
              <span>Remise ({discountPercent}%)</span>
              <span className="font-bold tnum">-{formatFCFA(discountAmount)}</span>
            </div>
          )}
          <div className="pt-2 border-t border-slate-700/80 flex items-baseline justify-between">
            <span className="text-xs uppercase font-extrabold tracking-wider text-slate-300">
              Total Net à Payer
            </span>
            <span className="text-xl sm:text-2xl font-black text-white tracking-tight tnum">
              {formatFCFA(grandTotal)}
            </span>
          </div>
        </div>

        {/* Action Buttons: Envoyer en Cuisine (48px) + Valider l'Encaissement (56px) */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => {
              sounds.playKitchenBell();
              onSendToKitchen();
            }}
            className="w-full h-11 bg-white/10 hover:bg-white/15 active:bg-white/20 disabled:opacity-40 disabled:pointer-events-none text-white text-xs sm:text-sm font-bold rounded-lg border border-white/20 transition-all flex items-center justify-center gap-2"
          >
            <ChefHat size={16} />
            <span>Envoyer en Cuisine</span>
          </button>

          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => {
              sounds.playTap();
              onOpenPayment();
            }}
            className="w-full h-14 bg-[#ff6500] hover:bg-[#e05800] active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none text-white text-sm sm:text-base font-extrabold rounded-xl shadow-lg shadow-orange-600/30 transition-all flex items-center justify-center gap-2"
          >
            <CreditCard size={20} />
            <span>Valider l’Encaissement</span>
          </button>
        </div>
      </div>

      {/* Note Modal */}
      {editingNotesItemId && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-2xs z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-full max-w-sm">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <h4 className="text-xs font-bold text-slate-900 uppercase">
                Consigne spéciale cuisine
              </h4>
              <button
                onClick={() => setEditingNotesItemId(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={16} />
              </button>
            </div>

            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Ex: Cuisson bien cuite, sans piment, sauce à part..."
              rows={3}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-[#ff6500] mb-3"
              autoFocus
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNotesItemId(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSaveNote}
                className="px-4 py-1.5 text-xs font-bold bg-[#ff6500] text-white hover:bg-[#e05800] rounded-md shadow-sm"
              >
                Enregistrer la note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
