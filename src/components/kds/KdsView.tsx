import React, { useState, useEffect } from 'react';
import { KitchenTicket, TicketStatus } from '../../types/pos';
import { sounds } from '../../utils/audio';
import { 
  Clock, 
  Flame, 
  ChefHat, 
  CheckCircle2, 
  AlertTriangle, 
  BellRing, 
  Filter,
  Check
} from 'lucide-react';

interface KdsViewProps {
  tickets: KitchenTicket[];
  onToggleItemComplete: (ticketId: string, itemId: string) => void;
  onUpdateTicketStatus: (ticketId: string, status: TicketStatus) => void;
}

export const KdsView: React.FC<KdsViewProps> = ({
  tickets,
  onToggleItemComplete,
  onUpdateTicketStatus
}) => {
  const [filterStation, setFilterStation] = useState<'all' | 'grillades' | 'plats' | 'bar'>('all');
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update timer every second to maintain exact real-time ticking
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeTickets = tickets.filter(t => t.status === 'in_prep' || t.status === 'ready');

  const getElapsedSeconds = (createdAt: Date) => {
    return Math.max(0, Math.floor((currentTime - new Date(createdAt).getTime()) / 1000));
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-60px)] overflow-hidden bg-[#101d2d] text-white">
      {/* KDS Header Bar */}
      <div className="bg-[#09121c] border-b border-slate-800 px-4 lg:px-8 py-3 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ff6500] flex items-center justify-center text-white">
              <ChefHat size={18} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
                Écran KDS Cuisine en Direct
              </h2>
              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                <span>{activeTickets.length} tickets en cours</span>
                <span>·</span>
                <span className="text-emerald-400 font-semibold">Toutes stations synchronisées</span>
              </div>
            </div>
          </div>

          {/* Action & Station Filters */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                sounds.playKitchenBell();
              }}
              className="px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-1.5 transition-colors border border-white/10"
              title="Tester la sonnette cuisine"
            >
              <BellRing size={14} className="text-amber-400" />
              Appel Runner
            </button>

            <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800">
              {[
                { id: 'all', label: 'Toutes Stations' },
                { id: 'grillades', label: 'Grillades' },
                { id: 'plats', label: 'Fourneaux' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    sounds.playTap();
                    setFilterStation(tab.id as typeof filterStation);
                  }}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                    filterStation === tab.id
                      ? 'bg-[#ff6500] text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tickets Scroll Container */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 lg:p-6">
        <div className="flex items-start gap-4 h-full min-w-max pb-2">
          {activeTickets.length === 0 ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-center text-slate-500 py-16">
              <CheckCircle2 size={48} className="text-emerald-500 mb-3" />
              <h3 className="text-lg font-bold text-white">Tous les plats sont expédiés !</h3>
              <p className="text-xs text-slate-400 mt-1">
                La cuisine est à jour. Les nouvelles commandes apparaîtront ici automatiquement.
              </p>
            </div>
          ) : (
            activeTickets.map((ticket) => {
              const elapsedSec = getElapsedSeconds(ticket.createdAt);
              const elapsedMinutes = Math.floor(elapsedSec / 60);

              // Color tier per design doc:
              // < 10 min: Neutral midnight border
              // >= 10 min: Amber warning (#F59E0B)
              // >= 20 min: Red urgent flashing (#EF4444)
              const isUrgent = elapsedMinutes >= 20;
              const isWarning = elapsedMinutes >= 10 && elapsedMinutes < 20;
              const allItemsDone = ticket.items.every(i => i.completed);

              return (
                <div
                  key={ticket.id}
                  className={`w-80 sm:w-88 rounded-2xl bg-white text-slate-900 shadow-xl flex flex-col overflow-hidden border-2 transition-all ${
                    isUrgent
                      ? 'border-red-500 ring-2 ring-red-500/50 animate-pulse'
                      : isWarning
                      ? 'border-amber-400'
                      : 'border-slate-300'
                  }`}
                >
                  {/* Ticket Header */}
                  <div
                    className={`p-3.5 text-white flex items-center justify-between ${
                      isUrgent
                        ? 'bg-red-600'
                        : isWarning
                        ? 'bg-amber-600'
                        : ticket.status === 'ready'
                        ? 'bg-emerald-700'
                        : 'bg-[#101d2d]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black tracking-tight">
                          {ticket.ticketNumber}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/30">
                          {ticket.tableNumber}
                        </span>
                      </div>
                      <div className="text-[11px] text-white/80 font-medium mt-0.5">
                        Serveur: {ticket.waiter} · {ticket.orderType === 'sur_place' ? 'Sur Place' : 'À Emporter'}
                      </div>
                    </div>

                    {/* Elapsed prep timer */}
                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-1.5 text-sm font-black tnum bg-black/40 px-2 py-1 rounded-md">
                        <Clock size={13} />
                        <span>{formatTimer(elapsedSec)}</span>
                      </div>
                      {isUrgent && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wider mt-1 text-red-200">
                          RETARD +20M
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ticket Items List */}
                  <div className="flex-1 overflow-y-auto p-3 divide-y divide-slate-100 max-h-[380px]">
                    {ticket.items.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          sounds.playTap();
                          onToggleItemComplete(ticket.id, item.id);
                        }}
                        className={`py-2.5 px-2 rounded-lg cursor-pointer transition-colors flex items-start gap-2.5 ${
                          item.completed
                            ? 'bg-slate-100 opacity-60'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 mt-0.5 rounded flex items-center justify-center shrink-0 border transition-colors ${
                            item.completed
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {item.completed && <Check size={13} strokeWidth={3} />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-black ${
                                item.completed ? 'line-through text-slate-500' : 'text-slate-900'
                              }`}
                            >
                              {item.quantity}x {item.name}
                            </span>
                          </div>

                          {item.notes && (
                            <div className="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 mt-1 inline-block">
                              ⚡ {item.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Ticket Footer Action Buttons */}
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
                    {ticket.status === 'ready' ? (
                      <button
                        onClick={() => {
                          sounds.playTap();
                          onUpdateTicketStatus(ticket.id, 'served');
                        }}
                        className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <CheckCircle2 size={16} />
                        <span>Marquer Servi & Retirer</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          sounds.playKitchenBell();
                          onUpdateTicketStatus(ticket.id, 'ready');
                        }}
                        className={`flex-1 h-11 text-xs font-extrabold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all text-white ${
                          allItemsDone
                            ? 'bg-emerald-600 hover:bg-emerald-700 animate-bounce'
                            : 'bg-[#ff6500] hover:bg-[#e05800]'
                        }`}
                      >
                        <ChefHat size={16} />
                        <span>Prêt pour le Service</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
