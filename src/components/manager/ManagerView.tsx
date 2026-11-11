import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CashDrawerState, PaymentRecord } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { PayDunyaAccountSettings } from './PayDunyaAccountSettings';
import { ClosedCashSessionsHistory } from './ClosedCashSessionsHistory';
import { auth, listClosedCashSessionsWithServerValidation, type CashSessionApiRecord } from '../../lib/firebase';
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
  ShieldCheck,
  CheckCircle,
  Eye
} from 'lucide-react';

interface CashSessionSummary {
  id: string;
  openingBalance: number;
  cashCollected: number;
  paymentCount: number;
  cashOut: number;
  cashMovementCount: number;
  cashMovements?: Array<{
    id: string;
    movementType: 'expense' | 'withdrawal';
    amount: number;
    category: string;
    note?: string;
    actorName: string;
    createdAt: number;
  }>;
  status: 'active' | 'closed';
  openedAt: number;
  expectedCash?: number;
  variance?: number;
}

interface PayDunyaIntentSummary {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  channel: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  canReconcile: boolean;
  lastProviderError?: string;
}

interface ManagerViewProps {
  restaurantSlug: string;
  isOwner: boolean;
  drawerState: CashDrawerState;
  transactions: PaymentRecord[];
  cashSession: CashSessionSummary | null;
  cashSessionLoading: boolean;
  cashSessionActionLoading: boolean;
  cashMovementActionLoading: boolean;
  canManageCash: boolean;
  canRefundPayments: boolean;
  onOpenCashSession: (openingBalance: number) => Promise<void>;
  onCloseCashSession: (closingCount: number) => Promise<void>;
  onRecordCashMovement: (movementType: 'expense' | 'withdrawal', amount: number, category: string, note: string) => Promise<void>;
  onViewReceipt: (receipt: PaymentRecord) => void;
  onRefundPayment: (payment: PaymentRecord, amount: number, reason: string) => Promise<void>;
}

