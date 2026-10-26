import React, { useState } from 'react';
import { Table, TableStatus } from '../../types/pos';
import { formatFCFA, formatTimeAgo } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  Users, 
  Clock, 
  Receipt, 
  ArrowRight, 
  Plus, 
  Check, 
  Armchair,
  Filter,
  Sparkles
} from 'lucide-react';

interface FloorViewProps {
  tables: Table[];
  onSelectTableForOrder: (table: Table) => void;
  onUpdateTableStatus: (tableId: string, status: TableStatus, covers?: number) => void;
  serverName: string;
}

export const FloorView: React.FC<FloorViewProps> = ({
  tables,
  onSelectTableForOrder,
  onUpdateTableStatus,
  serverName
}) => {
  const [selectedZone, setSelectedZone] = useState<'all' | 'salle' | 'terrasse' | 'bar'>('all');
  const [activeTableModal, setActiveTableModal] = useState<Table | null>(null);

  const filteredTables = tables.filter(
    (t) => selectedZone === 'all' || t.zone === selectedZone
  );

  const totalCapacity = tables.reduce((sum, t) => sum + t.capacity, 0);
  const occupiedCount = tables.filter((t) => t.status === 'occupied' || t.status === 'billing').length;
  const availableCount = tables.filter((t) => t.status === 'available').length;
  const billingCount = tables.filter((t) => t.status === 'billing').length;

  const getStatusBadge = (status: TableStatus) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Libre
          </span>
        );
      case 'occupied':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-orange-50 text-orange-700 border border-orange-200">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff6500]" />
            Occupée
          </span>
        );
      case 'billing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Addition demandée
          </span>
        );
      case 'reserved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Réservée
          </span>
        );
    }
  };

  const handleTableClick = (table: Table) => {
    sounds.playTap();
    setActiveTableModal(table);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-60px)] overflow-hidden bg-[#f4f7fb]">
      {/* Floor Waiter Dedicated Subbar */}
      <div className="bg-white border-b border-slate-200/80 px-4 lg:px-8 py-3 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Active Server Info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#101d2d] text-white flex items-center justify-center font-bold text-xs">
                MD
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900 leading-none">
                  Serveur: {serverName}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
                  <Clock size={11} />
                  Service en cours · 3h 42m
                </div>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200 hidden sm:block" />

            {/* Live Occupancy Indicators */}
            <div className="flex items-center gap-3 text-xs font-semibold">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-600">Libres:</span>
                <span className="font-bold text-slate-900 tnum">{availableCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff6500]" />
                <span className="text-slate-600">Occupées:</span>
                <span className="font-bold text-slate-900 tnum">{occupiedCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-slate-600">Additions:</span>
                <span className="font-bold text-slate-900 tnum">{billingCount}</span>
              </div>
            </div>
          </div>

          {/* Zone Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {[
              { id: 'all', label: 'Toutes les Zones' },
              { id: 'salle', label: 'Salle Principale' },
              { id: 'terrasse', label: 'Terrasse VIP' },
              { id: 'bar', label: 'Bar & Lounge' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  sounds.playTap();
                  setSelectedZone(tab.id as typeof selectedZone);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-all ${
                  selectedZone === tab.id
                    ? 'bg-[#101d2d] text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Floor Grid Layout */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredTables.map((table) => {
              const isOccupied = table.status === 'occupied';
              const isBilling = table.status === 'billing';

              return (
                <div
                  key={table.id}
                  onClick={() => handleTableClick(table)}
                  role="button"
                  tabIndex={0}
                  className={`relative p-5 rounded-2xl bg-white border transition-all cursor-pointer select-none text-left flex flex-col justify-between hover:shadow-md active:scale-[0.99] ${
                    isOccupied
                      ? 'border-orange-300 shadow-2xs hover:border-[#ff6500]'
                      : isBilling
                      ? 'border-amber-300 shadow-2xs hover:border-amber-500'
                      : 'border-slate-200 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  <div>
                    {/* Header: Table Number & Status Pill */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="text-xl font-extrabold text-[#101d2d] tracking-tight">
                          {table.name}
                        </div>
                        <div className="text-xs text-slate-500 font-medium capitalize mt-0.5">
                          Zone {table.zone} · {table.capacity} couverts
                        </div>
                      </div>

                      {getStatusBadge(table.status)}
                    </div>

                    {/* Table Details */}
                    {table.status !== 'available' && table.status !== 'reserved' && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs">
                        {table.currentTotal !== undefined && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-slate-500 font-medium">Addition en cours:</span>
                            <span className="text-sm font-black text-[#ff6500] tnum">
                              {formatFCFA(table.currentTotal)}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between items-center text-slate-600">
                          <span className="flex items-center gap-1 font-medium">
                            <Users size={12} className="text-slate-400" />
                            Couverts servis:
                          </span>
                          <span className="font-bold text-slate-900 tnum">
                            {table.covers || 2} pers.
                          </span>
                        </div>

                        {table.seatedAt && (
                          <div className="flex justify-between items-center text-slate-600">
                            <span className="flex items-center gap-1 font-medium">
                              <Clock size={12} className="text-slate-400" />
                              Installés depuis:
                            </span>
                            <span className="font-bold text-slate-900 tnum">
                              {formatTimeAgo(table.seatedAt)}
                            </span>
                          </div>
                        )}

                        {table.assignedWaiter && (
                          <div className="text-[11px] text-slate-500 font-medium pt-1">
                            Responsable: <span className="font-bold text-slate-800">{table.assignedWaiter}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {table.status === 'available' && (
                      <div className="py-6 flex flex-col items-center justify-center text-center text-slate-400">
                        <Armchair size={28} strokeWidth={1.5} className="mb-2 text-slate-300" />
                        <span className="text-xs font-semibold text-slate-500">
                          Table prête pour accueil
                        </span>
                      </div>
                    )}

                    {table.status === 'reserved' && (
                      <div className="py-6 flex flex-col items-center justify-center text-center text-slate-400">
                        <Clock size={28} strokeWidth={1.5} className="mb-2 text-slate-300" />
                        <span className="text-xs font-semibold text-slate-500">
                          Réservation prévue à 20h00
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Touch Quick Action */}
                  <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-[#ff6500]">
                    <span>Gérer la table</span>
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Table Interaction Sheet / Modal */}
      {activeTableModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="bg-[#101d2d] text-white p-5 flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Fiche de Table
                </span>
                <h3 className="text-xl font-extrabold mt-0.5">{activeTableModal.name}</h3>
                <p className="text-xs text-slate-300 mt-1">
                  Zone {activeTableModal.zone} · Capacité: {activeTableModal.capacity} personnes
                </p>
              </div>
              <button
                onClick={() => setActiveTableModal(null)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Current Status Banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Statut actuel:</span>
                {getStatusBadge(activeTableModal.status)}
              </div>

              {activeTableModal.currentTotal && (
                <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-orange-800 uppercase block">
                      Total Addition
                    </span>
                    <span className="text-xl font-black text-orange-950 tnum">
                      {formatFCFA(activeTableModal.currentTotal)}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-orange-700">
                    {activeTableModal.covers || 2} couverts
                  </span>
                </div>
              )}

              {/* Status Modification Buttons */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                  Changer le statut
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      sounds.playTap();
                      onUpdateTableStatus(activeTableModal.id, 'available');
                      setActiveTableModal(null);
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      activeTableModal.status === 'available'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white hover:bg-emerald-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Libérer (Disponible)
                  </button>

                  <button
                    onClick={() => {
                      sounds.playTap();
                      onUpdateTableStatus(activeTableModal.id, 'occupied', 4);
                      setActiveTableModal(null);
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      activeTableModal.status === 'occupied'
                        ? 'bg-[#ff6500] text-white border-[#ff6500]'
                        : 'bg-white hover:bg-orange-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Installer Clients
                  </button>

                  <button
                    onClick={() => {
                      sounds.playTap();
                      onUpdateTableStatus(activeTableModal.id, 'billing');
                      setActiveTableModal(null);
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      activeTableModal.status === 'billing'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white hover:bg-amber-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    Demander l'Addition
                  </button>

                  <button
                    onClick={() => {
                      sounds.playTap();
                      onUpdateTableStatus(activeTableModal.id, 'reserved');
                      setActiveTableModal(null);
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      activeTableModal.status === 'reserved'
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    Réserver
                  </button>
                </div>
              </div>

              {/* Primary Take Order CTA */}
              <div className="pt-2">
                <button
                  onClick={() => {
                    sounds.playTap();
                    onSelectTableForOrder(activeTableModal);
                    setActiveTableModal(null);
                  }}
                  className="w-full h-12 bg-[#ff6500] hover:bg-[#e05800] text-white font-extrabold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  <span>Prendre la Commande au POS</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
