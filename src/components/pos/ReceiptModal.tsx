import React from 'react';
import { PaymentRecord } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { Printer, CheckCircle, X } from 'lucide-react';

interface ReceiptModalProps {
  receipt: PaymentRecord | null;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ receipt, onClose }) => {
  if (!receipt) return null;

  const handlePrint = () => {
    window.print();
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
        <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} />
            <span className="text-xs font-bold uppercase tracking-wider">
              Paiement Validé avec Succès
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
        <div className="p-6 font-mono text-[12px] text-slate-800 bg-[#fdfdfc] border-b border-dashed border-slate-300 print:p-0">
          {/* Header */}
          <div className="text-center pb-3 border-b border-dashed border-slate-300">
            <h3 className="font-sans font-extrabold text-base tracking-tight text-slate-900 uppercase">
              Culinary Velocity
            </h3>
            <p className="text-[10px] text-slate-500 font-sans">
              Haute Gastronomie & Grillades au Feu de Bois
            </p>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5">
              Boulevard de Marseille, Zone 4 - Abidjan
            </p>
            <p className="text-[10px] text-slate-500 font-sans">
              Tél: +225 07 00 12 34 56
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
          </div>

          {/* Tender Details */}
          <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span>MODE RÈGLEMENT:</span>
              <span className="font-bold">{getMethodLabel(receipt.paymentMethod)}</span>
            </div>
            {receipt.paidAmount > 0 && (
              <div className="flex justify-between">
                <span>MONTANT REÇU:</span>
                <span className="tnum">{formatFCFA(receipt.paidAmount)}</span>
              </div>
            )}
            {receipt.changeAmount > 0 && (
              <div className="flex justify-between font-bold text-emerald-700">
                <span>RENDU MONNAIE:</span>
                <span className="tnum">{formatFCFA(receipt.changeAmount)}</span>
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="text-center pt-3 text-[10px] text-slate-500 font-sans space-y-1">
            <p className="font-bold text-slate-800">
              MERCI DE VOTRE VISITE ET À TRÈS BIENTÔT !
            </p>
            <p>TVA 18% incluse dans les prix affichés.</p>
            <div className="pt-1 flex justify-center">
              <div className="w-40 h-7 bg-slate-200 rounded flex items-center justify-center text-[9px] text-slate-500 font-mono tracking-widest">
                ||| | || |||| | ||| |
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-slate-50 flex items-center gap-3">
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
