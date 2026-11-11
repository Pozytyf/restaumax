import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { CashDrawerState, PaymentRecord } from '../../types/pos';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { PayDunyaAccountSettings } from './PayDunyaAccountSettings';
import { ClosedCashSessionsHistory } from './ClosedCashSessionsHistory';
import { auth, db, listClosedCashSessionsWithServerValidation, type CashSessionApiRecord } from '../../lib/firebase';
import type { RestauOrder } from '../../types/restaumax';
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
  cashRefunds?: number;
  refundCount?: number;
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
  openedByName?: string;
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
  archivedAt?: number;
  archiveReason?: string;
  canReconcile: boolean;
  lastProviderError?: string;
}

interface ManagerViewProps {
  restaurantSlug: string;
  restaurantName: string;
  onNavigateToRole: (role: 'pos' | 'kds' | 'manager') => void;
  canAccessPos: boolean;
  canAccessKitchen: boolean;
  isOwner: boolean;
  drawerState: CashDrawerState;
  transactions: PaymentRecord[];
  cashSession: CashSessionSummary | null;
  cashSessionLoading: boolean;
  cashSessionActionLoading: boolean;
  cashMovementActionLoading: boolean;
  canManageCash: boolean;
  canReclassifyPayments: boolean;
  canRefundPayments: boolean;
  canCancelOrders: boolean;
  onOpenCashSession: (openingBalance: number) => Promise<void>;
  onCloseCashSession: (closingCount: number) => Promise<void>;
  onRecordCashMovement: (movementType: 'expense' | 'withdrawal', amount: number, category: string, note: string) => Promise<void>;
  onViewReceipt: (receipt: PaymentRecord) => void;
  onRefundPayment: (payment: PaymentRecord, amount: number, reason: string) => Promise<void>;
}

