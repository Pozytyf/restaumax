import React, { useState, useEffect } from 'react';
import { PaymentMethod, CartItem, Table } from '../../types/pos';
import type { RestauGuestAccount } from '../../types/restaumax';
import { formatFCFA, formatFCFANumberOnly } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  X, 
  Coins, 
  Smartphone, 
  CreditCard, 
  CheckCircle2, 
  RotateCcw,
  Receipt
} from 'lucide-react';

const EMPTY_GUEST_ACCOUNTS: RestauGuestAccount[] = [];

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  selectedTable: Table | null;
  serverName: string;
  discountPercent: number;
  alreadyPaidAmount?: number;
  orderTotalAmount?: number;
  guestAccounts?: RestauGuestAccount[];
  isSubmitting?: boolean;
  onConfirmPayment: (paymentData: {
    method: PaymentMethod;
    paidAmount: number;
    changeAmount: number;
    splitGuests: number;
    guestNumber: number;
    guestName: string;
  }) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  cart,
  selectedTable,
  serverName,
  discountPercent,
  alreadyPaidAmount = 0,
  orderTotalAmount,
  guestAccounts = EMPTY_GUEST_ACCOUNTS,
  isSubmitting = false,
  onConfirmPayment
}) => {
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [tenderedStr, setTenderedStr] = useState<string>('');
  const [splitGuests, setSplitGuests] = useState(1);
  const [guestNumber, setGuestNumber] = useState(1);
  const [guestName, setGuestName] = useState('');

  const subtotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  const discountAmount = Math.round((subtotal * discountPercent) / 100);
  const total = Math.max(0, orderTotalAmount ?? (subtotal - discountAmount));

  const maxSplitGuests = Math.min(20, Math.max(1, total));
  const baseGuestShare = Math.floor(total / splitGuests);
  const remainderGuestShare = total % splitGuests;
  const calculatedGuestShare = baseGuestShare + (guestNumber <= remainderGuestShare ? 1 : 0);
  const selectedGuestAccount = guestAccounts.find((account) => account.guestNumber === guestNumber);
  const guestShareAmount = selectedGuestAccount?.shareAmount ?? calculatedGuestShare;
  const guestPaidAmount = selectedGuestAccount?.paidAmount ?? (splitGuests === 1 ? alreadyPaidAmount : 0);
  const balanceDue = Math.max(0, guestShareAmount - guestPaidAmount);
  const splitLocked = guestAccounts.length > 0 || alreadyPaidAmount > 0;

  useEffect(() => {
    if (!isOpen) return;
    if (guestAccounts.length > 0) {
      setSplitGuests(guestAccounts.length);
      const nextGuest = guestAccounts.find((account) => account.paymentStatus !== 'paid') || guestAccounts[0];
      setGuestNumber(nextGuest.guestNumber);
      setGuestName(nextGuest.guestName || '');
    } else {
      setSplitGuests(1);
      setGuestNumber(1);
      setGuestName('');
    }
  }, [isOpen, guestAccounts]);

  // Initialize tendered amount when the modal opens or the remaining guest balance changes.
  useEffect(() => {
    if (isOpen) {
      setTenderedStr(balanceDue.toString());
      setMethod('especes');
    }
  }, [isOpen, balanceDue]);

  if (!isOpen) return null;

  const tenderedAmount = parseInt(tenderedStr.replace(/\D/g, '') || '0', 10);
  const changeAmount = Math.max(0, tenderedAmount - balanceDue);
  const remainingDue = Math.max(0, balanceDue - tenderedAmount);

  const handleNumpadPress = (digit: string) => {
    sounds.playTap();
    if (tenderedStr === '0' || tenderedStr === balanceDue.toString()) {
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
    setTenderedStr(balanceDue.toString());
  };

  const handleQuickPreset = (value: number) => {
    sounds.playTap();
    setTenderedStr(value.toString());
  };

  const handleValidate = () => {
    const isMobileMoney = method !== 'especes' && method !== 'carte';
    if (tenderedAmount <= 0 || (isMobileMoney && (tenderedAmount > balanceDue || splitGuests > 1 || guestAccounts.length > 1))) {
      sounds.playAlert();
      return;
    }
    if (method === 'carte') {
      sounds.playAlert();
      return;
    }
    sounds.playTap();
    onConfirmPayment({
      method,
      paidAmount: tenderedAmount,
      changeAmount: isMobileMoney ? 0 : changeAmount,
      splitGuests,
      guestNumber,
      guestName: guestName.trim()
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
                {splitGuests > 1 ? 'Part du convive à régler' : 'Net à Payer'}
              </span>
              <div className="text-2xl sm:text-3xl font-black text-[#101d2d] tnum">
                {formatFCFA(balanceDue)}
              </div>
              {guestPaidAmount > 0 && (
                <div className="text-xs font-semibold text-emerald-700 mt-1">
                  Déjà réglé par ce convive : {formatFCFA(guestPaidAmount)}
                </div>
              )}
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
                <button type="button" onClick={() => { sounds.playTap(); setMethod('especes'); }}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${method === 'especes' ? 'bg-[#101d2d] text-white border-[#101d2d] shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                  <Coins size={16} className={method === 'especes' ? 'text-amber-400' : 'text-slate-500'} />
                  Espèces FCFA
                </button>
                {([
                  { value: 'wave', label: 'Wave', color: 'bg-[#1ba8f0] text-white border-[#1ba8f0]' },
                  { value: 'orange_money', label: 'Orange Money', color: 'bg-[#ff6500] text-white border-[#ff6500]' },
                  { value: 'mtn_money', label: 'MTN MoMo', color: 'bg-amber-500 text-white border-amber-500' },
                  { value: 'moov_money', label: 'Moov Money', color: 'bg-blue-700 text-white border-blue-700' },
                  { value: 'djamo', label: 'Djamo', color: 'bg-violet-700 text-white border-violet-700' }
                ] as const).map((provider) => (
                  <button key={provider.value} type="button"
                    disabled={splitGuests > 1 || guestAccounts.length > 1}
                    onClick={() => { sounds.playTap(); setMethod(provider.value); setTenderedStr(balanceDue.toString()); }}
                    className={`h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all border ${method === provider.value ? provider.color + ' shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'} ${splitGuests > 1 || guestAccounts.length > 1 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <Smartphone size={16} />
                    {provider.label}
                  </button>
                ))}
                <button type="button" disabled onClick={() => setMethod('carte')}
                  className="h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs border bg-white text-slate-500 border-slate-200 opacity-40 cursor-not-allowed">
                  <CreditCard size={16} />
                  Carte bancaire · bientôt
                </button>
              </div>
              {(splitGuests > 1 || guestAccounts.length > 1) && (
                <p className="mt-2 text-[10px] text-amber-700">Les paiements Mobile Money des factures partagées seront activés après validation du rapprochement par convive.</p>
              )}
              {method !== 'especes' && method !== 'carte' && (
                <p className="mt-2 text-[10px] text-slate-500">Vous pouvez régler tout ou partie du solde restant. Le montant ne peut pas le dépasser ; la confirmation est effectuée par PayDunya.</p>
              )}
            </div>

            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-violet-950">Factures individuelles par convive</h3>
                <p className="mt-1 text-[10px] text-violet-800">Répartition égale en FCFA ; chaque convive dispose de sa part et de son suivi de règlement.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-slate-700">Nombre de convives
                  <input type="number" min="1" max={maxSplitGuests} step="1"
                    disabled={splitLocked}
                    value={splitGuests}
                    onChange={(event) => {
                      const next = Math.min(maxSplitGuests, Math.max(1, Number.parseInt(event.target.value || '1', 10) || 1));
                      setSplitGuests(next);
                      setGuestNumber(1);
                      setGuestName('');
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm disabled:bg-slate-100"/>
                </label>
                <label className="text-[11px] font-bold text-slate-700">Convive à encaisser
                  <select value={guestNumber} onChange={(event) => {
                    const next = Number(event.target.value);
                    setGuestNumber(next);
                    setGuestName(guestAccounts.find((account) => account.guestNumber === next)?.guestName || '');
                  }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
                    {Array.from({ length: splitGuests }, (_, index) => {
                      const number = index + 1;
                      const account = guestAccounts.find((item) => item.guestNumber === number);
                      const share = account?.shareAmount ?? (baseGuestShare + (number <= remainderGuestShare ? 1 : 0));
                      const paid = account?.paidAmount || (splitGuests === 1 ? alreadyPaidAmount : 0);
                      return <option key={number} value={number}>
                        {account?.guestName || `Convive ${number}`} · {paid >= share ? 'Réglé' : formatFCFA(Math.max(0, share - paid))}
                      </option>;
                    })}
                  </select>
                </label>
              </div>
              <label className="block text-[11px] font-bold text-slate-700">Nom du convive (facultatif)
                <input maxLength={80} value={guestName} onChange={(event) => setGuestName(event.target.value)}
                  placeholder={`Convive ${guestNumber}`}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"/>
              </label>
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-slate-600">Part attribuée</span>
                <span className="font-black text-violet-950">{formatFCFA(guestShareAmount)}</span>
              </div>
              {splitLocked && alreadyPaidAmount > 0 && guestAccounts.length === 0 && (
                <p className="text-[10px] text-amber-800">Une répartition individuelle ne peut plus être activée après un premier encaissement.</p>
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
                disabled={isSubmitting || tenderedAmount <= 0 || method !== 'especes'}
                className="w-full h-14 bg-[#ff6500] hover:bg-[#e05800] active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none text-white text-base font-extrabold rounded-xl shadow-lg shadow-orange-600/30 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={20} />
                <span>{isSubmitting ? 'Enregistrement…' : 'Confirmer le Règlement'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
