import React from 'react';
import { PaymentRecord } from '../../types/pos';
import type { RestaurantInfo } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { Printer, CheckCircle, X, Share2 } from 'lucide-react';

interface ReceiptModalProps {
  receipt: PaymentRecord | null;
  onClose: () => void;
  restaurant?: RestaurantInfo;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ receipt, onClose, restaurant }) => {
  if (!receipt) return null;
  const receiptIsPartial = receipt.guestName
    ? Number(receipt.guestRemainingAfter || 0) > 0
    : receipt.paymentStatus === 'partial';

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const guestLabel = receipt.guestName
      ? `Convive : ${receipt.guestName} (${receipt.guestNumber || 1}/${receipt.splitGuests || 1})`
      : '';
    const shareAmount = receipt.guestShareAmount ?? receipt.total;
    const guestRemaining = receipt.guestRemainingAfter ?? receipt.remainingAmount ?? 0;
    const paidOnGuestShare = Number(receipt.guestName ? receipt.guestPreviouslyPaidAmount || 0 : receipt.previouslyPaidAmount || 0) + receipt.paidAmount;
    const message = [
      restaurant?.name || 'RestauMax',
      `Ticket : ${receipt.orderId}`,
      receipt.tableNumber,
      guestLabel,
      `Part attribuée : ${formatFCFA(shareAmount)}`,
      `Payé sur cette part : ${formatFCFA(paidOnGuestShare)}`,
      `Reste à régler : ${formatFCFA(guestRemaining)}`
    ].filter(Boolean).join('\n');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Reçu de paiement RestauMax', text: message });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        window.alert('Résumé du reçu copié. Vous pouvez le partager.');
      } else {
        window.alert('Le partage n’est pas disponible sur ce navigateur.');
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') window.alert('Impossible de partager le reçu depuis ce navigateur.');
    }
  };

  const getMethodLabel = (m: string) => {
    switch (m) {
      case 'especes': return 'ESPÈCES FCFA';
      case 'wave': return 'WAVE MONEY';
      case 'orange_money': return 'ORANGE MONEY';
      case 'carte': return 'CARTE BANCAIRE';
      default: return m.toUpperCase();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200">
        {/* Top Banner */}
        <div className={`${receiptIsPartial ? 'bg-amber-600' : 'bg-emerald-600'} text-white px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <CheckCircle size={18} />
            <span className="text-xs font-bold uppercase tracking-wider">
              {receiptIsPartial ? 'Paiement partiel enregistré' : 'Part individuelle réglée'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Printable Thermal Receipt Container */}
        <div className="p-6 font-mono text-[12px] text-slate-800 bg-[#fdfdfc] border-b border-dashed border-slate-300 print:p-0 mx-auto" style={{ width: "100%", maxWidth: restaurant?.receiptPaperWidth || "80mm" }}>
          {/* Header */}
          <div className="text-center pb-3 border-b border-dashed border-slate-300">
            <h3 className="font-sans font-extrabold text-base tracking-tight text-slate-900 uppercase">
              {restaurant?.name || 'Restaurant'}
            </h3>
            <p className="text-[10px] text-slate-500 font-sans">
              {restaurant?.tagline || 'Merci de votre confiance'}
            </p>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5">
              {[restaurant?.address, restaurant?.city].filter(Boolean).join(' · ')}
            </p>
            <p className="text-[10px] text-slate-500 font-sans">
              {restaurant?.phone ? 'Tél: ' + restaurant.phone : ''}
            </p>
          </div>

          {/* Ticket Metadata */}
          <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span>TICKET:</span>
              <span className="font-bold">{receipt.orderId}</span>
            </div>
            <div className="flex justify-between">
              <span>DATE:</span>
              <span>{new Date(receipt.timestamp).toLocaleDateString('fr-FR')} {new Date(receipt.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex justify-between">
              <span>TABLE:</span>
              <span className="font-bold">{receipt.tableNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>SERVEUR:</span>
              <span>{receipt.waiter}</span>
            </div>
            {receipt.guestName && (
              <div className="flex justify-between">
                <span>CONVIVE:</span>
                <span className="font-bold">{receipt.guestName} ({receipt.guestNumber || 1}/{receipt.splitGuests || 1})</span>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1.5">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="flex justify-between items-start text-[11px]">
                <div className="flex-1 pr-2">
                  <div className="font-bold">{item.quantity}x {item.name}</div>
                  <div className="text-[10px] text-slate-500 tnum">
                    @ {formatFCFA(item.price)}
                  </div>
                </div>
                <div className="font-bold tnum">
                  {formatFCFA(item.price * item.quantity)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span>SOUS-TOTAL:</span>
              <span className="tnum">{formatFCFA(receipt.subtotal)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>REMISE APPLIQUÉE:</span>
                <span className="tnum">-{formatFCFA(receipt.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-black pt-1 border-t border-slate-300 text-slate-900">
              <span>TOTAL NET:</span>
              <span className="tnum">{formatFCFA(receipt.total)}</span>
            </div>
            {receipt.guestName && receipt.guestShareAmount !== undefined && (
              <div className="flex justify-between font-black text-violet-800">
                <span>PART INDIVIDUELLE:</span>
                <span className="tnum">{formatFCFA(receipt.guestShareAmount)}</span>
              </div>
            )}
          </div>

          {/* Tender Details */}
          <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span>MODE RÈGLEMENT:</span>
              <span className="font-bold">{getMethodLabel(receipt.paymentMethod)}</span>
            </div>
            {(receipt.guestName ? receipt.guestPreviouslyPaidAmount : receipt.previouslyPaidAmount) !== undefined &&
              Number(receipt.guestName ? receipt.guestPreviouslyPaidAmount : receipt.previouslyPaidAmount) > 0 && (
              <div className="flex justify-between">
                <span>{receipt.guestName ? 'DÉJÀ RÉGLÉ PAR CE CONVIVE:' : 'DÉJÀ RÉGLÉ AVANT:'}</span>
                <span className="tnum">{formatFCFA(Number(receipt.guestName ? receipt.guestPreviouslyPaidAmount : receipt.previouslyPaidAmount))}</span>
              </div>
            )}
            {receipt.tenderedAmount !== undefined && (
              <div className="flex justify-between">
                <span>MONTANT REMIS:</span>
                <span className="tnum">{formatFCFA(receipt.tenderedAmount)}</span>
              </div>
            )}
            {receipt.paidAmount > 0 && (
              <div className="flex justify-between">
                <span>MONTANT AFFECTÉ:</span>
                <span className="tnum">{formatFCFA(receipt.paidAmount)}</span>
              </div>
            )}
            {receipt.changeAmount > 0 && (
              <div className="flex justify-between font-bold text-emerald-700">
                <span>RENDU MONNAIE:</span>
                <span className="tnum">{formatFCFA(receipt.changeAmount)}</span>
              </div>
            )}
            {receipt.guestName && receipt.guestRemainingAfter !== undefined && receipt.guestRemainingAfter > 0 ? (
              <div className="flex justify-between font-bold text-amber-700">
                <span>RESTE DE SA PART:</span>
                <span className="tnum">{formatFCFA(receipt.guestRemainingAfter)}</span>
              </div>
            ) : !receipt.guestName && receipt.remainingAmount !== undefined && receipt.remainingAmount > 0 ? (
              <div className="flex justify-between font-bold text-amber-700">
                <span>RESTE À PAYER:</span>
                <span className="tnum">{formatFCFA(receipt.remainingAmount)}</span>
              </div>
            ) : null}
          </div>

          {/* Footer Note */}
          <div className="text-center pt-3 text-[10px] text-slate-500 font-sans space-y-1">
            <p className="font-bold text-slate-800">
              MERCI DE VOTRE VISITE ET À TRÈS BIENTÔT !
            </p>
            {restaurant?.taxRatePercent ? <p>Taxe configurée : {restaurant.taxRatePercent}%</p> : null}
            {restaurant?.receiptFooter ? <p>{restaurant.receiptFooter}</p> : null}
            <div className="pt-1 flex justify-center">
              <div className="w-40 h-7 bg-slate-200 rounded flex items-center justify-center text-[9px] text-slate-500 font-mono tracking-widest">
                ||| | || |||| | ||| |
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-slate-50 flex items-center gap-2">
          <button
            onClick={handleShare}
            className="flex-1 py-2.5 px-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg shadow-2xs flex items-center justify-center gap-1.5 transition-colors"
          >
            <Share2 size={15} />
            Partager
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg shadow-2xs flex items-center justify-center gap-1.5 transition-colors"
          >
            <Printer size={15} />
            Imprimer Reçu
          </button>

          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-3 bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center transition-colors"
          >
            Nouvelle Vente
          </button>
        </div>
      </div>
    </div>
  );
};
