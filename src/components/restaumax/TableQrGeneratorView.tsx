import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { RestaurantInfo, RestaurantTable } from '../../types/restaumax';
import { generateTableQrUrl } from '../../utils/pricing';
import { sounds } from '../../utils/audio';
import { 
  ArrowLeft, 
  QrCode, 
  Download, 
  Printer, 
  Plus, 
  Trash2, 
  RefreshCw, 
  MapPin, 
  Sparkles, 
  Check, 
  Layers, 
  ExternalLink,
  ShieldCheck,
  Smartphone,
  Eye
} from 'lucide-react';

interface TableQrGeneratorViewProps {
  restaurant: RestaurantInfo;
  tables: RestaurantTable[];
  onSaveTable: (table: RestaurantTable) => void;
  onDeleteTable: (tableId: string) => void;
  onBackToHub: () => void;
}

const DEFAULT_SAMPLE_TABLES: RestaurantTable[] = [
  { id: 'tbl-1', tableNumber: '1', section: 'salle', capacity: 2, isActive: true },
  { id: 'tbl-2', tableNumber: '2', section: 'salle', capacity: 4, isActive: true },
  { id: 'tbl-3', tableNumber: '3', section: 'salle', capacity: 4, isActive: true },
  { id: 'tbl-4', tableNumber: '4', section: 'salle', capacity: 6, isActive: true },
  { id: 'tbl-5', tableNumber: '5', section: 'salle', capacity: 4, isActive: true },
  { id: 'tbl-6', tableNumber: '6', section: 'terrasse', capacity: 4, isActive: true },
  { id: 'tbl-7', tableNumber: '7', section: 'terrasse', capacity: 6, isActive: true },
  { id: 'tbl-8', tableNumber: '8', section: 'terrasse', capacity: 2, isActive: true },
  { id: 'tbl-bar-1', tableNumber: 'Bar 01', section: 'bar', capacity: 2, isActive: true },
  { id: 'tbl-vip-1', tableNumber: 'Salon VIP', section: 'vip', capacity: 8, isActive: true }
];

