import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc
} from 'firebase/firestore';
import { ArrowLeft, Plus, Trash2, RefreshCw, Download, Save, Pencil, Package, Users, BarChart3, Settings } from 'lucide-react';
import { auth, db, persistRestaurant, createInventoryItemWithServerValidation, updateInventoryItemWithServerValidation, moveInventoryStockWithServerValidation, archiveInventoryItemWithServerValidation, getFinancialReportWithServerValidation } from '../../lib/firebase';
import type { RestaurantInfo, RestauOrder } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { InventoryRecipePanel } from './InventoryRecipePanel';

type ModuleId = 'customers' | 'inventory' | 'reports' | 'settings';
type Customer = { id: string; name: string; phone: string; email?: string; notes?: string; loyaltyPoints: number; createdAt?: number };
type InventoryItem = { id: string; name: string; unit: string; quantity: number; minQuantity: number; unitCost: number; supplier?: string; updatedAt: number; active?: boolean };
type StockMovement = { id: string; itemName: string; unit: string; quantityBefore: number; delta: number; quantityAfter: number; reason: string; createdAt: number; createdBy: string };

const titles: Record<ModuleId, string> = {
  customers: 'Clients et fidélité',
  inventory: 'Stocks et approvisionnements',
  reports: 'Rapports et statistiques',
  settings: 'Paramètres du restaurant'
};

