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
  Check,
  Keyboard,
  Info
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
  const [selectedTicketIndex, setSelectedTicketIndex] = useState<number>(0);
  const [lastBumpedMsg, setLastBumpedMsg] = useState<string | null>(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState<boolean>(true);
  const ticketsContainerRef = React.useRef<HTMLDivElement>(null);

  // Update timer every second to maintain exact real-time ticking
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeTickets = tickets.filter(t => t.status === 'in_prep' || t.status === 'ready');

  // Keep selectedTicketIndex within valid bounds
  useEffect(() => {
    if (activeTickets.length > 0 && selectedTicketIndex >= activeTickets.length) {
      setSelectedTicketIndex(activeTickets.length - 1);
    }
  }, [activeTickets.length, selectedTicketIndex]);

  // Scroll focused ticket into view
  const scrollToTicket = (index: number) => {
    if (ticketsContainerRef.current) {
      const ticketElements = ticketsContainerRef.current.querySelectorAll<HTMLElement>('[data-kds-ticket]');
      if (ticketElements[index]) {
        ticketElements[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  };

  const handleBumpTicket = (ticket: KitchenTicket, slotNumber?: number) => {
    if (ticket.status === 'ready') {
      sounds.playTap();
      onUpdateTicketStatus(ticket.id, 'served');
      setLastBumpedMsg(`Ticket ${ticket.ticketNumber} archivé / servi ${slotNumber ? `[Touche ${slotNumber}]` : ''}`);
    } else {
      sounds.playKitchenBell();
      onUpdateTicketStatus(ticket.id, 'ready');
      setLastBumpedMsg(`Ticket ${ticket.ticketNumber} prêt pour expédition ${slotNumber ? `[Touche ${slotNumber}]` : ''}`);
    }

    // Clear feedback message after 3 seconds
    setTimeout(() => {
      setLastBumpedMsg(prev => (prev?.includes(ticket.ticketNumber) ? null : prev));
    }, 3000);
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select') {
        return;
      }

      // Number keys 1-9 (both regular top row and numpad)
      const numMatch = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
      if (numMatch) {
        e.preventDefault();
        const slot = parseInt(numMatch[1], 10);
        const targetIndex = slot - 1;
        if (targetIndex >= 0 && targetIndex < activeTickets.length) {
          const targetTicket = activeTickets[targetIndex];
          setSelectedTicketIndex(targetIndex);
          scrollToTicket(targetIndex);
          handleBumpTicket(targetTicket, slot);
        }
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'Tab' && !e.shiftKey) {
        if (activeTickets.length > 0) {
          e.preventDefault();
          const nextIndex = (selectedTicketIndex + 1) % activeTickets.length;
          setSelectedTicketIndex(nextIndex);
          scrollToTicket(nextIndex);
          sounds.playTap();
        }
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'h' || e.key === 'Tab' && e.shiftKey) {
        if (activeTickets.length > 0) {
          e.preventDefault();
          const prevIndex = (selectedTicketIndex - 1 + activeTickets.length) % activeTickets.length;
          setSelectedTicketIndex(prevIndex);
          scrollToTicket(prevIndex);
          sounds.playTap();
        }
        return;
      }

      // Space or Enter to bump currently selected ticket
      if (e.key === 'Enter' || e.key === ' ') {
        if (activeTickets.length > 0 && selectedTicketIndex < activeTickets.length) {
          e.preventDefault();
          const currentTicket = activeTickets[selectedTicketIndex];
          handleBumpTicket(currentTicket, selectedTicketIndex + 1);
        }
        return;
      }

      // Key 'r' or 'b' for Runner Bell
      if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'b') {
        e.preventDefault();
        sounds.playKitchenBell();
        setLastBumpedMsg('Appel Runner sonné !');
        setTimeout(() => setLastBumpedMsg(null), 2500);
        return;
      }

      // Key '?' to toggle shortcuts help
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTickets, selectedTicketIndex]);

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
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
                  Écran KDS Cuisine en Direct
                </h2>
                <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  <Keyboard size={11} />
                  Bump Bar Activé
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                <span>{activeTickets.length} tickets en cours</span>
                <span>·</span>
                <span className="text-emerald-400 font-semibold">Touches 1–9 pour bumper</span>
              </div>
            </div>
          </div>

          {/* Action & Station Filters */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowShortcutsHelp(prev => !prev);
              }}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors border ${
                showShortcutsHelp
                  ? 'bg-white/20 text-white border-white/30'
                  : 'bg-white/10 hover:bg-white/15 text-slate-300 border-white/10'
              }`}
              title="Afficher/Masquer les raccourcis clavier (?)"
            >
              <Keyboard size={14} className="text-amber-400" />
              <span className="hidden sm:inline">Raccourcis</span>
            </button>

            <button
              onClick={() => {
                sounds.playKitchenBell();
                setLastBumpedMsg('Appel Runner sonné !');
                setTimeout(() => setLastBumpedMsg(null), 2500);
              }}
              className="px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 text-white rounded-lg flex items-center gap-1.5 transition-colors border border-white/10"
              title="Tester la sonnette cuisine (Touche R)"
            >
              <BellRing size={14} className="text-amber-400" />
              <span>Appel Runner</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.2 bg-black/40 rounded text-[10px] font-mono text-amber-300">R</kbd>
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

      {/* Keyboard Shortcuts Guidance Bar */}
      {showShortcutsHelp && (
        <div className="bg-[#0b1726] border-b border-slate-800/80 px-4 lg:px-8 py-2 text-xs shrink-0 transition-all">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-slate-300">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black shadow-xs">1</kbd>
                <span className="text-slate-400">à</span>
                <kbd className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black shadow-xs">9</kbd>
                <span className="text-slate-200 font-sans font-medium">Bumper direct le ticket</span>
              </div>

              <div className="hidden sm:flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-white font-bold border border-slate-600">←</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-white font-bold border border-slate-600">→</kbd>
                <span className="text-slate-200 font-sans font-medium">Naviguer</span>
              </div>

              <div className="hidden md:flex items-center gap-1.5">
                <kbd className="px-2 py-0.5 rounded bg-slate-700 text-white font-bold border border-slate-600">Espace</kbd>
                <span className="text-slate-400">/</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-700 text-white font-bold border border-slate-600">Entrée</kbd>
                <span className="text-slate-200 font-sans font-medium">Valider sélection</span>
              </div>

              <div className="hidden lg:flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-white font-bold border border-slate-600">R</kbd>
                <span className="text-slate-200 font-sans font-medium">Cloche Runner</span>
              </div>
            </div>

            {activeTickets.length > 0 && selectedTicketIndex < activeTickets.length && (
              <div className="text-[11px] font-sans flex items-center gap-1.5 text-slate-400">
                <span>Focus actif:</span>
                <span className="font-bold text-amber-300 font-mono">
                  Ticket {activeTickets[selectedTicketIndex]?.ticketNumber} (Slot #{selectedTicketIndex + 1})
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Instant Feedback Toast */}
      {lastBumpedMsg && (
        <div className="absolute top-28 right-6 z-50 bg-[#ff6500] text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-2xl border border-orange-400 flex items-center gap-2 animate-in slide-in-from-top-4 duration-150">
          <Check size={16} strokeWidth={3} />
          <span>{lastBumpedMsg}</span>
        </div>
      )}

      {/* Tickets Scroll Container */}
      <div 
        ref={ticketsContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden p-4 lg:p-6"
      >
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
            activeTickets.map((ticket, index) => {
              const elapsedSec = getElapsedSeconds(ticket.createdAt);
              const elapsedMinutes = Math.floor(elapsedSec / 60);
              const slotNumber = index + 1;
              const isSelected = selectedTicketIndex === index;

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
                  data-kds-ticket={ticket.id}
                  onClick={() => {
                    sounds.playTap();
                    setSelectedTicketIndex(index);
                  }}
                  className={`w-80 sm:w-88 rounded-2xl bg-white text-slate-900 shadow-xl flex flex-col overflow-hidden border-2 transition-all cursor-pointer relative ${
                    isSelected
                      ? 'ring-4 ring-[#ff6500] border-transparent shadow-2xl scale-[1.01] z-10'
                      : isUrgent
                      ? 'border-red-500 ring-2 ring-red-500/50 animate-pulse'
                      : isWarning
                      ? 'border-amber-400'
                      : 'border-slate-300'
                  }`}
                >
                  {/* Selection Top Badge */}
                  {isSelected && (
                    <div className="bg-[#ff6500] text-white text-[10px] font-black uppercase tracking-wider py-0.5 text-center flex items-center justify-center gap-1">
                      <span>Selection active · Appuyez sur Espace pour bumper</span>
                    </div>
                  )}

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
                        {/* Keyboard Slot Badge */}
                        {slotNumber <= 9 ? (
                          <span 
                            title={`Appuyez sur ${slotNumber} pour bumper directement ce ticket`}
                            className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-black text-xs font-mono shadow-xs"
                          >
                            KEY {slotNumber}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-bold text-[10px] font-mono">
                            #{slotNumber}
                          </span>
                        )}

                        <span className="text-base font-black tracking-tight">
                          {ticket.ticketNumber}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/30">
                          {ticket.tableNumber}
                        </span>
                      </div>
                      <div className="text-[11px] text-white/80 font-medium mt-1">
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
                        onClick={(e) => {
                          e.stopPropagation();
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

                  {/* Ticket Footer Action Buttons with Key Bump Indicators */}
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
                    {ticket.status === 'ready' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBumpTicket(ticket, slotNumber);
                        }}
                        className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors"
                      >
                        <kbd className="px-2 py-0.5 rounded bg-black/25 text-white font-mono text-[11px] font-black">
                          {slotNumber <= 9 ? slotNumber : '↵'}
                        </kbd>
                        <CheckCircle2 size={16} />
                        <span>Marquer Servi & Retirer</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBumpTicket(ticket, slotNumber);
                        }}
                        className={`flex-1 h-12 text-xs font-extrabold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all text-white ${
                          allItemsDone
                            ? 'bg-emerald-600 hover:bg-emerald-700 animate-bounce'
                            : 'bg-[#ff6500] hover:bg-[#e05800]'
                        }`}
                      >
                        <kbd className="px-2 py-0.5 rounded bg-black/25 text-white font-mono text-[11px] font-black">
                          {slotNumber <= 9 ? slotNumber : '↵'}
                        </kbd>
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
