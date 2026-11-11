import React, { useMemo, useState } from 'react';
import { 
  Calendar, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight, 
  DollarSign, 
  Clock, 
  User, 
  ChevronDown, 
  ChevronUp, 
  Award, 
  SlidersHorizontal,
  Wallet
} from 'lucide-react';
import { formatFCFA } from '../../utils/format';
import type { CashSessionApiRecord } from '../../lib/firebase';

interface ClosedCashSessionsHistoryProps {
  sessions: CashSessionApiRecord[];
  loading?: boolean;
  onRefresh?: () => void | Promise<void>;
}

export const ClosedCashSessionsHistory: React.FC<ClosedCashSessionsHistoryProps> = ({
  sessions = [],
  loading = false,
  onRefresh
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'variance' | 'balanced'>('all');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      const variance = Number(session.variance || 0);
      if (filterMode === 'variance') return Math.abs(variance) > 0;
      if (filterMode === 'balanced') return variance === 0;
      return true;
    });
  }, [sessions, filterMode]);

  // Aggregate Performance Metrics for cross-day comparison
  const metrics = useMemo(() => {
    if (sessions.length === 0) {
      return {
        totalRevenue: 0,
        averageRevenue: 0,
        totalPayments: 0,
        averageTicket: 0,
        maxRevenue: 0,
        bestSession: null as CashSessionApiRecord | null,
        balancedCount: 0,
        balancedRate: 100,
        totalCashOut: 0
      };
    }

    let totalRevenue = 0;
    let totalPayments = 0;
    let maxRevenue = 0;
    let bestSession: CashSessionApiRecord | null = null;
    let balancedCount = 0;
    let totalCashOut = 0;

    sessions.forEach(session => {
      const rev = Number(session.cashCollected || 0);
      const count = Number(session.paymentCount || 0);
      const variance = Number(session.variance || 0);
      const out = Number(session.cashOut || 0);

      totalRevenue += rev;
      totalPayments += count;
      totalCashOut += out;

      if (variance === 0) {
        balancedCount += 1;
      }

      if (rev > maxRevenue) {
        maxRevenue = rev;
        bestSession = session;
      }
    });

    const averageRevenue = Math.round(totalRevenue / sessions.length);
    const averageTicket = totalPayments > 0 ? Math.round(totalRevenue / totalPayments) : 0;
    const balancedRate = Math.round((balancedCount / sessions.length) * 100);

    return {
      totalRevenue,
      averageRevenue,
      totalPayments,
      averageTicket,
      maxRevenue,
      bestSession,
      balancedCount,
      balancedRate,
      totalCashOut
    };
  }, [sessions]);

  const formatDateRange = (openedAt?: number, closedAt?: number) => {
    if (!openedAt) return { date: 'Date inconnue', time: '—' };
    const dOpen = new Date(openedAt);
    const dateStr = dOpen.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
    const timeOpen = dOpen.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const timeClose = closedAt ? new Date(closedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
    return {
      date: dateStr,
      time: `${timeOpen} → ${timeClose}`
    };
  };

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff6500]/10 text-[#ff6500]">
              <Calendar size={16} />
            </span>
            <h2 className="text-base font-black text-[#101d2d]">
              Sessions clôturées (Z)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Historique des clôtures, montants théoriques, comptages physiques et écarts à examiner.
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={() => void onRefresh()}
            disabled={loading}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#ff6500]' : ''} />
            <span>Actualiser</span>
          </button>
        )}
      </div>

      {/* Cross-day Comparison Performance KPI Cards */}
      {sessions.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-semibold">Total recettes (clôturées)</span>
              <DollarSign size={14} className="text-emerald-600" />
            </div>
            <p className="mt-1 text-base font-black text-slate-900">{formatFCFA(metrics.totalRevenue)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{sessions.length} session(s) enregistrée(s)</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-semibold">Moyenne par session</span>
              <TrendingUp size={14} className="text-[#ff6500]" />
            </div>
            <p className="mt-1 text-base font-black text-slate-900">{formatFCFA(metrics.averageRevenue)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Panier moy. {formatFCFA(metrics.averageTicket)}</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-semibold">Session record</span>
              <Award size={14} className="text-amber-500" />
            </div>
            <p className="mt-1 text-base font-black text-slate-900">{formatFCFA(metrics.maxRevenue)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">
              {metrics.bestSession?.openedAt 
                ? new Date(metrics.bestSession.openedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) 
                : '—'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-semibold">Conformité caisse</span>
              <CheckCircle2 size={14} className="text-emerald-600" />
            </div>
            <p className="mt-1 text-base font-black text-slate-900">{metrics.balancedRate}%</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{metrics.balancedCount}/{sessions.length} sans écart</p>
          </div>
        </div>
      )}

      {/* Visual Bar Comparison Track */}
      {sessions.length > 1 && metrics.maxRevenue > 0 && (
        <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Comparatif d’activité journalière (% du pic)
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">Échelle relative</span>
          </div>
          <div className="space-y-2">
            {sessions.slice(0, 7).map((s) => {
              const rev = Number(s.cashCollected || 0);
              const percentage = Math.max(8, Math.min(100, Math.round((rev / metrics.maxRevenue) * 100)));
              const { date } = formatDateRange(s.openedAt, s.closedAt);
              const isBest = s.id === metrics.bestSession?.id;
              const variance = Number(s.variance || 0);

              return (
                <div key={`bar-${s.id}`} className="flex items-center gap-3 text-xs">
                  <div className="w-20 shrink-0 font-medium text-slate-600 truncate">{date}</div>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-slate-200/60">
                    <div
                      className={`h-full rounded-md transition-all duration-500 ${
                        isBest 
                          ? 'bg-[#c2410c]' 
                          : variance !== 0 
                            ? 'bg-slate-600' 
                            : 'bg-emerald-700'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-black text-white drop-shadow-sm">
                      {formatFCFA(rev)}
                    </span>
                  </div>
                  <div className="w-16 shrink-0 text-right text-[11px] font-bold text-slate-500">
                    {s.paymentCount} vte(s)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600">
          <button
            onClick={() => setFilterMode('all')}
            className={`min-h-11 rounded-lg px-3 py-2 transition-all ${
              filterMode === 'all' ? 'bg-white font-bold text-slate-900 shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Toutes ({sessions.length})
          </button>
          <button
            onClick={() => setFilterMode('balanced')}
            className={`rounded-lg px-3 py-1.5 transition-all ${
              filterMode === 'balanced' ? 'bg-white font-bold text-emerald-700 shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Sans écart ({metrics.balancedCount})
          </button>
          <button
            onClick={() => setFilterMode('variance')}
            className={`rounded-lg px-3 py-1.5 transition-all ${
              filterMode === 'variance' ? 'bg-white font-bold text-amber-700 shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Avec écart ({sessions.length - metrics.balancedCount})
          </button>
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <SlidersHorizontal size={12} />
          {filteredSessions.length} session(s) affichée(s)
        </span>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-[#dbe3ee] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-600"><tr>
              <th className="px-4 py-3">Date</th><th className="px-4 py-3">Ouverture – clôture</th><th className="px-4 py-3 text-right">Théorique (FCFA)</th><th className="px-4 py-3 text-right">Compté (FCFA)</th><th className="px-4 py-3 text-right">Écart (FCFA)</th><th className="px-4 py-3">Statut</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSessions.map((session) => {
                const variance = Number(session.variance || 0);
                return <tr key={"z-" + session.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">{new Date(session.openedAt).toLocaleDateString("fr-FR")}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(session.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} – {session.closedAt ? new Date(session.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatFCFA(Number(session.expectedCash || 0))}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatFCFA(Number(session.closingCount || 0))}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">{formatFCFA(variance)}</td>
                  <td className="px-4 py-3">{variance === 0 ? <span className="inline-flex min-h-7 items-center rounded-full bg-[#dcfce7] px-3 py-1 text-[11px] font-bold text-[#14532d]">Conforme</span> : <span className="inline-flex min-h-7 items-center rounded-full bg-[#fef3c7] px-3 py-1 text-[11px] font-bold text-[#78350f]">Écart à examiner</span>}</td>
                </tr>;
              })}
              {filteredSessions.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Aucune session clôturée sur cette sélection.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <h3 className="mt-5 text-sm font-extrabold text-[#101d2d]">Détails et comparaison des sessions</h3>
      {/* Sessions List */}
      <div className="mt-4 space-y-3">
        {loading && sessions.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-[#ff6500]" />
            Chargement de l'historique des sessions…
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
            <Wallet size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-bold text-slate-700">Aucune session clôturée trouvée</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {filterMode === 'all'
                ? "Dès qu'une session de caisse sera fermée et rapprochée, son bilan détaillé apparaîtra ici."
                : "Aucune session ne correspond à ce filtre."}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            const variance = Number(session.variance || 0);
            const { date, time } = formatDateRange(session.openedAt, session.closedAt);
            const isRecord = session.id === metrics.bestSession?.id && metrics.maxRevenue > 0;

            return (
              <div
                key={session.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:border-slate-300"
              >
                {/* Main Card Header Bar */}
                <div
                  onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 select-none hover:bg-slate-50/70"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <Clock size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{date}</span>
                        <span className="text-[11px] text-slate-400">({time})</span>
                        {isRecord && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                            <Award size={10} /> Record
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <User size={11} /> {session.openedByName || 'Personnel'}
                        </span>
                        <span>•</span>
                        <span>{session.paymentCount} encaissement(s)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Financial Summary */}
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">
                        {formatFCFA(Number(session.cashCollected || 0))}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Fond initial : {formatFCFA(Number(session.openingBalance || 0))}
                      </div>
                    </div>

                    {/* Variance Badge */}
                    <div className="min-w-[110px] text-right">
                      {variance === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 size={12} />
                          Conforme
                        </span>
                      ) : variance > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                          <ArrowUpRight size={12} />
                          +{formatFCFA(variance)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                          <ArrowDownRight size={12} />
                          {formatFCFA(variance)}
                        </span>
                      )}
                    </div>

                    <button
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={isExpanded ? 'Réduire' : 'Développer'}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                      <div className="rounded-lg bg-white p-3 border border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Espèces théoriques</span>
                        <p className="mt-1 font-bold text-slate-800">
                          {formatFCFA(Number(session.expectedCash || 0))}
                        </p>
                        <p className="text-[10px] text-slate-400">Fond + Encaissé - Sorties</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Comptage physique</span>
                        <p className="mt-1 font-bold text-slate-800">
                          {formatFCFA(Number(session.closingCount || 0))}
                        </p>
                        <p className="text-[10px] text-slate-400">Montant déclaré en clôture</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Sorties & Dépenses</span>
                        <p className="mt-1 font-bold text-slate-800">
                          {formatFCFA(Number(session.cashOut || 0))}
                        </p>
                        <p className="text-[10px] text-slate-400">{session.cashMovementCount || 0} mouvement(s)</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Panier moyen session</span>
                        <p className="mt-1 font-bold text-slate-800">
                          {session.paymentCount && session.paymentCount > 0 
                            ? formatFCFA(Math.round(Number(session.cashCollected || 0) / session.paymentCount))
                            : '—'}
                        </p>
                        <p className="text-[10px] text-slate-400">Par encaissement</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                      <div>
                        Clôturé par : <span className="font-bold text-slate-700">{session.closedByName || session.openedByName || 'Gérant'}</span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        Réf session : {session.id}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