export const RestaurantAdminModuleView: React.FC<{
  module: ModuleId;
  restaurant: RestaurantInfo;
  permissions: string[];
  onBack: () => void;
}> = ({ module, restaurant, permissions, onBack }) => {
  const canManage = permissions.includes(module === 'customers' ? 'customers.manage' : module === 'inventory' ? 'inventory.manage' : 'settings.manage');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [orders, setOrders] = useState<RestauOrder[]>([]);
  const [financialReport, setFinancialReport] = useState<Record<string, number> | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [itemForm, setItemForm] = useState({ name: '', unit: 'kg', quantity: '0', minQuantity: '0', unitCost: '0', supplier: '' });
  const [editingInventoryItemId, setEditingInventoryItemId] = useState<string | null>(null);
  const [inventoryCreateKey, setInventoryCreateKey] = useState(() => {
    try {
      return sessionStorage.getItem(`restaumax:inventory:pending-create:${restaurant.slug}`) || crypto.randomUUID().replaceAll('-', '');
    } catch {
      return crypto.randomUUID().replaceAll('-', '');
    }
  });
  const [settings, setSettings] = useState({
    name: restaurant.name, tagline: restaurant.tagline || '', address: restaurant.address || '',
    city: restaurant.city || '', phone: restaurant.phone || '', openingHours: restaurant.openingHours || '',
    isOpen: restaurant.isOpen, taxRatePercent: String(restaurant.taxRatePercent ?? 0),
    taxMode: restaurant.taxMode || 'exclusive', loyaltyPointsPer1000: String(restaurant.loyaltyPointsPer1000 ?? 1), receiptFooter: restaurant.receiptFooter || '', receiptPaperWidth: restaurant.receiptPaperWidth || '80mm'
  });

  useEffect(() => {
    setError('');
    if (module === 'customers') {
      return onSnapshot(collection(db, 'restaurants', restaurant.slug, 'customers'), snap => {
        setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)).sort((a,b) => a.name.localeCompare(b.name)));
      }, err => setError(err.message));
    }
    if (module === 'inventory') {
      const unsubscribeItems = onSnapshot(collection(db, 'restaurants', restaurant.slug, 'inventoryItems'), snap => {
        setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)).filter(item => item.active !== false).sort((a,b) => a.name.localeCompare(b.name)));
      }, err => setError(err.message));
      const movementsQuery = query(
        collection(db, 'restaurants', restaurant.slug, 'stockMovements'),
        orderBy('createdAt', 'desc'),
        limit(30)
      );
      const unsubscribeMovements = onSnapshot(movementsQuery, snap => {
        setStockMovements(snap.docs.map(d => ({ id: d.id, ...d.data() } as StockMovement)));
      }, err => setError(err.message));
      return () => { unsubscribeItems(); unsubscribeMovements(); };
    }
    if (module === 'reports') {
      setReportLoading(true);
      void getFinancialReportWithServerValidation(restaurant.slug).then(result => {
        if (result.success) setFinancialReport(result.report);
        else setError(result.error);
      }).finally(() => setReportLoading(false));
      return onSnapshot(query(collection(db, 'restaurants', restaurant.slug, 'orders')), snap => {
        setOrders(snap.docs.map(d => d.data() as RestauOrder));
      }, err => setError(err.message));
    }
    return undefined;
  }, [module, restaurant.slug]);

  useEffect(() => {
    setSettings({
      name: restaurant.name, tagline: restaurant.tagline || '', address: restaurant.address || '',
      city: restaurant.city || '', phone: restaurant.phone || '', openingHours: restaurant.openingHours || '',
      isOpen: restaurant.isOpen, taxRatePercent: String(restaurant.taxRatePercent ?? 0),
      taxMode: restaurant.taxMode || 'exclusive', loyaltyPointsPer1000: String(restaurant.loyaltyPointsPer1000 ?? 1), receiptFooter: restaurant.receiptFooter || '', receiptPaperWidth: restaurant.receiptPaperWidth || '80mm'
    });
  }, [restaurant]);

  const completedOrders = useMemo(() => orders.filter(o => o.status === 'completed'), [orders]);
  const salesTotal = useMemo(() => completedOrders.reduce((sum,o) => sum + Number(o.totalAmount || 0), 0), [completedOrders]);
  const bestSellers = useMemo(() => {
    const map = new Map<string, number>();
    completedOrders.forEach(o => o.items?.forEach(i => map.set(i.name, (map.get(i.name) || 0) + i.quantity)));
    return [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0,8);
  }, [completedOrders]);

  const addCustomer = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      await addDoc(collection(db, 'restaurants', restaurant.slug, 'customers'), {
        ...customerForm, name: customerForm.name.trim(), phone: customerForm.phone.trim(),
        email: customerForm.email.trim(), loyaltyPoints: 0, createdAt: Date.now(), updatedAt: Date.now()
      });
      setCustomerForm({ name: '', phone: '', email: '', notes: '' }); setNotice('Client enregistré.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’enregistrer le client.'); }
    finally { setLoading(false); }
  };

  const removeCustomer = async (id: string) => {
    if (!canManage || !window.confirm('Supprimer cette fiche client ?')) return;
    try { await deleteDoc(doc(db, 'restaurants', restaurant.slug, 'customers', id)); setNotice('Fiche client supprimée.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Suppression impossible.'); }
  };

  const adjustPoints = async (customer: Customer, delta: number) => {
    if (!canManage) return;
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.slug, 'customers', customer.id), {
        loyaltyPoints: Math.max(0, customer.loyaltyPoints + delta), updatedAt: Date.now()
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Mise à jour des points impossible.'); }
  };

  const resetInventoryForm = () => {
    setEditingInventoryItemId(null);
    setItemForm({ name: '', unit: 'kg', quantity: '0', minQuantity: '0', unitCost: '0', supplier: '' });
  };

  const startEditInventoryItem = (item: InventoryItem) => {
    setEditingInventoryItemId(item.id);
    setItemForm({
      name: item.name, unit: item.unit, quantity: String(item.quantity),
      minQuantity: String(item.minQuantity), unitCost: String(item.unitCost), supplier: item.supplier || ''
    });
    setError('');
    setNotice('');
  };

  const addInventoryItem = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    const quantity = Number(itemForm.quantity), minQuantity = Number(itemForm.minQuantity), unitCost = Number(itemForm.unitCost);
    if (!itemForm.name.trim() || (!editingInventoryItemId && (!Number.isFinite(quantity) || quantity < 0)) ||
        !Number.isFinite(minQuantity) || minQuantity < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      setError('Vérifiez le nom, les quantités et le coût unitaire.'); setLoading(false); return;
    }
    try {
      if (editingInventoryItemId) {
        const result = await updateInventoryItemWithServerValidation(restaurant.slug, editingInventoryItemId, {
          name: itemForm.name.trim(), unit: itemForm.unit, minQuantity, unitCost, supplier: itemForm.supplier.trim()
        });
        if (!result.success) throw new Error(result.error);
        resetInventoryForm();
        setNotice('Informations de l’article mises à jour. La quantité reste gérée par les mouvements.');
        return;
      }

      const storageKey = `restaumax:inventory:pending-create:${restaurant.slug}`;
      let storageAvailable = true;
      try { sessionStorage.setItem(storageKey, inventoryCreateKey); } catch { storageAvailable = false; }
      const result = await createInventoryItemWithServerValidation(restaurant.slug, {
        name: itemForm.name.trim(), unit: itemForm.unit, quantity, minQuantity, unitCost,
        supplier: itemForm.supplier.trim()
      }, inventoryCreateKey);
      if (!result.success) {
        if (!result.retryable) {
          if (storageAvailable) sessionStorage.removeItem(storageKey);
          setInventoryCreateKey(crypto.randomUUID().replaceAll('-', ''));
        }
        throw new Error(result.error);
      }
      if (storageAvailable) sessionStorage.removeItem(storageKey);
      resetInventoryForm();
      setInventoryCreateKey(crypto.randomUUID().replaceAll('-', ''));
      setNotice('Article de stock ajouté et journal initial sécurisé.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement du stock impossible.'); }
    finally { setLoading(false); }
  };

  const moveStock = async (item: InventoryItem, delta: number) => {
    if (!canManage || !Number.isFinite(delta) || delta === 0) return;
    setError(''); setNotice('');
    setLoading(true);
    try {
      const storageKey = `restaumax:inventory:pending-move:${restaurant.slug}`;
      let storageAvailable = true;
      let pendingMove: { itemId: string; delta: number; idempotencyKey: string } | null = null;
      try {
        const raw = sessionStorage.getItem(storageKey);
        pendingMove = raw ? JSON.parse(raw) : null;
      } catch {
        storageAvailable = false;
      }
      if (pendingMove && (pendingMove.itemId !== item.id || pendingMove.delta !== delta)) {
        throw new Error('Un mouvement précédent reste à confirmer. Répétez d’abord exactement le même mouvement pour éviter un doublon.');
      }
      const idempotencyKey = pendingMove?.idempotencyKey || crypto.randomUUID().replaceAll('-', '');
      if (storageAvailable) {
        sessionStorage.setItem(storageKey, JSON.stringify({ itemId: item.id, delta, idempotencyKey }));
      }
      const result = await moveInventoryStockWithServerValidation(
        restaurant.slug, item.id, delta,
        delta > 0 ? 'Entrée manuelle' : 'Sortie manuelle',
        idempotencyKey
      );
      if (!result.success) {
        if (storageAvailable && !result.retryable) sessionStorage.removeItem(storageKey);
        throw new Error(result.error);
      }
      if (storageAvailable) sessionStorage.removeItem(storageKey);
      setNotice(delta > 0 ? 'Entrée de stock enregistrée et journalisée.' : 'Sortie de stock enregistrée et journalisée.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Mouvement de stock impossible.'); }
    finally { setLoading(false); }
  };

  const removeInventoryItem = async (id: string) => {
    if (!canManage || !window.confirm('Archiver cet article du stock ? L’historique de ses mouvements sera conservé.')) return;
    setLoading(true);
    try {
      const result = await archiveInventoryItemWithServerValidation(restaurant.slug, id);
      if (!result.success) throw new Error(result.error);
      setNotice('Article archivé. Son historique de mouvements est conservé.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Archivage impossible.'); }
    finally { setLoading(false); }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    const taxRatePercent = Number(settings.taxRatePercent);
    const loyaltyPointsPer1000 = Number(settings.loyaltyPointsPer1000);
    if (!settings.name.trim() || !Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100 ||
        !Number.isInteger(loyaltyPointsPer1000) || loyaltyPointsPer1000 < 0 || loyaltyPointsPer1000 > 100) {
      setError('Nom du restaurant ou taux de taxe invalide (0 à 100 %).'); setLoading(false); return;
    }
    try {
      await persistRestaurant({
        ...restaurant, name: settings.name.trim(), tagline: settings.tagline.trim(),
        address: settings.address.trim(), city: settings.city.trim(), phone: settings.phone.trim(),
        openingHours: settings.openingHours.trim(), isOpen: settings.isOpen,
        taxRatePercent, taxMode: settings.taxMode as 'exclusive' | 'inclusive', loyaltyPointsPer1000, receiptFooter: settings.receiptFooter.trim(),
        receiptPaperWidth: settings.receiptPaperWidth as '58mm' | '80mm'
      });
      setNotice('Paramètres enregistrés dans Firestore.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement des paramètres impossible.'); }
    finally { setLoading(false); }
  };

  const exportCsv = () => {
    const rows = [['N° commande','Date','Mode','Table','Statut','Montant FCFA'], ...completedOrders.map(o => [
      o.orderNumber, new Date(o.createdAt).toISOString(), o.orderMode, o.tableNumber || '', o.status, String(o.totalAmount)
    ])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"','""') + '"').join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'restaumax-rapport-commandes.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/> Retour au centre de gestion</button>
      <header className="flex flex-wrap items-center gap-3"><div className="rounded-xl bg-orange-100 p-3 text-orange-700">{module === 'customers' ? <Users/> : module === 'inventory' ? <Package/> : module === 'reports' ? <BarChart3/> : <Settings/>}</div><div><h1 className="text-2xl font-black">{titles[module]}</h1><p className="text-sm text-slate-500">{restaurant.name} · Données enregistrées dans Firestore</p></div></header>
      {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      {module === 'customers' && <>
        {canManage && <form onSubmit={addCustomer} className="grid gap-3 rounded-2xl border bg-white p-5 md:grid-cols-2">
          <h2 className="font-bold md:col-span-2">Ajouter un client</h2>
          <input required placeholder="Nom complet" value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})} className="rounded-lg border p-3"/>
          <input required placeholder="Téléphone" value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})} className="rounded-lg border p-3"/>
          <input type="email" placeholder="E-mail (facultatif)" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})} className="rounded-lg border p-3"/>
          <input placeholder="Notes / préférences" value={customerForm.notes} onChange={e=>setCustomerForm({...customerForm,notes:e.target.value})} className="rounded-lg border p-3"/>
          <button disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 p-3 font-bold text-white md:col-span-2"><Plus size={16}/> Enregistrer le client</button>
        </form>}
        <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4 font-bold">Répertoire clients · {customers.length}</div>
          {customers.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0"><div><p className="font-bold">{c.name}</p><p className="text-xs text-slate-500">{c.phone}{c.email ? ' · '+c.email : ''}</p>{c.notes && <p className="mt-1 text-sm text-slate-600">{c.notes}</p>}<p className="mt-1 text-xs font-semibold text-orange-700">{c.loyaltyPoints || 0} point(s) fidélité</p></div>{canManage && <div className="flex items-center gap-2"><button onClick={()=>adjustPoints(c,1)} className="rounded-lg border px-3 py-2 text-sm">+1 point</button><button onClick={()=>removeCustomer(c.id)} aria-label="Supprimer le client" className="rounded-lg border border-rose-200 p-2 text-rose-700"><Trash2 size={16}/></button></div>}</div>)}
          {customers.length===0 && <p className="p-8 text-center text-sm text-slate-500">Aucun client enregistré pour le moment.</p>}
        </section>
      </>}

      {module === 'inventory' && <>
        {canManage && <form onSubmit={addInventoryItem} className="grid gap-3 rounded-2xl border bg-white p-5 md:grid-cols-3">
          <h2 className="font-bold md:col-span-3">{editingInventoryItemId ? 'Modifier un article de stock' : 'Nouvel article de stock'}</h2>
          <input required placeholder="Désignation" value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})} className="rounded-lg border p-3"/>
          <select value={itemForm.unit} onChange={e=>setItemForm({...itemForm,unit:e.target.value})} className="rounded-lg border p-3"><option>kg</option><option>g</option><option>L</option><option>ml</option><option>unité</option><option>carton</option><option>sac</option></select>
          {!editingInventoryItemId && <input type="number" min="0" step="0.001" placeholder="Stock initial" value={itemForm.quantity} onChange={e=>setItemForm({...itemForm,quantity:e.target.value})} className="rounded-lg border p-3"/>}
          <input type="number" min="0" step="0.001" placeholder="Seuil d'alerte" value={itemForm.minQuantity} onChange={e=>setItemForm({...itemForm,minQuantity:e.target.value})} className="rounded-lg border p-3"/>
          <input type="number" min="0" step="1" placeholder="Coût unitaire FCFA" value={itemForm.unitCost} onChange={e=>setItemForm({...itemForm,unitCost:e.target.value})} className="rounded-lg border p-3"/>
          <input placeholder="Fournisseur" value={itemForm.supplier} onChange={e=>setItemForm({...itemForm,supplier:e.target.value})} className="rounded-lg border p-3"/>
          <div className="flex gap-2 md:col-span-3"><button disabled={loading} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 p-3 font-bold text-white">{editingInventoryItemId ? <Save size={16}/> : <Plus size={16}/>} {editingInventoryItemId ? 'Enregistrer les modifications' : 'Ajouter au stock'}</button>{editingInventoryItemId && <button type="button" disabled={loading} onClick={resetInventoryForm} className="rounded-lg border px-4 py-3 font-bold text-slate-600">Annuler</button>}</div>
        </form>}
        <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4 font-bold">État du stock · {inventory.length} référence(s)</div>
          {inventory.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0"><div><p className="font-bold">{item.name}</p><p className="text-xs text-slate-500">{item.supplier || 'Fournisseur non renseigné'} · {formatFCFA(item.unitCost)} / {item.unit}</p><p className={`mt-1 text-sm font-bold ${item.quantity <= item.minQuantity ? 'text-rose-700' : 'text-emerald-700'}`}>{item.quantity} {item.unit} · seuil {item.minQuantity} {item.unit}{item.quantity <= item.minQuantity ? ' · STOCK BAS' : ''}</p></div>{canManage && <div className="flex flex-wrap gap-2"><button onClick={()=>startEditInventoryItem(item)} disabled={loading} aria-label={`Modifier ${item.name}`} className="rounded-lg border p-2 text-slate-700"><Pencil size={16}/></button><button onClick={()=>moveStock(item,1)} disabled={loading} className="rounded-lg border px-3 py-2 text-sm">+1 entrée</button><button onClick={()=>moveStock(item,-1)} disabled={loading} className="rounded-lg border px-3 py-2 text-sm">−1 sortie</button><button onClick={()=>removeInventoryItem(item.id)} disabled={loading} aria-label="Archiver l'article" className="rounded-lg border border-rose-200 p-2 text-rose-700"><Trash2 size={16}/></button></div>}</div>)}
          {inventory.length===0 && <p className="p-8 text-center text-sm text-slate-500">Aucun article de stock. Ajoutez les matières premières et consommables.</p>}
        </section>
        <InventoryRecipePanel restaurantSlug={restaurant.slug} canManage={canManage} inventory={inventory} />
        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-4 font-bold">Journal des mouvements récents · {stockMovements.length}</div>
          {stockMovements.map(movement => (
            <div key={movement.id} className="grid gap-2 border-b p-4 text-sm last:border-0 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-bold">{movement.itemName} · {movement.reason || 'Mouvement de stock'}</p>
                <p className="text-xs text-slate-500">{new Date(movement.createdAt).toLocaleString('fr-FR')} · {movement.createdBy || 'Système'}</p>
              </div>
              <div className="text-sm md:text-right">
                <p className={movement.delta >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                  {movement.delta > 0 ? '+' : ''}{movement.delta} {movement.unit}
                </p>
                <p className="text-xs text-slate-500">{movement.quantityBefore} → {movement.quantityAfter} {movement.unit}</p>
              </div>
            </div>
          ))}
          {stockMovements.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Aucun mouvement de stock enregistré.</p>}
        </section>
      </>}
      
      {module === 'reports' && <>
        <div className="mb-3 flex items-center justify-between"><p className="text-xs text-slate-500">Période : 30 derniers jours · données serveur du restaurant</p><button type="button" onClick={()=>{setReportLoading(true);void getFinancialReportWithServerValidation(restaurant.slug).then(result=>result.success?setFinancialReport(result.report):setError(result.error)).finally(()=>setReportLoading(false));}} className="rounded-lg border px-3 py-2 text-xs font-bold"><RefreshCw size={13} className="inline mr-1"/> Actualiser</button></div>
        {reportLoading && <p role="status" className="text-sm text-slate-500">Calcul des rapports financiers…</p>}
        {financialReport && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Encaissements réels', financialReport.collectedFcfa],
            ['Coût matières consommées', financialReport.costOfGoodsFcfa],
            ['Marge brute estimée', financialReport.grossMarginFcfa],
            ['Dépenses', financialReport.expensesFcfa],
            ['Résultat après dépenses', financialReport.operatingResultFcfa],
            ['Créances restantes', financialReport.outstandingFcfa],
            ['Taxes enregistrées', financialReport.taxCollectedFcfa],
            ['Net caisse après sorties', financialReport.cashNetAfterMovementsFcfa]
          ].map(([label,value])=><div key={String(label)} className="rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-black">{formatFCFA(Number(value || 0))}</p></div>)}
        </div>}
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">Commandes terminées</p><p className="mt-2 text-2xl font-black">{financialReport?.completedOrders ?? completedOrders.length}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">Valeur commandes terminées</p><p className="mt-2 text-xl font-black">{formatFCFA(Number(financialReport?.grossOrderValueFcfa ?? salesTotal))}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">Marge brute estimée</p><p className="mt-2 text-xl font-black">{Number(financialReport?.grossMarginPercent || 0).toFixed(2)} %</p></div></div>
        <section className="rounded-2xl border bg-white p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Meilleures ventes (quantités)</h2><button onClick={exportCsv} className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"><Download size={15}/> Exporter CSV</button></div>
          {bestSellers.map(([name,qty])=><div key={name} className="flex justify-between border-b py-3 text-sm last:border-0"><span>{name}</span><strong>{qty}</strong></div>)}
          {bestSellers.length===0 && <p className="text-sm text-slate-500">Aucune commande finalisée à analyser.</p>}
          <p className="mt-4 text-xs text-amber-700">La marge est estimée à partir des coûts unitaires instantanés enregistrés au démarrage de préparation. Les consommations sans recette et les dépenses non saisies ne sont pas estimées.</p>
        </section>
      </>}

      {module === 'settings' && <form onSubmit={saveSettings} className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-2">
        <label className="text-sm font-semibold">Nom du restaurant<input required value={settings.name} onChange={e=>setSettings({...settings,name:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Slogan<input value={settings.tagline} onChange={e=>setSettings({...settings,tagline:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Adresse<input value={settings.address} onChange={e=>setSettings({...settings,address:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Ville<input value={settings.city} onChange={e=>setSettings({...settings,city:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Téléphone<input value={settings.phone} onChange={e=>setSettings({...settings,phone:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Horaires d'ouverture<input value={settings.openingHours} onChange={e=>setSettings({...settings,openingHours:e.target.value})} placeholder="Ex. Lun–Dim : 11h–23h" className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Taux de taxe (%)<input type="number" min="0" max="100" step="0.01" value={settings.taxRatePercent} onChange={e=>setSettings({...settings,taxRatePercent:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/><span className="text-xs font-normal text-slate-500">Appliqué par le serveur aux nouvelles commandes. Vérifiez le taux applicable à votre régime fiscal.</span></label>
        <label className="text-sm font-semibold">Mode de calcul de la taxe<select value={settings.taxMode} onChange={e=>setSettings({...settings,taxMode:e.target.value as 'exclusive'|'inclusive'})} className="mt-1 w-full rounded-lg border p-3"><option value="exclusive">Taxe ajoutée au prix (HT → TTC)</option><option value="inclusive">Taxe déjà incluse dans le prix (TTC)</option></select><span className="text-xs font-normal text-slate-500">Le mode est enregistré avec les paramètres du restaurant et figé sur chaque commande.</span></label>
        <label className="text-sm font-semibold">Points fidélité par tranche de 1 000 FCFA<input type="number" min="0" max="100" step="1" value={settings.loyaltyPointsPer1000} onChange={e=>setSettings({...settings,loyaltyPointsPer1000:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/><span className="text-xs font-normal text-slate-500">Par défaut : 1 point pour 1 000 FCFA entièrement encaissés. 0 désactive l’attribution automatique.</span></label>
        <label className="text-sm font-semibold">Format d'impression ticket<select value={settings.receiptPaperWidth} onChange={e=>setSettings({...settings,receiptPaperWidth:e.target.value as '58mm'|'80mm'})} className="mt-1 w-full rounded-lg border p-3"><option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></label>
        <label className="text-sm font-semibold md:col-span-2">Pied de ticket<input value={settings.receiptFooter} onChange={e=>setSettings({...settings,receiptFooter:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold md:col-span-2"><input type="checkbox" checked={settings.isOpen} onChange={e=>setSettings({...settings,isOpen:e.target.checked})}/> Restaurant ouvert aux commandes client</label>
        {canManage && <button disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 p-3 font-bold text-white md:col-span-2"><Save size={16}/> Enregistrer les paramètres</button>}
      </form>}
    </div>
  </div>;
};