export const TableQrGeneratorView: React.FC<TableQrGeneratorViewProps> = ({
  restaurant,
  tables: initialTables,
  onSaveTable,
  onDeleteTable,
  onBackToHub
}) => {
  const [tableList, setTableList] = useState<RestaurantTable[]>(() => {
    return initialTables && initialTables.length > 0 ? initialTables : DEFAULT_SAMPLE_TABLES;
  });

  const [selectedTableId, setSelectedTableId] = useState<string>(() => {
    return (initialTables && initialTables[0]?.id) || 'tbl-4';
  });

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrSvgString, setQrSvgString] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // New table modal form state
  const [isNewTableModalOpen, setIsNewTableModalOpen] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableSection, setNewTableSection] = useState<'salle' | 'terrasse' | 'bar' | 'vip'>('salle');
  const [newTableCapacity, setNewTableCapacity] = useState(4);
  const [formError, setFormError] = useState<string | null>(null);

  // Sync when prop tables update
  useEffect(() => {
    if (initialTables && initialTables.length > 0) {
      setTableList(initialTables);
      if (!initialTables.some(t => t.id === selectedTableId)) {
        setSelectedTableId(initialTables[0].id);
      }
    }
  }, [initialTables]);

  const currentTable = tableList.find(t => t.id === selectedTableId) || tableList[0] || DEFAULT_SAMPLE_TABLES[0];

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://restaumax.app';
  const canonicalUrl = currentTable 
    ? generateTableQrUrl(appOrigin, restaurant.slug, currentTable.tableNumber)
    : `${appOrigin}/r/${restaurant.slug}`;

  // Generate QR Code as DataURL and SVG String
  useEffect(() => {
    if (!currentTable) return;

    let isMounted = true;
    setIsGenerating(true);

    const generateQrs = async () => {
      try {
        const urlToEncode = generateTableQrUrl(appOrigin, restaurant.slug, currentTable.tableNumber);

        // 1. High-resolution PNG Data URL for display & download
        const dataUrl = await QRCode.toDataURL(urlToEncode, {
          width: 600,
          margin: 1,
          color: {
            dark: '#0c2e22', // Forest green dark tone
            light: '#ffffff'
          },
          errorCorrectionLevel: 'H'
        });

        // 2. Crisp vector SVG
        const svgStr = await QRCode.toString(urlToEncode, {
          type: 'svg',
          margin: 1,
          color: {
            dark: '#0c2e22',
            light: '#ffffff'
          },
          errorCorrectionLevel: 'H'
        });

        if (isMounted) {
          setQrDataUrl(dataUrl);
          setQrSvgString(svgStr);
          setIsGenerating(false);
        }
      } catch (err) {
        console.error('Erreur génération QR Code:', err);
        if (isMounted) setIsGenerating(false);
      }
    };

    generateQrs();

    return () => {
      isMounted = false;
    };
  }, [currentTable?.tableNumber, restaurant.slug, appOrigin]);

  // Download QR Code as PNG
  const handleDownloadPng = () => {
    if (!qrDataUrl || !currentTable) return;
    sounds.playTap();
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `QR-${restaurant.slug}-table-${currentTable.tableNumber.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download QR Code as SVG
  const handleDownloadSvg = () => {
    if (!qrSvgString || !currentTable) return;
    sounds.playTap();
    const blob = new Blob([qrSvgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `QR-${restaurant.slug}-table-${currentTable.tableNumber.replace(/\s+/g, '_')}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Print Chevalet Tent Card
  const handlePrintTent = () => {
    sounds.playTap();
    window.print();
  };

  // Handle Add Table
  const handleCreateNewTable = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNumber = newTableNumber.trim();
    if (!cleanNumber) {
      setFormError('Veuillez renseigner un numéro ou nom de table valide.');
      return;
    }

    // Check for duplicates
    const exists = tableList.some(
      t => t.tableNumber.toLowerCase() === cleanNumber.toLowerCase()
    );
    if (exists) {
      setFormError(`La table "${cleanNumber}" existe déjà.`);
      return;
    }

    const newId = `tbl-${Date.now()}`;
    const newTable: RestaurantTable = {
      id: newId,
      tableNumber: cleanNumber,
      section: newTableSection,
      capacity: Math.max(1, newTableCapacity),
      isActive: true,
      qrUrl: generateTableQrUrl(appOrigin, restaurant.slug, cleanNumber)
    };

    setTableList(prev => [...prev, newTable]);
    setSelectedTableId(newId);
    onSaveTable(newTable);
    setIsNewTableModalOpen(false);
    setNewTableNumber('');
    setFormError(null);
    sounds.playSuccess();
  };

  return (
    <div className="flex-1 flex flex-col bg-[#f4f7fb] text-[#181c1f]">
      {/* Printable Tent Card View (Visible only during printing) */}
      <div className="hidden print:block fixed inset-0 bg-white p-8">
        <div className="max-w-md mx-auto border-4 border-[#0c2e22] rounded-3xl p-8 text-center space-y-4 bg-white">
          <div className="text-xs font-black uppercase tracking-widest text-[#d97706]">
            RestauMax · Menu Numérique
          </div>
          <h1 className="text-2xl font-black text-[#0c2e22]">
            {restaurant.name}
          </h1>
          <div className="text-5xl font-black text-[#d97706] py-2">
            Table {currentTable.tableNumber}
          </div>
          <div className="w-56 h-56 mx-auto bg-white p-2 border-2 border-slate-300 rounded-2xl flex items-center justify-center">
            {qrDataUrl && (
              <img src={qrDataUrl} alt="QR Code Table" className="w-full h-full object-contain" />
            )}
          </div>
          <p className="text-sm font-bold text-slate-800 leading-snug">
            Scannez ce QR code avec votre smartphone pour ouvrir la carte et commander sans attendre.
          </p>
          <p className="text-xs text-slate-500 font-mono">
            {canonicalUrl}
          </p>
        </div>
      </div>

      {/* Screen Navigation Header */}
      <div className="print:hidden bg-[#101d2d] text-white border-b border-slate-800 px-4 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                sounds.playTap();
                onBackToHub();
              }}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Retourner au Centre de Gestion"
            >
              <ArrowLeft size={16} />
              <span>Centre de Gestion</span>
            </button>
            <div className="h-6 w-px bg-slate-700 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Gérant Autorisé
                </span>
                <h1 className="text-xl font-black text-white tracking-tight">
                  Générateur de QR Codes des Tables
                </h1>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {restaurant.name} — Création, export vectoriel & impression des chevalets de table RestauMax
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                sounds.playTap();
                setIsNewTableModalOpen(true);
              }}
              className="px-3.5 py-2 bg-[#ff6500] hover:bg-[#e05800] text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
            >
              <Plus size={15} />
              <span>Ajouter une table</span>
            </button>

            <button
              onClick={handlePrintTent}
              className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95"
              title="Imprimer le chevalet de table"
            >
              <Printer size={15} />
              <span>Imprimer le chevalet</span>
            </button>
          </div>
        </div>
      </div>

      {/* Screen Body */}
      <div className="print:hidden max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 space-y-6">
        {/* Intro banner */}
        <div className="bg-emerald-950 text-white rounded-3xl p-5 sm:p-6 border border-emerald-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-800/80 text-emerald-200 text-[10px] font-black uppercase tracking-wider">
              <ShieldCheck size={12} className="text-emerald-400" />
              <span>Encodage Sécurisé & Canonique RestauMax</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
              Chevalets de table connectés en direct au catalogue
            </h2>
            <p className="text-xs text-emerald-200/90 leading-relaxed">
              Chaque QR code généré intègre de manière infalsifiable l'identifiant du restaurant (<code className="bg-emerald-900 px-1 py-0.5 rounded font-mono text-[11px]">{restaurant.slug}</code>) et le numéro de table exact. Lorsqu'un convive scanne son chevalet, son menu charge immédiatement en mode « Sur place ».
            </p>
          </div>

          <div className="bg-emerald-900/60 p-4 rounded-2xl border border-emerald-700/60 text-right shrink-0">
            <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block">
              Tables configurées
            </span>
            <div className="text-3xl font-black text-amber-400 tnum">
              {tableList.length}
            </div>
            <span className="text-[11px] text-emerald-300">
              Prêtes pour impression & scan
            </span>
          </div>
        </div>

        {/* 2-Columns Grid: Left = Table Selector, Right = Live Tent Card Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Tables List (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Layers size={14} className="text-[#ff6500]" />
                  <span>Sélectionner une table ({tableList.length})</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-semibold">
                  Cliquez pour afficher
                </span>
              </div>

              {/* Table Buttons Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[460px] overflow-y-auto pr-1">
                {tableList.map((tbl) => {
                  const isSelected = tbl.id === currentTable?.id;
                  return (
                    <button
                      key={tbl.id}
                      onClick={() => {
                        sounds.playTap();
                        setSelectedTableId(tbl.id);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                        isSelected
                          ? 'border-[#0c2e22] bg-[#0c2e22] text-white shadow-md ring-2 ring-emerald-500/40'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-wider ${
                          isSelected ? 'text-amber-300' : 'text-slate-400'
                        }`}>
                          {tbl.section}
                        </span>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        )}
                      </div>

                      <div className="my-1.5">
                        <div className={`text-base font-black ${
                          isSelected ? 'text-white' : 'text-slate-900'
                        }`}>
                          Table {tbl.tableNumber}
                        </div>
                        <div className={`text-[10px] ${
                          isSelected ? 'text-emerald-200' : 'text-slate-500'
                        }`}>
                          {tbl.capacity} couverts
                        </div>
                      </div>

                      <div className={`text-[9px] font-mono truncate ${
                        isSelected ? 'text-emerald-300/80' : 'text-slate-400'
                      }`}>
                        ?table={tbl.tableNumber}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick action: Table details card */}
            {currentTable && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">URL canonique encodée :</span>
                  <a
                    href={canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#ff6500] hover:underline flex items-center gap-1 font-bold text-[11px]"
                  >
                    <span>Tester le lien</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-600 break-all select-all">
                  {canonicalUrl}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Distinctive Forest Green Tent Card Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Eye size={18} className="text-[#0c2e22]" />
                    <span>Aperçu du Chevalet de Table RestauMax</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Modèle d'impression standard « Forest Green » avec instructions pour le convive
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadPng}
                    disabled={isGenerating || !qrDataUrl}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                    title="Télécharger le QR Code au format image PNG haute résolution"
                  >
                    <Download size={13} />
                    <span>PNG</span>
                  </button>

                  <button
                    onClick={handleDownloadSvg}
                    disabled={isGenerating || !qrSvgString}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                    title="Télécharger le QR Code au format vectoriel SVG sans perte"
                  >
                    <Download size={13} />
                    <span>SVG</span>
                  </button>
                </div>
              </div>

              {/* Distinctive Forest Green Luxury Tent Card Visual Design */}
              <div className="max-w-sm mx-auto bg-gradient-to-b from-[#09241b] via-[#0c2e22] to-[#071c15] text-white rounded-3xl p-6 sm:p-7 shadow-2xl border-4 border-[#d4af37]/40 relative overflow-hidden text-center space-y-4">
                {/* Decorative golden ambient corners */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent" />
                <div className="absolute -top-12 -right-12 w-28 h-28 bg-[#d4af37]/10 rounded-full blur-xl pointer-events-none" />

                {/* RestauMax Brand Badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-amber-300 text-[10px] font-black uppercase tracking-widest border border-amber-300/30">
                  <Sparkles size={11} className="text-amber-400" />
                  <span>Menu Digital RestauMax</span>
                </div>

                {/* Restaurant Name */}
                <div>
                  <h4 className="text-lg font-black tracking-tight text-white leading-tight">
                    {restaurant.name}
                  </h4>
                  <p className="text-[11px] text-emerald-200/80 mt-0.5">
                    {restaurant.address} · {restaurant.city}
                  </p>
                </div>

                {/* Prominent Table Callout */}
                <div className="py-2.5 px-4 rounded-2xl bg-black/40 border border-white/10 inline-block">
                  <span className="text-[10px] uppercase font-bold text-slate-300 tracking-wider block">
                    Emplacement du Convive
                  </span>
                  <div className="text-3xl sm:text-4xl font-black text-amber-400 tracking-tight mt-0.5">
                    Table {currentTable.tableNumber}
                  </div>
                </div>

                {/* QR Code Presentation Box */}
                <div className="w-56 h-56 mx-auto bg-white rounded-2xl p-3 shadow-xl border-2 border-amber-300/40 flex items-center justify-center relative">
                  {isGenerating ? (
                    <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                      <RefreshCw size={24} className="animate-spin text-[#0c2e22]" />
                      <span className="text-xs font-semibold">Génération QR...</span>
                    </div>
                  ) : qrDataUrl ? (
                    <img 
                      src={qrDataUrl} 
                      alt={`QR Code Table ${currentTable.tableNumber}`} 
                      className="w-full h-full object-contain"
                    />
                  ) : null}
                </div>

                {/* French Customer Scanning Instruction */}
                <div className="space-y-1 max-w-xs mx-auto">
                  <p className="text-xs font-bold text-white leading-snug flex items-center justify-center gap-1.5">
                    <Smartphone size={14} className="text-amber-300 shrink-0" />
                    <span>Scannez avec votre appareil photo</span>
                  </p>
                  <p className="text-[10px] text-emerald-200/80 leading-normal">
                    Consultez la carte en direct, personnalisez vos accompagnements et validez votre commande en FCFA.
                  </p>
                </div>

                {/* Bottom URL stamp */}
                <div className="pt-2 border-t border-white/10 text-[9px] font-mono text-emerald-300/70 truncate">
                  {canonicalUrl}
                </div>
              </div>

              {/* Action Buttons below preview */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handlePrintTent}
                  className="w-full sm:w-auto px-6 py-3 bg-[#0c2e22] hover:bg-[#082218] text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  <Printer size={16} className="text-amber-400" />
                  <span>Imprimer ce chevalet (Table {currentTable.tableNumber})</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPng}
                  className="w-full sm:w-auto px-5 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  <Download size={15} />
                  <span>Télécharger l'image PNG</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Add New Table */}
      {isNewTableModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Plus size={18} className="text-[#ff6500]" />
                <span>Ajouter une table</span>
              </h3>
              <button
                onClick={() => setIsNewTableModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateNewTable} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Numéro ou nom de la table *
                </label>
                <input
                  type="text"
                  placeholder="ex. 9, 10, Bar 2, Terrasse B..."
                  value={newTableNumber}
                  onChange={(e) => {
                    setNewTableNumber(e.target.value);
                    setFormError(null);
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Zone / Espace
                  </label>
                  <select
                    value={newTableSection}
                    onChange={(e) => setNewTableSection(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
                  >
                    <option value="salle">Salle principale</option>
                    <option value="terrasse">Terrasse extérieure</option>
                    <option value="bar">Bar / Comptoir</option>
                    <option value="vip">Salon VIP</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Nombre de couverts
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={newTableCapacity}
                    onChange={(e) => setNewTableCapacity(parseInt(e.target.value) || 2)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6500]"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewTableModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#ff6500] hover:bg-[#e05800] text-white font-black transition-all shadow-sm active:scale-95"
                >
                  Créer et générer le QR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
