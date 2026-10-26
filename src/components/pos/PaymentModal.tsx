import React, { useState, useEffect } from 'react';
import { PaymentMethod, CartItem, Table } from '../../types/pos';
import { formatFCFA, formatFCFANumberOnly } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  X, 
  Coins, 
  Smartphone, 
  CreditCard, 
  CheckCircle2, 
  Users, 
  RotateCcw,
  Receipt
} from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  selectedTable: Table | null;
  serverName: string;
  discountPercent: number;
  onConfirmPayment: (paymentData: {
    method: PaymentMethod;
    paidAmount: number;
    changeAmount: number;
    splitGuests: number;
  }) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  cart,
  selectedTable,
  serverName,
  discountPercent,
  onConfirmPayment
}) => {
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [tenderedStr, setTenderedStr] = useState<string>('');
  const [splitGuests, setSplitGuests] = useState<number>(1);

  const subtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  const discountAmount = Math.round((subtotal * discountPercent) / 100);
  const total = Math.max(0, subtotal - discountAmount);

  // Initialize tendered amount when modal opens
  useEffect(() => {
    if (isOpen) {
      setTenderedStr(total.toString());
      setSplitGuests(1);
      setMethod('especes');
    }
  }, [isOpen, total]);

  if (!isOpen) return null;

  const tenderedAmount = parseInt(tenderedStr.replace(/\D/g, '') || '0', 10);
  const changeAmount = Math.max(0, tenderedAmount - total);
  const remainingDue = Math.max(0, total - tenderedAmount);
  const perGuestShare = Math.ceil(total / splitGuests);

  const handleNumpadPress = (digit: string) => {
    sounds.playTap();
    if (tenderedStr === '0' || tenderedStr === total.toString()) {
      setTenderedStr(digit);
    } else {
      setTenderedStr(tenderedStr + digit);
    }
  };

  const handleClear = () => {
    sounds.playTap();
    setTenderedStr('0');
  };

  const handleBackspace = () => {
    sounds.playTap();
    if (tenderedStr.length <= 1) {
      setTenderedStr('0');
    } else {
      setTenderedStr(tenderedStr.slice(0, -1));
    }
  };

  const handleSetExact = () => {
    sounds.playTap();
    setTenderedStr(total.toString());
  };

  const handleQuickPreset = (value: number) => {
    sounds.playTap();
    setTenderedStr(value.toString());
  };

  const handleValidate = () => {
    if (tenderedAmount < total && method === 'especes') {
      sounds.playAlert();
      return;
    }
    sounds.playCashRegister();
    onConfirmPayment({
      method,
      paidAmount: tenderedAmount,
      changeAmount: method === 'especes' ? changeAmount : 0,
      splitGuests
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#101d2d] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ff6500] flex items-center justify-center text-white">
              <Receipt size={18} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
                Encaissement Règlement
              </h2>
              <p className="text-xs text-slate-300">
                {selectedTable ? selectedTable.name : 'Vente Directe'} · Serveur: {serverName}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left Column: Totals & Methods & Split */}
          <div className="flex flex-col justify-between space-y-4">
            {/* Amount Due Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Net à Payer
              </span>
              <div className="text-2xl sm:text-3xl font-black text-[#101d2d] tnum">
                {formatFCFA(total)}
              </div>
              {discountPercent > 0 && (
                <div className="text-xs font-semibold text-emerald-600 mt-1">
                  Remise de {discountPercent}% appliquée (-{formatFCFA(discountAmount)})
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                Mode de Paiement
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    setMethod('especes');
                  }}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${
                    method === 'especes'
                      ? 'bg-[#101d2d] text-white border-[#101d2d] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Coins size={16} className={method === 'especes' ? 'text-amber-400' : 'text-slate-500'} />
                  Espèces FCFA
                </button>

                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    setMethod('wave');
                    setTenderedStr(total.toString());
                  }}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${
                    method === 'wave'
                      ? 'bg-[#1ba8f0] text-white border-[#1ba8f0] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Smartphone size={16} />
                  Wave Money
                </button>

                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    setMethod('orange_money');
                    setTenderedStr(total.toString());
                  }}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${
                    method === 'orange_money'
                      ? 'bg-[#ff6500] text-white border-[#ff6500] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Smartphone size={16} />
                  Orange Money
                </button>

                <button
                  type="button"
                  onClick={() => {
                    sounds.playTap();
                    setMethod('carte');
                    setTenderedStr(total.toString());
                  }}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${
                    method === 'carte'
                      ? 'bg-[#101d2d] text-white border-[#101d2d] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard size={16} className={method === 'carte' ? 'text-emerald-400' : 'text-slate-500'} />
                  Carte Bancaire
                </button>
              </div>
            </div>

            {/* Split Bill Calculator */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Users size={14} className="text-slate-500" />
                  Partage de l’addition
                </span>
                <span className="text-xs font-bold text-slate-900 tnum">
                  {splitGuests} {splitGuests > 1 ? 'personnes' : 'personne'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => {
                      sounds.playTap();
                      setSplitGuests(count);
                    }}
                    className={`flex-1 py-1 text-xs font-bold rounded-lg border transition-all ${
                      splitGuests === count
                        ? 'bg-[#ff6500] text-white border-[#ff6500]'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {count}P
                  </button>
                ))}
              </div>

              {splitGuests > 1 && (
                <div className="mt-2 text-center text-xs font-bold text-slate-800 bg-white border border-slate-200 py-1.5 rounded-lg tnum">
                  {formatFCFA(perGuestShare)} / personne
                </div>
              )}
            </div>

            {/* Quick Bill Tender Presets for Cash */}
            {method === 'especes' && (
              <div>
                <span className="block text-[11px] font-bold text-slate-600 uppercase mb-1.5">
                  Billets Reçus
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={handleSetExact}
                    className="py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
                  >
                    Exact
                  </button>
                  {[5000, 10000, 20000, 50000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleQuickPreset(preset)}
                      className="py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg tnum"
                    >
                      {formatFCFANumberOnly(preset)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Ergonomic High-Impact POS Touch Numpad */}
          <div className="flex flex-col justify-between">
            {/* Tendered and Change Display */}
            <div className="space-y-2 mb-3">
              <div className="bg-white border-2 border-slate-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Montant Encaissé
                  </span>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 tnum">
                    {formatFCFA(tenderedAmount)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClear}
                  className="w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-sm transition-colors"
                  title="Effacer"
                >
                  <RotateCcw size={16} />
                </button>
              </div>

              {/* Dynamic change feedback */}
              <div
                className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                  changeAmount > 0
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : remainingDue > 0 && method === 'especes'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <span className="text-xs font-bold uppercase">
                  {changeAmount > 0 ? 'Monnaie à Rendre' : remainingDue > 0 ? 'Reste Dû' : 'Compte Juste'}
                </span>
                <span className="text-lg font-black tnum">
                  {changeAmount > 0
                    ? formatFCFA(changeAmount)
                    : remainingDue > 0
                    ? formatFCFA(remainingDue)
                    : '0 FCFA'}
                </span>
              </div>
            </div>

            {/* Single-tap Numpad Grid (Buttons >= 64px) */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleNumpadPress(val)}
                  className="h-14 sm:h-16 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-200 text-lg sm:text-xl font-bold text-[#101d2d] transition-all flex items-center justify-center shadow-2xs active:scale-95 tnum"
                >
                  {val}
                </button>
              ))}

              <button
                type="button"
                onClick={handleBackspace}
                className="h-14 sm:h-16 rounded-xl bg-slate-100 border border-slate-200 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold transition-all flex items-center justify-center shadow-2xs active:scale-95"
              >
                ⌫
              </button>
            </div>

            {/* Validation CTA Button (min 56px) */}
            <div className="pt-3">
              <button
                type="button"
                onClick={handleValidate}
                disabled={tenderedAmount < total && method === 'especes'}
                className="w-full h-14 bg-[#ff6500] hover:bg-[#e05800] active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none text-white text-base font-extrabold rounded-xl shadow-lg shadow-orange-600/30 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={20} />
                <span>Confirmer le Règlement</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