export const ManagerView: React.FC<ManagerViewProps> = ({
  restaurantSlug,
  restaurantName,
  onNavigateToRole,
  canAccessPos,
  canAccessKitchen,
  isOwner,
  drawerState,
  transactions,
  cashSession,
  cashSessionLoading,
  cashSessionActionLoading,
  cashMovementActionLoading,
  canManageCash,
  canReclassifyPayments,
  canRefundPayments,
  canCancelOrders,
  onOpenCashSession,
  onCloseCashSession,
  onRecordCashMovement,
  onViewReceipt,
  onRefundPayment
}) => {
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [activeCashSection, setActiveCashSection] = useState<'session' | 'collections' | 'control'>('session');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'mobile'>('all');
  const [reportFrom, setReportFrom] = useState(() => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingBalanceInput, setOpeningBalanceInput] = useState('0');
  const [closingCountInput, setClosingCountInput] = useState('');
  const [movementAmountInput, setMovementAmountInput] = useState('');
  const [movementTypeInput, setMovementTypeInput] = useState<'expense' | 'withdrawal'>('expense');
  const [movementCategoryInput, setMovementCategoryInput] = useState('achats');
  const [movementNoteInput, setMovementNoteInput] = useState('');

  const [activeOrders, setActiveOrders] = useState<RestauOrder[]>([]);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [payDunyaIntents, setPayDunyaIntents] = useState<PayDunyaIntentSummary[]>([]);
  const [showArchivedPayDunyaIntents, setShowArchivedPayDunyaIntents] = useState(false);
  const [payDunyaLoading, setPayDunyaLoading] = useState(false);
  const [payDunyaActionId, setPayDunyaActionId] = useState<string | null>(null);
  const [paymentCorrectionId, setPaymentCorrectionId] = useState<string | null>(null);
  const [closedSessions, setClosedSessions] = useState<CashSessionApiRecord[]>([]);
  const [closedSessionsLoading, setClosedSessionsLoading] = useState(false);
  const hasLoadedClosedSessionsRef = useRef(false);
  const [selectedRevenueDate, setSelectedRevenueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dailyRevenueReport, setDailyRevenueReport] = useState<any>(null);
  const [dailyRevenueClosure, setDailyRevenueClosure] = useState<any>(null);
  const [dailyRevenueLoading, setDailyRevenueLoading] = useState(false);
  const [dailyRevenueClosing, setDailyRevenueClosing] = useState(false);
  const [dailyRevenueError, setDailyRevenueError] = useState('');
  const [dailyRevenueNotice, setDailyRevenueNotice] = useState('');

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

  useEffect(() => {
    if (!restaurantSlug) return;
    const ordersQuery = query(
      collection(db, 'restaurants', restaurantSlug, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    return onSnapshot(ordersQuery, snapshot => {
      setActiveOrders(snapshot.docs.map(document => ({ ...document.data(), id: document.id } as RestauOrder))
        .filter(order => ['pending', 'in_prep', 'ready'].includes(order.status)));
    }, error => console.warn('Erreur chargement des commandes actives de caisse:', error));
  }, [restaurantSlug]);

  const cancelActiveOrder = async (order: RestauOrder, removalAction = false) => {
    const reason = window.prompt(removalAction
      ? 'Motif obligatoire du retrait de la caisse (3 à 300 caractères) :'
      : 'Motif obligatoire de l’annulation (3 à 300 caractères) :');
    if (reason === null) return;
    if (reason.trim().length < 3) { window.alert('Veuillez saisir un motif de trois caractères minimum.'); return; }
    if (!window.confirm(removalAction
      ? 'Retirer cette commande impayée de la caisse ? Elle restera conservée dans l’historique et le suivi PayDunya.'
      : 'Confirmer l’annulation logique de cette commande ? Le journal et les stocks seront mis à jour.')) return;
    const user = auth.currentUser;
    if (!user) { window.alert('Connexion requise.'); return; }
    setCancellingOrderId(order.id);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/order-status', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({
          restaurantSlug, orderId: order.id, status: 'cancelled',
          cancellationReason: reason.trim(),
          ...(removalAction ? { pendingOnly: true, removalAction: true } : {})
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) window.alert(data.error || 'Annulation refusée.');
      else {
        window.alert(removalAction
          ? 'Commande retirée de la caisse. Son historique et son intention PayDunya restent conservés pour rapprochement manuel ; ne recréez pas la facture.'
          : 'Commande annulée logiquement. L’intention PayDunya est conservée pour rapprochement manuel ; ne recréez pas la facture.');
        await loadPayDunyaIntents();
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossible d’annuler cette commande.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const loadPayDunyaIntents = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !restaurantSlug) return;
    setPayDunyaLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/payments?restaurantSlug=' + encodeURIComponent(restaurantSlug) + '&action=paydunya_intents&includeArchived=' + String(showArchivedPayDunyaIntents), {
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
  }, [restaurantSlug, showArchivedPayDunyaIntents]);

  useEffect(() => { void loadPayDunyaIntents(); }, [loadPayDunyaIntents]);

  const reclassifyCashPayment = async (payment: PaymentRecord) => {
    if (payment.paymentMethod !== 'especes') return;
    const providerInput = window.prompt(
      'Opérateur Mobile Money (orange_money, wave, mtn, moov ou djamo) :',
      'wave'
    );
    if (providerInput === null) return;
    const provider = providerInput.trim().toLowerCase();
    if (!['orange_money', 'wave', 'mtn', 'moov', 'djamo'].includes(provider)) {
      window.alert('Opérateur invalide.');
      return;
    }
    const transactionReference = window.prompt('Référence exacte de la transaction Mobile Money :');
    if (!transactionReference || !/^[A-Za-z0-9_-]{6,100}$/.test(transactionReference.trim())) {
      window.alert('Référence de transaction invalide.');
      return;
    }
    const reason = window.prompt('Motif de la correction (8 caractères minimum) :');
    if (!reason || reason.trim().length < 8) {
      window.alert('Le motif doit contenir au moins 8 caractères.');
      return;
    }
    const verificationNote = window.prompt(
      'Indiquez le contrôle effectué dans le compte marchand ou l’application officielle (référence retrouvée, montant et statut confirmé) :'
    );
    if (!verificationNote || verificationNote.trim().length < 8) {
      window.alert('Le rapprochement de la transaction doit être documenté.');
      return;
    }
    if (!window.confirm(
      'Confirmer la reclassification de ' + formatFCFA(payment.paidAmount) +
      ' de Espèces vers ' + provider.toUpperCase() +
      ' ? Aucun nouvel encaissement ne sera créé ; le solde payé de la commande restera inchangé.'
    )) return;
    const user = auth.currentUser;
    if (!user) { window.alert('Connexion requise.'); return; }
    setPaymentCorrectionId(payment.id);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          restaurantSlug,
          action: 'reclassify_cash_payment',
          paymentId: payment.id,
          provider,
          transactionReference: transactionReference.trim(),
          reason: reason.trim(),
          verificationNote: verificationNote.trim(),
          idempotencyKey: 'reclass_' + window.crypto.randomUUID().replace(/-/g, '')
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Correction refusée.');
      window.alert('Paiement reclassé avec succès. Le journal et les totaux de caisse seront actualisés automatiquement.');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossible de corriger ce paiement.');
    } finally {
      setPaymentCorrectionId(null);
    }
  };

  const archivePayDunyaIntent = async (intentId: string) => {
    const reason = window.prompt('Motif obligatoire de l’archivage (3 à 300 caractères) :');
    if (reason === null) return;
    if (reason.trim().length < 3) { window.alert('Le motif doit contenir au moins trois caractères.'); return; }
    if (!window.confirm('Masquer cette intention de la liste opérationnelle ? Sa référence et son historique resteront conservés dans les archives. Aucun statut de paiement ne sera modifié.')) return;
    const user = auth.currentUser;
    if (!user) { window.alert('Connexion requise.'); return; }
    setPayDunyaActionId(intentId);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/payments', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ restaurantSlug, action: 'archive_paydunya_intent', paymentIntentId: intentId, reason: reason.trim() })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Archivage refusé.');
      window.alert('Intention archivée. La trace financière et le rapprochement manuel sont conservés.');
      await loadPayDunyaIntents();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossible d’archiver cette intention.');
    } finally {
      setPayDunyaActionId(null);
    }
  };

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


  useEffect(() => {
    let active = true;
    const loadDailyRevenue = async () => {
      setDailyRevenueLoading(true);
      setDailyRevenueError('');
      try {
        const user = auth.currentUser;
        if (!user) throw new Error('Connexion requise pour consulter les recettes.');
        const token = await user.getIdToken(true);
        const response = await fetch('/api/reports?restaurantSlug=' + encodeURIComponent(restaurantSlug) + '&reportType=daily&date=' + encodeURIComponent(selectedRevenueDate), {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'same-origin', cache: 'no-store'
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Chargement de la recette impossible.');
        if (!active) return;
        setDailyRevenueReport(data.report || null);
        setDailyRevenueClosure(data.closure || null);
      } catch (error) {
        if (active) setDailyRevenueError(error instanceof Error ? error.message : 'Recette journalière indisponible.');
      } finally {
        if (active) setDailyRevenueLoading(false);
      }
    };
    void loadDailyRevenue();
    return () => { active = false; };
  }, [restaurantSlug, selectedRevenueDate]);

  const closeSelectedRevenueDay = async () => {
    if (dailyRevenueClosing || dailyRevenueClosure || !dailyRevenueReport) return;
    const today = new Date().toISOString().slice(0, 10);
    if (selectedRevenueDate >= today) {
      setDailyRevenueError('La clôture définitive est disponible uniquement pour une journée terminée.');
      return;
    }
    if (!window.confirm('Clôturer définitivement la recette du ' + new Date(selectedRevenueDate + 'T00:00:00Z').toLocaleDateString('fr-FR') + ' ?')) return;
    const user = auth.currentUser;
    if (!user) { setDailyRevenueError('Connexion requise pour clôturer la recette.'); return; }
    setDailyRevenueClosing(true); setDailyRevenueError(''); setDailyRevenueNotice('');
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ restaurantSlug, date: selectedRevenueDate })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Clôture journalière refusée.');
      setDailyRevenueClosure(data.closure || { closedAt: Date.now(), closedByName: user.displayName || user.email || 'Responsable' });
      setDailyRevenueNotice('Recette clôturée et archivée définitivement.');
    } catch (error) {
      setDailyRevenueError(error instanceof Error ? error.message : 'Impossible de clôturer cette recette.');
    } finally {
      setDailyRevenueClosing(false);
    }
  };

  const averageTicket = useMemo(() => drawerState.transactionCount > 0
    ? Math.round(drawerState.totalSales / drawerState.transactionCount)
    : 0, [drawerState.transactionCount, drawerState.totalSales]);
  const channelSales = useMemo(() => ({
    cash: transactions.filter((tx) => tx.paymentMethod === 'especes').reduce((sum, tx) => sum + tx.paidAmount, 0),
    wave: transactions.filter((tx) => tx.paymentMethod === 'wave').reduce((sum, tx) => sum + tx.paidAmount, 0),
    orangeMoney: transactions.filter((tx) => tx.paymentMethod === 'orange_money').reduce((sum, tx) => sum + tx.paidAmount, 0),
    mtnMoney: transactions.filter((tx) => tx.paymentMethod === 'mtn_money').reduce((sum, tx) => sum + tx.paidAmount, 0),
    moovMoney: transactions.filter((tx) => tx.paymentMethod === 'moov_money').reduce((sum, tx) => sum + tx.paidAmount, 0),
    other: transactions.filter((tx) => ['djamo', 'card', 'carte', 'bank_card', 'carte_bancaire', 'credit_card'].includes(String(tx.paymentMethod))).reduce((sum, tx) => sum + tx.paidAmount, 0)
  }), [transactions]);
  const cashRefunds = Number(cashSession?.cashRefunds || 0);
  const otherCashOut = Math.max(0, Number(cashSession?.cashOut || 0) - cashRefunds);
  const expectedCash = Number(cashSession?.openingBalance || 0) + Number(cashSession?.cashCollected || 0) - otherCashOut - cashRefunds;
  const channelTotal = Object.values(channelSales).reduce((sum, amount) => sum + amount, 0);
  const filteredTransactions = transactions.filter((tx) => {
    const method = String(tx.paymentMethod || '');
    if (paymentFilter === 'cash') return method === 'especes';
    if (paymentFilter === 'mobile') return ['wave', 'orange_money', 'mtn_money', 'moov_money', 'djamo'].includes(method);
    return true;
  });
  const exportCollectionsCsv = () => {
    if (reportFrom > reportTo) { window.alert('La date de début doit précéder la date de fin.'); return; }
    const rows = transactions.filter((tx) => {
      const date = new Date(tx.timestamp).toISOString().slice(0, 10);
      return date >= reportFrom && date <= reportTo;
    });
    const columns = ['Date et heure', 'Commande', 'Canal', 'Montant FCFA', 'Statut', 'Référence'];
    const escapeCsv = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const lines = [columns.map(escapeCsv).join(';'), ...rows.map((tx) => [
      new Date(tx.timestamp).toLocaleString('fr-FR'),
      tx.orderId,
      tx.paymentMethod,
      tx.paidAmount,
      tx.paymentStatus || 'paid',
      tx.mobileMoneyReference || ''
    ].map(escapeCsv).join(';'))];
    const blob = new Blob(['\\uFEFF' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'restaumax-encaissements-' + reportFrom + '-' + reportTo + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const currentVariance = closingCountInput === '' ? Number(cashSession?.variance || 0) : Number(closingCountInput) - expectedCash;
  const recentClosedSessions = closedSessions.filter((session) => Boolean(session.closedAt) && Number(session.closedAt) >= Date.now() - 3 * 86400000);
  const recentVarianceCount = recentClosedSessions.filter((session) => Math.abs(Number(session.variance || 0)) > 0).length;


  return (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-[#f4f7fb] font-[Inter]">
      <div className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 bg-[#101d2d] px-4 py-3 text-white shadow-sm lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><span className="text-lg font-extrabold tracking-tight">RestauMax</span><span className="truncate text-sm font-medium text-slate-300">{restaurantName}</span></div>
        <nav aria-label="Navigation principale" className="flex flex-wrap items-center justify-center gap-1">
          <button type="button" disabled={!canAccessPos} onClick={() => onNavigateToRole("pos")} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">Commandes</button>
          <button type="button" disabled={!canAccessKitchen} onClick={() => onNavigateToRole("kds")} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">Cuisine</button>
          <button type="button" aria-current="page" onClick={() => onNavigateToRole("manager")} className="min-h-11 rounded-lg bg-[#c2410c] px-4 text-sm font-bold text-white">Supervision &amp; Caisse</button>
        </nav>
        <span className="rounded-lg px-3 py-2 text-sm font-semibold text-white">{isOwner ? "Propriétaire" : "Personnel autorisé"}</span>
      </div>
      <div className="w-full flex-1 p-4 lg:p-8">

      <div className="max-w-[1440px] mx-auto w-full space-y-6">
        

        {/* Supervision header */}
        <header className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">Centre de gestion <span aria-hidden="true">›</span> Supervision &amp; Caisse{activeCashSection !== "session" && <><span aria-hidden="true"> › </span>{activeCashSection === "collections" ? "Encaissements" : "Contrôle"}</>}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="text-2xl font-extrabold tracking-tight text-[#101d2d]">{activeCashSection === "session" ? "Supervision & Caisse" : activeCashSection === "collections" ? "Encaissements" : "Contrôle"}</h1><p className="mt-1 text-sm font-medium text-slate-600">Pilotez la session, suivez les règlements et contrôlez les clôtures.</p></div>
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-950">Données du restaurant · FCFA</span>
          </div>
        </header>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-[#dbe3ee] bg-white p-3 shadow-2xs">
            <nav aria-label="Sous-sections Supervision et Caisse" className="flex flex-col gap-2">
              <button type="button" aria-current={activeCashSection === "session" ? "page" : undefined} onClick={() => setActiveCashSection("session")} className={"min-h-16 w-full rounded-xl p-3 text-left transition-colors " + (activeCashSection === "session" ? "bg-[#101d2d] text-white" : "bg-white text-[#101d2d] hover:bg-slate-50")}>
                <span className="block text-sm font-extrabold">1 · Session de caisse</span><span className={"mt-1 block text-xs " + (activeCashSection === "session" ? "text-slate-200" : "text-slate-600")}>Ouverture, sorties, clôture avec comptage</span>
              </button>
              <button type="button" aria-current={activeCashSection === "collections" ? "page" : undefined} onClick={() => setActiveCashSection("collections")} className={"min-h-16 w-full rounded-xl p-3 text-left transition-colors " + (activeCashSection === "collections" ? "bg-[#101d2d] text-white" : "bg-white text-[#101d2d] hover:bg-slate-50")}>
                <span className="block text-sm font-extrabold">2 · Encaissements</span><span className={"mt-1 block text-xs " + (activeCashSection === "collections" ? "text-slate-200" : "text-slate-600")}>Journal des règlements, répartition par canal</span>
              </button>
              <button type="button" aria-current={activeCashSection === "control" ? "page" : undefined} onClick={() => setActiveCashSection("control")} className={"min-h-16 w-full rounded-xl p-3 text-left transition-colors " + (activeCashSection === "control" ? "bg-[#101d2d] text-white" : "bg-white text-[#101d2d] hover:bg-slate-50")}>
                <span className="block text-sm font-extrabold">3 · Contrôle</span><span className={"mt-1 block text-xs " + (activeCashSection === "control" ? "text-slate-200" : "text-slate-600")}>Écarts, sessions clôturées (Z), rapports</span>
              </button>
            </nav>
          </aside>
        <main className="min-w-0 space-y-5">
            <div hidden={activeCashSection !== 'session'} aria-label="Session de caisse" className="space-y-5">
        <section id="cash-session" aria-labelledby="cash-session-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="cash-session-title" className="text-base font-black text-[#101d2d]">1. Session de caisse</h2>
              <p className="mt-1 text-xs text-slate-500">Fond initial, encaissements de la session et rapprochement physique</p>
            </div>
          </div>

          {cashSession && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">Session ouverte</span><span className="text-xs font-medium text-emerald-950">Ouverte à {new Date(cashSession.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {cashSession.openedByName || 'Responsable'}</span></div>}
          {cashSessionLoading && !cashSession ? (
            <p className="mt-4 text-sm text-slate-500">Chargement de la session de caisse…</p>
          ) : cashSession ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#dbe3ee] bg-white p-4"><p className="text-xs font-semibold text-slate-600">Fond d’ouverture</p><p className="mt-2 text-xl font-extrabold text-[#101d2d]">{formatFCFA(cashSession.openingBalance)}</p></div>
                <div className="rounded-xl border border-[#dbe3ee] bg-white p-4"><p className="text-xs font-semibold text-slate-600">Encaissements espèces</p><p className="mt-2 text-xl font-extrabold text-[#101d2d]">{formatFCFA(cashSession.cashCollected)}</p></div>
                <div className="rounded-xl border border-[#dbe3ee] bg-white p-4"><p className="text-xs font-semibold text-slate-600">Sorties de caisse</p><p className="mt-2 text-xl font-extrabold text-[#101d2d]">{formatFCFA(otherCashOut)}</p><p className="mt-1 text-xs text-slate-500">Remboursements espèces suivis séparément : {formatFCFA(cashRefunds)}</p></div>
                <div className="rounded-xl border border-[#101d2d] bg-[#101d2d] p-4 text-white"><p className="text-xs font-semibold text-slate-200">Solde théorique</p><p className="mt-2 text-xl font-extrabold">{formatFCFA(expectedCash)}</p><p className="mt-1 text-xs text-slate-200">Fond + espèces − sorties − remboursements espèces</p></div>
              </div>
              {canManageCash ? (
                <div className="grid gap-3 xl:grid-cols-2">
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
                          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
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
                    <label className="text-xs font-bold text-slate-700">Motif
                      <input required maxLength={200} value={movementNoteInput} onChange={(event) => setMovementNoteInput(event.target.value)}
                        placeholder="Ex. Achat de glace"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"/>
                    </label>
                    <button type="submit" disabled={cashMovementActionLoading || movementAmountInput === ''}
                      className="min-h-11 rounded-lg border border-slate-300 bg-[#c2410c] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
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
                    <h3 className="text-sm font-black text-slate-800">Clôture de la session</h3>
                    <label className="text-sm font-bold text-slate-800">Comptage physique en caisse (FCFA)
                      <input required type="number" min="0" max="100000000" step="1" value={closingCountInput}
                        onChange={(event) => setClosingCountInput(event.target.value)}
                        placeholder="Saisir le montant réellement compté"
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"/>
                    </label>
                    <p aria-live="polite" className="text-xs font-semibold text-slate-700">Écart avec le solde théorique : {closingCountInput === '' ? '—' : formatFCFA(Number(closingCountInput) - expectedCash)}</p>
                    <button type="submit" disabled={cashSessionActionLoading || closingCountInput === ''}
                      className="min-h-11 rounded-lg bg-[#101d2d] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                      {cashSessionActionLoading ? 'Clôture en cours…' : 'Clôturer la session'}
                    </button>
                  </form>
                </div>
              ) : <p className="self-center text-sm text-slate-500">Session active. La clôture et les sorties de caisse sont réservées au personnel autorisé.</p>}
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
                className="min-h-11 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                {cashSessionActionLoading ? 'Ouverture…' : 'Ouvrir la session de caisse'}
              </button>
            </form>
          ) : <p className="mt-4 text-sm text-slate-500">Aucune session active. Demandez à un responsable d’ouvrir la caisse.</p>}
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Le détail par canal et le journal sont dans « Encaissements » ; les écarts, clôtures Z et rapports dans « Contrôle ».</p>
        </section>
            </div>

            <div hidden={activeCashSection !== 'collections'} aria-label="Encaissements" className="space-y-5">
        <section id="paydunya-reconcile" className="rounded-2xl border border-blue-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Paiements PayDunya à suivre</h2>
              <p className="mt-1 text-xs text-slate-500">Intentions en attente ou nécessitant un rapprochement. Aucun paiement confirmé n’est supprimé.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setShowArchivedPayDunyaIntents(value => !value)}
                className="min-h-11 rounded-lg border px-3 py-2 text-xs font-bold">
                {showArchivedPayDunyaIntents ? 'Masquer les archives' : 'Afficher les archives'}
              </button>
              <button type="button" onClick={() => void loadPayDunyaIntents()} disabled={payDunyaLoading}
                className="min-h-11 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">
                {payDunyaLoading ? 'Actualisation…' : 'Actualiser'}
              </button>
            </div>
          </div>
          {payDunyaIntents.filter(intent => !['paid', 'completed', 'succeeded', 'refunded', 'cancelled', 'expired'].includes(intent.status.toLowerCase())).length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">{payDunyaLoading ? 'Chargement…' : 'Aucune intention PayDunya non soldée dans les 100 dernières opérations.'}</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {payDunyaIntents.filter(intent => !['paid', 'completed', 'succeeded', 'refunded'].includes(intent.status.toLowerCase())).map(intent => (
                <div key={intent.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800">Commande {intent.orderId} · {formatFCFA(intent.amount)}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{intent.channel || 'Canal non précisé'} · {intent.status} · Créée le {intent.createdAt ? new Date(intent.createdAt).toLocaleString('fr-FR') : 'Date inconnue'}</p>
                    {intent.lastProviderError && <p className="mt-1 text-[10px] text-amber-700">{intent.lastProviderError}</p>}
                    {['creation_unknown', 'creating', 'order_cancelled_pending_manual_reconciliation'].includes(intent.status.toLowerCase()) && !intent.canReconcile && <p className="mt-1 text-[10px] font-semibold text-amber-800">{intent.status.toLowerCase() === 'order_cancelled_pending_manual_reconciliation' ? 'Commande annulée · rapprochement manuel requis · ne pas recréer la facture' : 'Rapprochement manuel requis · ne pas recréer la facture'}</p>}
                  </div>
                  {canCancelOrders && intent.status.toLowerCase() === 'creation_unknown' && (() => {
                    const order = activeOrders.find(candidate => candidate.id === intent.orderId);
                    const unpaid = order && order.status === 'pending' && Number(order.paidAmount || 0) === 0 && !['partial', 'paid'].includes(String(order.paymentStatus || ''));
                    return unpaid ? (
                      <button type="button" onClick={() => void cancelActiveOrder(order, true)} disabled={cancellingOrderId === order.id}
                        className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-800 disabled:opacity-50">
                        {cancellingOrderId === order.id ? 'Retrait…' : 'Retirer de la caisse'}
                      </button>
                    ) : null;
                  })()}
                  {canManageCash && !showArchivedPayDunyaIntents && intent.status.toLowerCase() === 'order_cancelled_pending_manual_reconciliation' && (
                    <button type="button" onClick={() => void archivePayDunyaIntent(intent.id)} disabled={payDunyaActionId === intent.id}
                      className="min-h-11 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-700 disabled:opacity-50">
                      {payDunyaActionId === intent.id ? 'Archivage…' : 'Archiver du suivi'}
                    </button>
                  )}
                  {showArchivedPayDunyaIntents && Number(intent.archivedAt || 0) > 0 && (
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-600">Archivée · {intent.archiveReason}</span>
                  )}
                  {canManageCash && intent.canReconcile && (
                    <button type="button" onClick={() => void reconcilePayDunyaIntent(intent.id)} disabled={payDunyaActionId === intent.id}
                      className="min-h-11 rounded-lg bg-blue-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                      {payDunyaActionId === intent.id ? 'Vérification…' : 'Vérifier le statut'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {canCancelOrders && (
          <section id="pending-orders" className="rounded-2xl border border-amber-200 bg-white p-5 shadow-2xs">
            <div className="mb-3">
              <h2 className="text-sm font-black text-slate-900">4. Commandes actives · Annulation contrôlée</h2>
              <p className="mt-1 text-xs text-slate-500">Annulation logique avec motif, journal d’audit et restitution transactionnelle des stocks si nécessaire. Les commandes réglées ou avec un paiement PayDunya en cours sont protégées.</p>
            </div>
            {activeOrders.filter(order => Number(order.paidAmount || 0) === 0 && !['partial', 'paid'].includes(String(order.paymentStatus || '')) && !order.pendingPayDunyaIntentId).length === 0 ? (
              <p className="text-xs text-slate-500">Aucune commande active et non réglée à annuler.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeOrders.filter(order => Number(order.paidAmount || 0) === 0 && !['partial', 'paid'].includes(String(order.paymentStatus || '')) && !order.pendingPayDunyaIntentId).map(order => (
                  <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">{order.orderNumber || order.id} · {formatFCFA(order.totalAmount)}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{order.status === 'pending' ? 'En attente' : order.status === 'in_prep' ? 'En préparation' : 'Prête'} · {order.itemsCount} article(s) · {new Date(order.createdAt).toLocaleString('fr-FR')}</p>
                    </div>
                    <button type="button" onClick={() => void cancelActiveOrder(order)} disabled={cancellingOrderId === order.id}
                      className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-bold text-red-800 disabled:opacity-50">
                      {cancellingOrderId === order.id ? 'Annulation…' : 'Annuler la commande'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

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
                <span className="font-bold text-emerald-600 tnum">+{formatFCFA(Number(cashSession?.cashCollected ?? drawerState.cashSales))}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Sorties enregistrées:</span>
                <span className="font-bold text-rose-600 tnum">-{formatFCFA(otherCashOut)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Remboursements espèces:</span>
                <span className="font-bold text-rose-700 tnum">-{formatFCFA(cashRefunds)}</span>
              </div>
              <div className="flex justify-between py-2.5 bg-slate-50 px-3 rounded-xl border border-slate-200 mt-2">
                <span className="font-extrabold text-slate-900">Solde théorique du tiroir:</span>
                <span className="text-base font-black text-[#ff6500] tnum">
                  {formatFCFA(expectedCash)}
                </span>
              </div>
            </div>

            <div className="mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-2">
              <ShieldCheck size={16} className="text-amber-600 shrink-0" />
              <span>Solde théorique = fond d’ouverture + encaissements espèces − sorties enregistrées − remboursements espèces. Les remboursements sont désormais suivis séparément dans le journal de caisse.</span>
            </div>
          </div>

          {/* Payment Methods Breakdown */}
          <div className="rounded-2xl border border-[#dbe3ee] bg-white p-5 shadow-2xs lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-base font-extrabold text-[#101d2d]">Répartition par canal</h3><p className="mt-1 text-xs text-slate-600">Total des encaissements chargés : <strong>{formatFCFA(channelTotal)}</strong></p></div>
            </div>
            <div className="space-y-4">
              {[
                { label: 'Espèces', amount: channelSales.cash },
                { label: 'Wave', amount: channelSales.wave },
                { label: 'Orange Money', amount: channelSales.orangeMoney },
                { label: 'MTN Money', amount: channelSales.mtnMoney },
                { label: 'Autres canaux (Moov, Djamo, carte)', amount: channelSales.moovMoney + channelSales.other }
              ].map((item) => (
                <div key={item.label} className="grid grid-cols-[minmax(112px,150px)_minmax(50px,1fr)_auto] items-center gap-3">
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={item.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={channelTotal > 0 ? Math.round(item.amount / channelTotal * 100) : 0}>
                    <div className="h-full rounded-full bg-[#c2410c]" style={{ width: channelTotal > 0 ? (item.amount / channelTotal * 100) + '%' : '0%' }} />
                  </div>
                  <strong className="whitespace-nowrap text-xs tabular-nums text-[#101d2d]">{formatFCFA(item.amount)}</strong>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Les montants sont calculés à partir des encaissements actuellement chargés dans le journal (100 opérations au maximum).</p>
          </div>
        </div>

        {/* Transactions Audit Trail Table */}
        <div id="cash-payments" className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-[#101d2d] uppercase tracking-wider">
                Journal des Transactions Récentes
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Historique instantané des règlements enregistrés en caisse · 100 derniers au maximum
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les encaissements">
              {[
                { value: 'all', label: 'Tous' },
                { value: 'cash', label: 'Espèces' },
                { value: 'mobile', label: 'Mobile Money' }
              ].map((filter) => <button key={filter.value} type="button" aria-pressed={paymentFilter === filter.value} onClick={() => setPaymentFilter(filter.value as typeof paymentFilter)} className={`min-h-11 rounded-full border px-4 text-xs font-bold ${paymentFilter === filter.value ? 'border-[#101d2d] bg-[#101d2d] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{filter.label}</button>)}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Commande</th>
                  <th className="py-3 px-4">Heure</th>
                  <th className="py-3 px-4">Canal</th>
                  <th className="py-3 px-4 text-right">Montant</th>
                  <th className="py-3 px-4">Statut</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Aucun encaissement enregistré dans les 100 dernières opérations.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900">{tx.orderId}</td>
                      <td className="py-3 px-4 text-slate-500 tnum">
                        {new Date(tx.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}
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
                        {tx.mobileMoneyReference && (
                          <span className="mt-1 block text-[10px] font-medium text-slate-500">
                            Réf. {tx.mobileMoneyReference}
                            {tx.reclassifiedAt ? ' · corrigé ' + new Date(tx.reclassifiedAt).toLocaleString('fr-FR') : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-black text-[#ff6500] tnum">
                        <div>{formatFCFA(tx.paidAmount)}</div>
                        {tx.paymentStatus === 'partial' && (
                          <div className="text-[10px] font-semibold text-amber-700 mt-0.5">
                            Partiel · reste {formatFCFA(tx.remainingAmount || 0)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={tx.paymentStatus === 'partial' ? 'inline-flex min-h-7 items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-950' : 'inline-flex min-h-7 items-center rounded-full bg-[#dcfce7] px-3 py-1 text-[11px] font-bold text-[#14532d]'}>{tx.paymentStatus === 'partial' ? 'Partiel' : 'Payé'}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => onViewReceipt(tx)}
                            className="min-h-11 min-w-11 rounded-lg bg-slate-100 p-2 hover:bg-[#ff6500] hover:text-white text-slate-600 transition-colors"
                            title="Voir le reçu"
                          >
                            <Eye size={14} />
                          </button>
                          {(canManageCash || canReclassifyPayments) && tx.paymentMethod === 'especes' && (
                            <button
                              onClick={() => void reclassifyCashPayment(tx)}
                              disabled={paymentCorrectionId === tx.id}
                              className="min-h-11 rounded-lg bg-sky-50 px-3 py-2 text-[10px] font-bold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                              title="Corriger le mode de règlement après rapprochement Mobile Money"
                            >
                              {paymentCorrectionId === tx.id ? 'Correction…' : 'Corriger paiement'}
                            </button>
                          )}
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
                              className="min-h-11 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
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
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Les 100 derniers encaissements au maximum sont affichés.</p>
        </div>
      <section id="paydunya-settings" aria-label="Paramètres du compte PayDunya" className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-black text-slate-900">Paramètres PayDunya</h2>
        <PayDunyaAccountSettings restaurantSlug={restaurantSlug} isOwner={isOwner} />
      </section>
            </div>

            <div hidden={activeCashSection !== 'control'} aria-label="Contrôle de caisse" className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-base font-black text-[#101d2d]">3 · Contrôle</h2><p className="mt-1 text-xs text-slate-500">Écarts de comptage, clôtures journalières et rapports.</p></div>
                <button type="button" onClick={() => { sounds.playTap(); setShowZReportModal(true); }} className="min-h-11 rounded-xl bg-[#101d2d] px-4 py-2.5 text-xs font-bold text-white"><FileText size={15} className="mr-2 inline"/>Consulter le rapport</button>
              </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#dbe3ee] bg-white p-4"><p className="text-xs font-semibold text-slate-600">Écart session en cours</p><p className="mt-2 text-2xl font-extrabold text-[#101d2d]">{formatFCFA(closingCountInput === "" ? 0 : currentVariance)}</p></div>
          <div className="rounded-2xl border border-[#dbe3ee] bg-white p-4"><p className="text-xs font-semibold text-slate-600">Sessions clôturées (3 jours)</p><p className="mt-2 text-2xl font-extrabold text-[#101d2d]">{recentClosedSessions.length}</p></div>
          <div className="rounded-2xl border border-[#101d2d] bg-[#101d2d] p-4 text-white"><p className="text-xs font-semibold text-slate-200">Écarts à examiner</p><p className="mt-2 text-2xl font-extrabold">{recentVarianceCount + (cashSession && closingCountInput !== "" && currentVariance !== 0 ? 1 : 0)}</p></div>
        </div>
        <section aria-labelledby="cash-report-title" className="rounded-2xl border border-[#dbe3ee] bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h3 id="cash-report-title" className="text-base font-extrabold text-[#101d2d]">Rapport des encaissements</h3><p className="mt-1 text-xs text-slate-600">Export CSV des opérations chargées sur la période sélectionnée.</p></div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">Du<input type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm"/></label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">Au<input type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm"/></label>
              <button type="button" onClick={exportCollectionsCsv} className="min-h-11 rounded-lg bg-[#c2410c] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#9a3412]">Exporter en CSV</button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Le journal est limité aux 100 derniers encaissements chargés ; l’export respecte cette même limite.</p>
        </section>
        <section id="revenue-calendar" aria-labelledby="revenue-calendar-title" className="rounded-2xl border border-orange-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="revenue-calendar-title" className="text-base font-black text-slate-900">Calendrier des recettes journalières</h2>
              <p className="mt-1 text-xs text-slate-500">Consultez la recette nette à une date précise et clôturez chaque journée terminée.</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              Date
              <input aria-label="Date de consultation de la recette" type="date" max={new Date().toISOString().slice(0, 10)}
                value={selectedRevenueDate} onChange={event => setSelectedRevenueDate(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/>
            </label>
          </div>
          {dailyRevenueError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{dailyRevenueError}</p>}
          {dailyRevenueNotice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{dailyRevenueNotice}</p>}
          {dailyRevenueLoading ? <p className="mt-4 text-sm text-slate-500">Chargement de la recette…</p> : dailyRevenueReport ? <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Encaissements nets</p><p className="mt-1 text-xl font-black">{formatFCFA(dailyRevenueReport.grossCollected || 0)}</p></div>
              <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Commandes réglées</p><p className="mt-1 text-xl font-black">{dailyRevenueReport.paidOrderCount || 0}</p></div>
              <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Dépenses suivies</p><p className="mt-1 text-xl font-black">{formatFCFA(dailyRevenueReport.expenseTotal || 0)}</p></div>
              <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Résultat après dépenses</p><p className="mt-1 text-xl font-black">{formatFCFA(dailyRevenueReport.operatingResult || 0)}</p></div>
            </div>
            {dailyRevenueClosure ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">Journée clôturée · {dailyRevenueClosure.closedAt ? new Date(dailyRevenueClosure.closedAt).toLocaleString('fr-FR') : 'Clôture enregistrée'} · {dailyRevenueClosure.closedByName || 'Responsable'}</p>
              : selectedRevenueDate < new Date().toISOString().slice(0, 10) ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">Journée terminée, en attente de clôture officielle.</p><button type="button" onClick={() => void closeSelectedRevenueDay()} disabled={dailyRevenueClosing} className="min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{dailyRevenueClosing ? 'Clôture…' : 'Clôturer cette journée'}</button></div>
              : <p className="mt-3 text-xs text-slate-500">La clôture sera disponible après la fin de cette journée.</p>}
          </> : <p className="mt-4 text-sm text-slate-500">Aucune recette disponible pour cette date.</p>}
        </section>

        {/* Closed Cash Sessions History & Performance Comparison Component */}
        <ClosedCashSessionsHistory
          sessions={closedSessions}
          loading={closedSessionsLoading}
          onRefresh={loadClosedSessions}
        />
            </div>
          </main>
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
                className="min-h-11 min-w-11 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
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
                <span>Aperçu indicatif : les sessions, sorties de caisse et remboursements sont suivis. Ce document ne remplace pas la clôture officielle ni le rapprochement comptable.</span>
              </div>

              <div className="pt-2 flex items-center gap-2 font-sans">
                <button
                  onClick={() => {
                    sounds.playTap();
                    window.print();
                  }}
                  className="min-h-11 flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-colors"
                >
                  Imprimer l’aperçu
                </button>
                <button
                  onClick={() => setShowZReportModal(false)}
                  className="min-h-11 flex-1 py-2.5 bg-[#ff6500] hover:bg-[#e05800] text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
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
