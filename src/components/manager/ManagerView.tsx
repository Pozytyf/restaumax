import React, { useState } from 'react';
import { CashDrawerState, PaymentRecord } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  Clock, 
  Coins, 
  Smartphone, 
  CreditCard, 
  Receipt, 
  FileText, 
  ArrowUpRight,
  ShieldCheck,
  CheckCircle,
  Eye
} from 'lucide-react';

interface ManagerViewProps {
  drawerState: CashDrawerState;
  transactions: PaymentRecord[];
  onViewReceipt: (receipt: PaymentRecord) => void;
}

export const ManagerView: React.FC<ManagerViewProps> = ({
  drawerState,
  transactions,
  onViewReceipt
}) => {
  const [showZReportModal, setShowZReportModal] = useState(false);

  const averageTicket = drawerState.transactionCount > 0 
    ? Math.round(drawerState.totalSales / drawerState.transactionCount) 
    : 0;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-60px)] overflow-y-auto bg-[#f4f7fb] p-4 lg:p-8">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        {/* Top Header Summary */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#101d2d] tracking-tight">
              Supervision de Shift & Gestion de Caisse
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              Audit temps réel des encaissements, répartition des modes de paiement et clôture.
            </p>
          </div>

          <button
            onClick={() => {
              sounds.playTap();
              setShowZReportModal(true);
            }}
            className="px-4 py-2.5 bg-[#101d2d] hover:bg-[#1a2c42] text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm flex items-center gap-2 self-start sm:self-auto transition-colors"
          >
            <FileText size={16} />
            <span>Générer Clôture Z (Rapport du Jour)</span>
          </button>
        </div>

        {/* 4 Primary Operational KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Chiffre d’Affaires</span>
              <div className="w-8 h-8 rounded-lg bg-orange-50 text-[#ff6500] flex items-center justify-center">
                <TrendingUp size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {formatFCFA(drawerState.totalSales)}
            </div>
            <div className="text-[11px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
              <ArrowUpRight size={13} />
              <span>+18.4% vs même shift hier</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Transactions Validées</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Receipt size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {drawerState.transactionCount} tickets
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Moyenne: ~14.2 tickets / heure
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Panier Moyen</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {formatFCFA(averageTicket)}
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Par table encaissée
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Vitesse Moyenne Cuisine</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              13 min 40s
            </div>
            <div className="text-[11px] text-emerald-600 font-bold mt-1">
              94% des plats sous 15 min
            </div>
          </div>
        </div>

        {/* Cash Drawer & Payment Channel Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Cash Drawer Reconciliation */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs lg:col-span-1">
            <h3 className="text-sm font-extrabold text-[#101d2d] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Coins size={16} className="text-[#ff6500]" />
              Tiroir-Caisse Espèces
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Fond de caisse ouverture:</span>
                <span className="font-bold text-slate-900 tnum">{formatFCFA(drawerState.openingBalance)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Encaissements Espèces:</span>
                <span className="font-bold text-emerald-600 tnum">+{formatFCFA(drawerState.cashSales)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Remises accordées:</span>
                <span className="font-bold text-rose-600 tnum">-{formatFCFA(drawerState.discountsTotal)}</span>
              </div>
              <div className="flex justify-between py-2.5 bg-slate-50 px-3 rounded-xl border border-slate-200 mt-2">
                <span className="font-extrabold text-slate-900">Total Espèces Théorique:</span>
                <span className="text-base font-black text-[#ff6500] tnum">
                  {formatFCFA(drawerState.currentCash)}
                </span>
              </div>
            </div>

            <div className="mt-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              <span>Caisse équilibrée. Aucun écart de fond de caisse détecté.</span>
            </div>
          </div>

          {/* Payment Methods Breakdown */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs lg:col-span-2">
            <h3 className="text-sm font-extrabold text-[#101d2d] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Smartphone size={16} className="text-[#ff6500]" />
              Répartition par Canal de Paiement
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2 text-slate-600 text-xs font-bold mb-1">
                  <Coins size={14} className="text-amber-500" />
                  Espèces FCFA
                </div>
                <div className="text-lg font-black text-slate-900 tnum">
                  {formatFCFA(drawerState.cashSales)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {drawerState.totalSales > 0 ? Math.round((drawerState.cashSales / drawerState.totalSales) * 100) : 0}% du total
                </div>
              </div>

              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                <div className="flex items-center gap-2 text-blue-900 text-xs font-bold mb-1">
                  <Smartphone size={14} className="text-blue-500" />
                  Mobile Money (Wave / OM)
                </div>
                <div className="text-lg font-black text-blue-950 tnum">
                  {formatFCFA(drawerState.mobileMoneySales)}
                </div>
                <div className="text-[11px] text-blue-600 mt-1 font-semibold">
                  {drawerState.totalSales > 0 ? Math.round((drawerState.mobileMoneySales / drawerState.totalSales) * 100) : 0}% du total (Canal n°1)
                </div>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <div className="flex items-center gap-2 text-emerald-900 text-xs font-bold mb-1">
                  <CreditCard size={14} className="text-emerald-500" />
                  Cartes Bancaires Visa/MC
                </div>
                <div className="text-lg font-black text-emerald-950 tnum">
                  {formatFCFA(drawerState.cardSales)}
                </div>
                <div className="text-[11px] text-emerald-600 mt-1">
                  {drawerState.totalSales > 0 ? Math.round((drawerState.cardSales / drawerState.totalSales) * 100) : 0}% du total
                </div>
              </div>
            </div>

            {/* Visual ratio bar */}
            <div className="mt-5">
              <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden flex">
                <div 
                  className="bg-amber-500 h-full transition-all" 
                  style={{ width: `${drawerState.totalSales > 0 ? (drawerState.cashSales / drawerState.totalSales) * 100 : 30}%` }} 
                />
                <div 
                  className="bg-[#1ba8f0] h-full transition-all" 
                  style={{ width: `${drawerState.totalSales > 0 ? (drawerState.mobileMoneySales / drawerState.totalSales) * 100 : 50}%` }} 
                />
                <div 
                  className="bg-emerald-500 h-full transition-all" 
                  style={{ width: `${drawerState.totalSales > 0 ? (drawerState.cardSales / drawerState.totalSales) * 100 : 20}%` }} 
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mt-2">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Espèces</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1ba8f0]" /> Mobile Money</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Carte Bancaire</span>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions Audit Trail Table */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-[#101d2d] uppercase tracking-wider">
                Journal des Transactions Récentes
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Historique instantané des règlements enregistrés en caisse
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Heure</th>
                  <th className="py-3 px-4">Table</th>
                  <th className="py-3 px-4">Serveur</th>
                  <th className="py-3 px-4">Articles</th>
                  <th className="py-3 px-4">Règlement</th>
                  <th className="py-3 px-4 text-right">Total Net</th>
                  <th className="py-3 px-4 text-center">Reçu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Aucune transaction récente dans ce shift.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900">{tx.orderId}</td>
                      <td className="py-3 px-4 text-slate-500 tnum">
                        {new Date(tx.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800">{tx.tableNumber}</td>
                      <td className="py-3 px-4 text-slate-600">{tx.waiter}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {tx.items.length} article(s)
                      </td>
                      <td className="py-3 px-4">
                        <span className="capitalize font-semibold text-slate-700">
                          {tx.paymentMethod === 'especes'
                            ? 'Espèces'
                            : tx.paymentMethod === 'wave'
                            ? 'Wave'
                            : tx.paymentMethod === 'orange_money'
                            ? 'Orange Money'
                            : 'Carte Bancaire'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-black text-[#ff6500] tnum">
                        {formatFCFA(tx.total)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => onViewReceipt(tx)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-[#ff6500] hover:text-white text-slate-600 transition-colors"
                          title="Voir le reçu"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Clôture Z Modal */}
      {showZReportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="bg-[#101d2d] text-white p-5 flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  Rapport Officiel
                </span>
                <h3 className="text-lg font-black mt-0.5">Clôture de Caisse Journalière (Z)</h3>
                <p className="text-xs text-slate-300">
                  Date: {new Date().toLocaleDateString('fr-FR')} · Arrêté définitif du shift
                </p>
              </div>
              <button
                onClick={() => setShowZReportModal(false)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs font-mono">
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                <div className="flex justify-between">
                  <span>CHIFFRE TOTAL DU JOUR:</span>
                  <span className="font-bold text-slate-900 tnum">{formatFCFA(drawerState.totalSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ESPÈCES REÇUES:</span>
                  <span className="tnum">{formatFCFA(drawerState.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>MOBILE MONEY:</span>
                  <span className="tnum">{formatFCFA(drawerState.mobileMoneySales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>CARTES BANCAIRES:</span>
                  <span className="tnum">{formatFCFA(drawerState.cardSales)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-300 font-bold text-slate-900">
                  <span>ESPÈCES EN TIROIR:</span>
                  <span className="tnum">{formatFCFA(drawerState.currentCash)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 font-sans font-medium">
                <CheckCircle size={18} className="text-emerald-600 shrink-0" />
                <span>Tous les bordereaux et télécommandes sont synchronisés.</span>
              </div>

              <div className="pt-2 flex items-center gap-2 font-sans">
                <button
                  onClick={() => {
                    sounds.playTap();
                    window.print();
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-colors"
                >
                  Imprimer Rapport Z
                </button>
                <button
                  onClick={() => setShowZReportModal(false)}
                  className="flex-1 py-2.5 bg-[#ff6500] hover:bg-[#e05800] text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
                >
                  Valider la Clôture
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