export const ManagerView: React.FC<ManagerViewProps> = ({
  restaurantSlug,
  isOwner,
  drawerState,
  transactions,
  cashSession,
  cashSessionLoading,
  cashSessionActionLoading,
  cashMovementActionLoading,
  canManageCash,
  canRefundPayments,
  onOpenCashSession,
  onCloseCashSession,
  onRecordCashMovement,
  onViewReceipt,
  onRefundPayment
}) => {
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState('0');
  const [closingCountInput, setClosingCountInput] = useState('');
  const [movementAmountInput, setMovementAmountInput] = useState('');
  const [movementTypeInput, setMovementTypeInput] = useState<'expense' | 'withdrawal'>('expense');
  const [movementCategoryInput, setMovementCategoryInput] = useState('achats');
  const [movementNoteInput, setMovementNoteInput] = useState('');

  const [payDunyaIntents, setPayDunyaIntents] = useState<PayDunyaIntentSummary[]>([]);
  const [payDunyaLoading, setPayDunyaLoading] = useState(false);
  const [payDunyaActionId, setPayDunyaActionId] = useState<string | null>(null);
  const [closedSessions, setClosedSessions] = useState<CashSessionApiRecord[]>([]);
  const [closedSessionsLoading, setClosedSessionsLoading] = useState(false);
  const hasLoadedClosedSessionsRef = useRef(false);

  const loadClosedSessions = useCallback(async () => {
    if (!restaurantSlug) return;
    // Keep the existing history visible during background refreshes.
    if (!hasLoadedClosedSessionsRef.current) setClosedSessionsLoading(true);
    try {
      const res = await listClosedCashSessionsWithServerValidation(restaurantSlug, 20);
      if (res.success && Array.isArray(res.closedSessions)) {
        setClosedSessions((previous) => {
          const next = res.closedSessions as CashSessionApiRecord[];
          return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
        });
      }
    } catch (e) {
      console.warn('Erreur chargement sessions clôturées:', e);
    } finally {
      hasLoadedClosedSessionsRef.current = true;
      setClosedSessionsLoading(false);
    }
  }, [restaurantSlug]);

  const loadPayDunyaIntents = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !restaurantSlug) return;
    setPayDunyaLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/payments?restaurantSlug=' + encodeURIComponent(restaurantSlug) + '&action=paydunya_intents', {
        headers: { Authorization: 'Bearer ' + token }, credentials: 'same-origin', cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Impossible de charger les paiements PayDunya.');
      setPayDunyaIntents(Array.isArray(data.paymentIntents) ? data.paymentIntents : []);
    } catch (error) {
      console.warn('Erreur chargement des intentions PayDunya:', error);
    } finally {
      setPayDunyaLoading(false);
    }
  }, [restaurantSlug]);

  useEffect(() => { void loadPayDunyaIntents(); }, [loadPayDunyaIntents]);

  const reconcilePayDunyaIntent = async (intentId: string) => {
    const user = auth.currentUser;
    if (!user) { window.alert('Connexion requise.'); return; }
    setPayDunyaActionId(intentId);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/payments', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ restaurantSlug, action: 'reconcile_paydunya_payment', paymentIntentId: intentId })
      });
      const data = await response.json();
      if (!response.ok || !data.success) window.alert(data.error || 'Le rapprochement PayDunya a échoué.');
      await loadPayDunyaIntents();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossible de rapprocher ce paiement.');
    } finally {
      setPayDunyaActionId(null);
    }
  };

  // The history is independent from the active session snapshot: do not reload it
  // every time a cash-session object is refreshed by the background poller.
  useEffect(() => {
    hasLoadedClosedSessionsRef.current = false;
    void loadClosedSessions();
  }, [loadClosedSessions]);

  const averageTicket = useMemo(() => drawerState.transactionCount > 0
    ? Math.round(drawerState.totalSales / drawerState.transactionCount)
    : 0, [drawerState.transactionCount, drawerState.totalSales]);
  const channelSales = useMemo(() => ({
    cash: transactions.filter((tx) => tx.paymentMethod === 'especes').reduce((sum, tx) => sum + tx.paidAmount, 0),
    wave: transactions.filter((tx) => tx.paymentMethod === 'wave').reduce((sum, tx) => sum + tx.paidAmount, 0),
    orangeMoney: transactions.filter((tx) => tx.paymentMethod === 'orange_money').reduce((sum, tx) => sum + tx.paidAmount, 0),
    mtnMoney: transactions.filter((tx) => tx.paymentMethod === 'mtn_money').reduce((sum, tx) => sum + tx.paidAmount, 0),
    moovMoney: transactions.filter((tx) => tx.paymentMethod === 'moov_money').reduce((sum, tx) => sum + tx.paidAmount, 0)
  }), [transactions]);
  const channelPercent = (amount: number) => drawerState.totalSales > 0
    ? Math.round((amount / drawerState.totalSales) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-60px)] overflow-y-auto bg-[#f4f7fb] p-4 lg:p-8">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        <PayDunyaAccountSettings restaurantSlug={restaurantSlug} isOwner={isOwner} />

        {/* Top Header Summary */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#101d2d] tracking-tight">
              Supervision du journal de caisse
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              Journal des encaissements persistés et sessions de caisse avec rapprochement du comptage physique.
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
            <span>Consulter le rapport des encaissements</span>
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-[#101d2d]">Session de caisse</h2>
              <p className="mt-1 text-xs text-slate-500">Fond initial, encaissements de la session et rapprochement physique</p>
            </div>
            {cashSession && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Session ouverte</span>}
          </div>

          {cashSessionLoading && !cashSession ? (
            <p className="mt-4 text-sm text-slate-500">Chargement de la session de caisse…</p>
          ) : cashSession ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">Fond d’ouverture</p>
                  <p className="mt-1 text-lg font-black">{formatFCFA(cashSession.openingBalance)}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold text-emerald-800">Fond de caisse disponible</p>
                  <p className="mt-1 text-lg font-black text-emerald-950">{formatFCFA(cashSession.openingBalance + cashSession.cashCollected - cashSession.cashOut)}</p>
                  <p className="mt-1 text-[10px] text-emerald-800">Fond initial + espèces encaissées − sorties</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">Espèces encaissées</p>
                  <p className="mt-1 text-lg font-black">{formatFCFA(cashSession.cashCollected)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">Espèces théoriques</p>
                  <p className="mt-1 text-lg font-black">{formatFCFA(cashSession.openingBalance + cashSession.cashCollected - cashSession.cashOut)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">Nombre d’encaissements</p>
                  <p className="mt-1 text-lg font-black">{cashSession.paymentCount}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">Sorties de caisse</p>
                  <p className="mt-1 text-lg font-black">{formatFCFA(cashSession.cashOut)}</p>
                  <p className="text-[10px] text-slate-500">{cashSession.cashMovementCount} mouvement(s)</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-slate-800">Journal des sorties</h3>
                  <span className="text-[10px] font-semibold text-slate-500">Session en cours</span>
                </div>
                {!cashSession.cashMovements?.length ? (
                  <p className="text-xs text-slate-500">Aucune dépense ou aucun retrait enregistré pour cette session.</p>
                ) : (
                  <div className="space-y-2">
                    {cashSession.cashMovements.slice(0, 8).map((movement) => (
                      <div key={movement.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-slate-800">
                            {movement.movementType === 'expense' ? 'Dépense' : 'Retrait'} · {movement.category}
                          </p>
                          {movement.note && <p className="truncate text-[11px] text-slate-500">{movement.note}</p>}
                          <p className="text-[10px] text-slate-400">
                            {movement.actorName} · {new Date(movement.createdAt).toLocaleString('fr-FR')}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-black text-rose-700">-{formatFCFA(movement.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {canManageCash ? (
                <div className="space-y-3">
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    const amount = Number(movementAmountInput);
                    if (!Number.isSafeInteger(amount) || amount < 1) return;
                    void onRecordCashMovement(movementTypeInput, amount, movementCategoryInput, movementNoteInput);
                    setMovementAmountInput('');
                    setMovementNoteInput('');
                  }} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-800">Sortie de caisse</h3>
                      <p className="mt-1 text-[11px] text-slate-500">Dépense ou retrait à déduire du solde théorique</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-bold text-slate-700">Type
                        <select value={movementTypeInput} onChange={(event) => setMovementTypeInput(event.target.value as 'expense' | 'withdrawal')}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
                          <option value="expense">Dépense</option>
                          <option value="withdrawal">Retrait</option>
                        </select>
                      </label>
                      <label className="text-xs font-bold text-slate-700">Catégorie
                        <select value={movementCategoryInput} onChange={(event) => setMovementCategoryInput(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
                          <option value="achats">Achats</option>
                          <option value="transport">Transport</option>
                          <option value="entretien">Entretien</option>
                          <option value="autre">Autre</option>
                        </select>
                      </label>
                    </div>
                    <label className="text-xs font-bold text-slate-700">Montant (FCFA)
                      <input required type="number" min="1" max="100000000" step="1" value={movementAmountInput}
                        onChange={(event) => setMovementAmountInput(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"/>
                    </label>
                    <label className="text-xs font-bold text-slate-700">Motif (facultatif)
                      <input maxLength={200} value={movementNoteInput} onChange={(event) => setMovementNoteInput(event.target.value)}
                        placeholder="Ex. achat de charbon"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"/>
                    </label>
                    <button type="submit" disabled={cashMovementActionLoading || movementAmountInput === ''}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 disabled:opacity-50">
                      {cashMovementActionLoading ? 'Enregistrement…' : 'Enregistrer la sortie'}
                    </button>
                  </form>
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    const amount = Number(closingCountInput);
                    if (!Number.isSafeInteger(amount) || amount < 0) return;
                    void onCloseCashSession(amount).then(() => loadClosedSessions());
                    setClosingCountInput('');
                  }} className="flex flex-col justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <label className="text-sm font-bold text-slate-800">Comptage physique en caisse (FCFA)
                      <input required type="number" min="0" max="100000000" step="1" value={closingCountInput}
                        onChange={(event) => setClosingCountInput(event.target.value)}
                        placeholder="Saisir le montant réellement compté"
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"/>
                    </label>
                    <button type="submit" disabled={cashSessionActionLoading || closingCountInput === ''}
                      className="rounded-lg bg-[#101d2d] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                      {cashSessionActionLoading ? 'Clôture en cours…' : 'Clôturer la session et rapprocher'}
                    </button>
                  </form>
                </div>
              ) : <p className="self-center text-sm text-slate-500">Session active. La clôture et les sorties de caisse sont réservées au personnel autorisé.</p>}
            </div>
          ) : canManageCash ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              const amount = Number(openingBalanceInput);
              if (!Number.isSafeInteger(amount) || amount < 0) return;
              void onOpenCashSession(amount);
            }} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-sm font-bold text-slate-700">Fond de caisse initial (FCFA)
                <input required type="number" min="0" max="100000000" step="1" value={openingBalanceInput}
                  onChange={(event) => setOpeningBalanceInput(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm"/>
              </label>
              <button type="submit" disabled={cashSessionActionLoading}
                className="rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                {cashSessionActionLoading ? 'Ouverture…' : 'Ouvrir la session'}
              </button>
            </form>
          ) : <p className="mt-4 text-sm text-slate-500">Aucune session active. Demandez à un responsable d’ouvrir la caisse.</p>}
        </section>

        {/* Closed Cash Sessions History & Performance Comparison Component */}
        <ClosedCashSessionsHistory
          sessions={closedSessions}
          loading={closedSessionsLoading}
          onRefresh={loadClosedSessions}
        />

        <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Paiements PayDunya à suivre</h2>
              <p className="mt-1 text-xs text-slate-500">Intentions en attente ou nécessitant un rapprochement. Aucun paiement confirmé n’est supprimé.</p>
            </div>
            <button type="button" onClick={() => void loadPayDunyaIntents()} disabled={payDunyaLoading}
              className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">
              {payDunyaLoading ? 'Actualisation…' : 'Actualiser'}
            </button>
          </div>
          {payDunyaIntents.filter(intent => !['paid', 'completed', 'succeeded', 'refunded'].includes(intent.status.toLowerCase())).length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">{payDunyaLoading ? 'Chargement…' : 'Aucune intention PayDunya non soldée dans les 50 dernières opérations.'}</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {payDunyaIntents.filter(intent => !['paid', 'completed', 'succeeded', 'refunded'].includes(intent.status.toLowerCase())).map(intent => (
                <div key={intent.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800">Commande {intent.orderId} · {formatFCFA(intent.amount)}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{intent.channel || 'Canal non précisé'} · {intent.status} · Créée le {intent.createdAt ? new Date(intent.createdAt).toLocaleString('fr-FR') : 'Date inconnue'}</p>
                    {intent.lastProviderError && <p className="mt-1 text-[10px] text-amber-700">{intent.lastProviderError}</p>}
                    {['creation_unknown', 'creating'].includes(intent.status.toLowerCase()) && !intent.canReconcile && <p className="mt-1 text-[10px] font-semibold text-amber-800">Rapprochement manuel requis · ne pas recréer la facture</p>}
                  </div>
                  {canManageCash && intent.canReconcile && (
                    <button type="button" onClick={() => void reconcilePayDunyaIntent(intent.id)} disabled={payDunyaActionId === intent.id}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                      {payDunyaActionId === intent.id ? 'Vérification…' : 'Vérifier le statut'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4 Primary Operational KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Encaissements récents</span>
              <div className="w-8 h-8 rounded-lg bg-orange-50 text-[#ff6500] flex items-center justify-center">
                <TrendingUp size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {formatFCFA(drawerState.totalSales)}
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Somme des 100 derniers paiements au maximum
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Paiements enregistrés</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Receipt size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {drawerState.transactionCount} transactions
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Historique des 100 derniers encaissements au maximum
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Montant moyen encaissé</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-[#101d2d] tnum">
              {formatFCFA(averageTicket)}
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Par opération de paiement
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
              Non calculée
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Le suivi des temps de préparation sera disponible avec les horodatages cuisine.
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
                <span className="text-slate-600">Fond de caisse d’ouverture:</span>
                <span className="font-bold text-amber-700 tnum">{formatFCFA(drawerState.openingBalance)}</span>
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
                <span className="font-extrabold text-slate-900">Solde théorique du tiroir:</span>
                <span className="text-base font-black text-[#ff6500] tnum">
                  {formatFCFA(drawerState.currentCash)}
                </span>
              </div>
            </div>

            <div className="mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-2">
              <ShieldCheck size={16} className="text-amber-600 shrink-0" />
              <span>Solde théorique = fond d’ouverture + encaissements - sorties enregistrées. Les remboursements restent à intégrer.</span>
            </div>
          </div>

          {/* Payment Methods Breakdown */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs lg:col-span-2">
            <h3 className="text-sm font-extrabold text-[#101d2d] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Smartphone size={16} className="text-[#ff6500]" />
              Répartition par Canal de Paiement
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/60">
                <div className="flex items-center gap-2 text-amber-900 text-xs font-bold mb-1">
                  <Coins size={14} className="text-amber-600" /> Espèces
                </div>
                <div className="text-lg font-black text-amber-950 tnum">{formatFCFA(channelSales.cash)}</div>
                <div className="text-[11px] text-amber-800 mt-1">{channelPercent(channelSales.cash)}% des encaissements</div>
              </div>
              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                <div className="flex items-center gap-2 text-blue-900 text-xs font-bold mb-1">
                  <Smartphone size={14} className="text-blue-500" /> Wave
                </div>
                <div className="text-lg font-black text-blue-950 tnum">{formatFCFA(channelSales.wave)}</div>
                <div className="text-[11px] text-blue-700 mt-1">{channelPercent(channelSales.wave)}% des encaissements</div>
              </div>
              <div className="p-4 rounded-xl border border-orange-200 bg-orange-50/50">
                <div className="flex items-center gap-2 text-orange-900 text-xs font-bold mb-1">
                  <Smartphone size={14} className="text-orange-500" /> Orange Money
                </div>
                <div className="text-lg font-black text-orange-950 tnum">{formatFCFA(channelSales.orangeMoney)}</div>
                <div className="text-[11px] text-orange-700 mt-1">{channelPercent(channelSales.orangeMoney)}% des encaissements</div>
              </div>
              <div className="p-4 rounded-xl border border-yellow-200 bg-yellow-50/60">
                <div className="flex items-center gap-2 text-yellow-900 text-xs font-bold mb-1">
                  <Smartphone size={14} className="text-yellow-600" /> MTN Money
                </div>
                <div className="text-lg font-black text-yellow-950 tnum">{formatFCFA(channelSales.mtnMoney)}</div>
                <div className="text-[11px] text-yellow-800 mt-1">{channelPercent(channelSales.mtnMoney)}% des encaissements</div>
              </div>
              <div className="p-4 rounded-xl border border-cyan-200 bg-cyan-50/50">
                <div className="flex items-center gap-2 text-cyan-900 text-xs font-bold mb-1">
                  <Smartphone size={14} className="text-cyan-600" /> Moov Money
                </div>
                <div className="text-lg font-black text-cyan-950 tnum">{formatFCFA(channelSales.moovMoney)}</div>
                <div className="text-[11px] text-cyan-800 mt-1">{channelPercent(channelSales.moovMoney)}% des encaissements</div>
              </div>
            </div>

            {/* Visual ratio bar */}
            <div className="mt-5">
              <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden flex">
                <div 
                  className="bg-amber-500 h-full" 
                  style={{ width: `${drawerState.totalSales > 0 ? (drawerState.cashSales / drawerState.totalSales) * 100 : 30}%` }} 
                />
                <div 
                  className="bg-[#1ba8f0] h-full" 
                  style={{ width: `${drawerState.totalSales > 0 ? (drawerState.mobileMoneySales / drawerState.totalSales) * 100 : 50}%` }} 
                />
                <div 
                  className="bg-emerald-500 h-full" 
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
                  <th className="py-3 px-4">Date et heure</th>
                  <th className="py-3 px-4">Table</th>
                  <th className="py-3 px-4">Serveur</th>
                  <th className="py-3 px-4">Articles</th>
                  <th className="py-3 px-4">Règlement</th>
                  <th className="py-3 px-4 text-right">Montant encaissé</th>
                  <th className="py-3 px-4 text-center">Reçu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Aucun encaissement enregistré dans les 100 dernières opérations.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900">{tx.orderId}</td>
                      <td className="py-3 px-4 text-slate-500 tnum">
                        {new Date(tx.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800">{tx.tableNumber}</td>
                      <td className="py-3 px-4 text-slate-600">{tx.waiter}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {tx.items.length} article(s)
                      </td>
                      <td className="py-3 px-4">
                        <span className="capitalize font-semibold text-slate-700">
                          {tx.paymentMethod === 'especes' ? 'Espèces'
                            : tx.paymentMethod === 'wave' ? 'Wave'
                            : tx.paymentMethod === 'orange_money' ? 'Orange Money'
                            : tx.paymentMethod === 'mtn_money' ? 'MTN Money'
                            : tx.paymentMethod === 'moov_money' ? 'Moov Money'
                            : tx.paymentMethod === 'djamo' ? 'Djamo'
                            : 'Carte Bancaire'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-black text-[#ff6500] tnum">
                        <div>{formatFCFA(tx.paidAmount)}</div>
                        {tx.paymentStatus === 'partial' && (
                          <div className="text-[10px] font-semibold text-amber-700 mt-0.5">
                            Partiel · reste {formatFCFA(tx.remainingAmount || 0)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => onViewReceipt(tx)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-[#ff6500] hover:text-white text-slate-600 transition-colors"
                            title="Voir le reçu"
                          >
                            <Eye size={14} />
                          </button>
                          {canRefundPayments && Number(tx.refundPendingAmount || 0) > 0 && (
                            <span className="rounded-lg bg-blue-50 px-2 py-1.5 text-[10px] font-bold text-blue-800" title="Un décaissement PayDunya est en attente">
                              Remboursement en cours
                            </span>
                          )}
                          {canRefundPayments && tx.refundEligible &&
                            (tx.paidAmount - Number(tx.refundedAmount || 0) - Number(tx.refundPendingAmount || 0)) > 0 && (
                            <button
                              onClick={() => {
                                const remaining = tx.paidAmount - Number(tx.refundedAmount || 0) - Number(tx.refundPendingAmount || 0);
                                const rawAmount = window.prompt(`Montant à rembourser (maximum ${remaining} FCFA)`, String(remaining));
                                if (rawAmount === null) return;
                                const amount = Number(rawAmount);
                                if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
                                  window.alert('Montant de remboursement invalide.');
                                  return;
                                }
                                const reason = window.prompt('Motif obligatoire du remboursement :');
                                if (!reason || reason.trim().length < 3) {
                                  window.alert('Veuillez saisir un motif de trois caractères minimum.');
                                  return;
                                }
                                const confirmation = tx.paymentMethod === 'especes'
                                  ? `Confirmez-vous avoir remis physiquement ${formatFCFA(amount)} en espèces au client ?`
                                  : `Confirmer le remboursement de ${formatFCFA(amount)} vers le wallet d’origine ?`;
                                if (window.confirm(confirmation)) void onRefundPayment(tx, amount, reason.trim());
                              }}
                              className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                              title={tx.paymentMethod === 'especes' ? "Rembourser en espèces" : "Rembourser via PayDunya"}
                            >
                              Rembourser
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Aperçu des encaissements — ne constitue pas une clôture officielle */}
      {showZReportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="bg-[#101d2d] text-white p-5 flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  Aperçu non officiel
                </span>
                <h3 className="text-lg font-black mt-0.5">Rapport des encaissements</h3>
                <p className="text-xs text-slate-300">
                  Consulté le {new Date().toLocaleDateString('fr-FR')} · 100 dernières opérations au maximum
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
                  <span>TOTAL DES ENCAISSEMENTS CHARGÉS:</span>
                  <span className="font-bold text-slate-900 tnum">{formatFCFA(drawerState.totalSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ESPÈCES REÇUES:</span>
                  <span className="tnum">{formatFCFA(drawerState.cashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>WAVE:</span>
                  <span className="tnum">{formatFCFA(channelSales.wave)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ORANGE MONEY:</span>
                  <span className="tnum">{formatFCFA(channelSales.orangeMoney)}</span>
                </div>
                <div className="flex justify-between">
                  <span>MTN MONEY:</span>
                  <span className="tnum">{formatFCFA(channelSales.mtnMoney)}</span>
                </div>
                <div className="flex justify-between">
                  <span>MOOV MONEY:</span>
                  <span className="tnum">{formatFCFA(channelSales.moovMoney)}</span>
                </div>
                <div className="flex justify-between">
                  <span>CARTES BANCAIRES:</span>
                  <span className="tnum">{formatFCFA(drawerState.cardSales)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-300 font-bold text-slate-900">
                  <span>ENCAISSEMENTS ESPÈCES:</span>
                  <span className="tnum">{formatFCFA(drawerState.currentCash)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 font-sans font-medium">
                <CheckCircle size={18} className="text-emerald-600 shrink-0" />
                <span>Aperçu indicatif : les sessions, sorties de caisse et comptages physiques sont enregistrés. Les remboursements et le rapprochement comptable complet restent à intégrer.</span>
              </div>

              <div className="pt-2 flex items-center gap-2 font-sans">
                <button
                  onClick={() => {
                    sounds.playTap();
                    window.print();
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-colors"
                >
                  Imprimer l’aperçu
                </button>
                <button
                  onClick={() => setShowZReportModal(false)}
                  className="flex-1 py-2.5 bg-[#ff6500] hover:bg-[#e05800] text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
                >
                  Fermer l’aperçu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
