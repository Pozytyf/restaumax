import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, runTransaction, updateDoc
} from 'firebase/firestore';
import { ArrowLeft, Plus, Trash2, RefreshCw, Download, Save, Package, Users, BarChart3, Settings } from 'lucide-react';
import { auth, db, persistRestaurant } from '../../lib/firebase';
import type { RestaurantInfo, RestauOrder } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';

type ModuleId = 'customers' | 'inventory' | 'reports' | 'settings';
type Customer = { id: string; name: string; phone: string; email?: string; notes?: string; loyaltyPoints: number; createdAt?: number };
type InventoryItem = { id: string; name: string; unit: string; quantity: number; minQuantity: number; unitCost: number; supplier?: string; updatedAt: number };

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
  const [orders, setOrders] = useState<RestauOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [itemForm, setItemForm] = useState({ name: '', unit: 'kg', quantity: '0', minQuantity: '0', unitCost: '0', supplier: '' });
  const [settings, setSettings] = useState({
    name: restaurant.name, tagline: restaurant.tagline || '', address: restaurant.address || '',
    city: restaurant.city || '', phone: restaurant.phone || '', openingHours: restaurant.openingHours || '',
    isOpen: restaurant.isOpen, taxRatePercent: String(restaurant.taxRatePercent ?? 0),
    receiptFooter: restaurant.receiptFooter || '', receiptPaperWidth: restaurant.receiptPaperWidth || '80mm'
  });

  useEffect(() => {
    setError('');
    if (module === 'customers') {
      return onSnapshot(collection(db, 'restaurants', restaurant.slug, 'customers'), snap => {
        setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)).sort((a,b) => a.name.localeCompare(b.name)));
      }, err => setError(err.message));
    }
    if (module === 'inventory') {
      return onSnapshot(collection(db, 'restaurants', restaurant.slug, 'inventoryItems'), snap => {
        setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)).sort((a,b) => a.name.localeCompare(b.name)));
      }, err => setError(err.message));
    }
    if (module === 'reports') {
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
      receiptFooter: restaurant.receiptFooter || '', receiptPaperWidth: restaurant.receiptPaperWidth || '80mm'
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

  const addInventoryItem = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    const quantity = Number(itemForm.quantity), minQuantity = Number(itemForm.minQuantity), unitCost = Number(itemForm.unitCost);
    if (!itemForm.name.trim() || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minQuantity) || minQuantity < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      setError('Vérifiez le nom, les quantités et le coût unitaire.'); setLoading(false); return;
    }
    try {
      await addDoc(collection(db, 'restaurants', restaurant.slug, 'inventoryItems'), {
        name: itemForm.name.trim(), unit: itemForm.unit, quantity, minQuantity, unitCost,
        supplier: itemForm.supplier.trim(), updatedAt: Date.now()
      });
      setItemForm({ name: '', unit: 'kg', quantity: '0', minQuantity: '0', unitCost: '0', supplier: '' });
      setNotice('Article de stock ajouté.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement du stock impossible.'); }
    finally { setLoading(false); }
  };

  const moveStock = async (item: InventoryItem, delta: number) => {
    if (!canManage || !Number.isFinite(delta) || delta === 0) return;
    setError(''); setNotice('');
    const itemRef = doc(db, 'restaurants', restaurant.slug, 'inventoryItems', item.id);
    const movementRef = doc(collection(db, 'restaurants', restaurant.slug, 'stockMovements'));
    try {
      await runTransaction(db, async tx => {
        const snap = await tx.get(itemRef);
        if (!snap.exists()) throw new Error('Article introuvable.');
        const current = Number(snap.data().quantity || 0);
        if (current + delta < 0) throw new Error('Stock insuffisant : sortie refusée.');
        tx.update(itemRef, { quantity: current + delta, updatedAt: Date.now() });
        tx.set(movementRef, { itemId: item.id, itemName: item.name, delta, quantityAfter: current + delta, createdAt: Date.now(), createdBy: auth.currentUser?.uid || 'unknown' });
      });
      setNotice(delta > 0 ? 'Entrée de stock enregistrée.' : 'Sortie de stock enregistrée.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Mouvement de stock impossible.'); }
  };

  const removeInventoryItem = async (id: string) => {
    if (!canManage || !window.confirm('Supprimer cet article du stock ?')) return;
    try { await deleteDoc(doc(db, 'restaurants', restaurant.slug, 'inventoryItems', id)); setNotice('Article supprimé.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Suppression impossible.'); }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    const taxRatePercent = Number(settings.taxRatePercent);
    if (!settings.name.trim() || !Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 100) {
      setError('Nom du restaurant ou taux de taxe invalide (0 à 100 %).'); setLoading(false); return;
    }
    try {
      await persistRestaurant({
        ...restaurant, name: settings.name.trim(), tagline: settings.tagline.trim(),
        address: settings.address.trim(), city: settings.city.trim(), phone: settings.phone.trim(),
        openingHours: settings.openingHours.trim(), isOpen: settings.isOpen,
        taxRatePercent, receiptFooter: settings.receiptFooter.trim(),
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
          <h2 className="font-bold md:col-span-3">Nouvel article de stock</h2>
          <input required placeholder="Désignation" value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})} className="rounded-lg border p-3"/>
          <select value={itemForm.unit} onChange={e=>setItemForm({...itemForm,unit:e.target.value})} className="rounded-lg border p-3"><option>kg</option><option>g</option><option>L</option><option>ml</option><option>unité</option><option>carton</option><option>sac</option></select>
          <input type="number" min="0" step="0.001" placeholder="Stock initial" value={itemForm.quantity} onChange={e=>setItemForm({...itemForm,quantity:e.target.value})} className="rounded-lg border p-3"/>
          <input type="number" min="0" step="0.001" placeholder="Seuil d'alerte" value={itemForm.minQuantity} onChange={e=>setItemForm({...itemForm,minQuantity:e.target.value})} className="rounded-lg border p-3"/>
          <input type="number" min="0" step="1" placeholder="Coût unitaire FCFA" value={itemForm.unitCost} onChange={e=>setItemForm({...itemForm,unitCost:e.target.value})} className="rounded-lg border p-3"/>
          <input placeholder="Fournisseur" value={itemForm.supplier} onChange={e=>setItemForm({...itemForm,supplier:e.target.value})} className="rounded-lg border p-3"/>
          <button disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 p-3 font-bold text-white md:col-span-3"><Plus size={16}/> Ajouter au stock</button>
        </form>}
        <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4 font-bold">État du stock · {inventory.length} référence(s)</div>
          {inventory.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0"><div><p className="font-bold">{item.name}</p><p className="text-xs text-slate-500">{item.supplier || 'Fournisseur non renseigné'} · {formatFCFA(item.unitCost)} / {item.unit}</p><p className={`mt-1 text-sm font-bold ${item.quantity <= item.minQuantity ? 'text-rose-700' : 'text-emerald-700'}`}>{item.quantity} {item.unit} · seuil {item.minQuantity} {item.unit}{item.quantity <= item.minQuantity ? ' · STOCK BAS' : ''}</p></div>{canManage && <div className="flex flex-wrap gap-2"><button onClick={()=>moveStock(item,1)} className="rounded-lg border px-3 py-2 text-sm">+1 entrée</button><button onClick={()=>moveStock(item,-1)} className="rounded-lg border px-3 py-2 text-sm">−1 sortie</button><button onClick={()=>removeInventoryItem(item.id)} aria-label="Supprimer l'article" className="rounded-lg border border-rose-200 p-2 text-rose-700"><Trash2 size={16}/></button></div>}</div>)}
          {inventory.length===0 && <p className="p-8 text-center text-sm text-slate-500">Aucun article de stock. Ajoutez les matières premières et consommables.</p>}
        </section>
      </>}

      {module === 'reports' && <>
        <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Commandes finalisées</p><p className="mt-2 text-3xl font-black">{completedOrders.length}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Montant des commandes finalisées</p><p className="mt-2 text-2xl font-black">{formatFCFA(salesTotal)}</p></div><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Panier moyen</p><p className="mt-2 text-2xl font-black">{formatFCFA(completedOrders.length ? Math.round(salesTotal/completedOrders.length) : 0)}</p></div></div>
        <section className="rounded-2xl border bg-white p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Meilleures ventes (quantités)</h2><button onClick={exportCsv} className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"><Download size={15}/> Exporter CSV</button></div>
          {bestSellers.map(([name,qty])=><div key={name} className="flex justify-between border-b py-3 text-sm last:border-0"><span>{name}</span><strong>{qty}</strong></div>)}
          {bestSellers.length===0 && <p className="text-sm text-slate-500">Aucune commande finalisée à analyser.</p>}
          <p className="mt-4 text-xs text-amber-700">Les montants affichés sont calculés à partir des commandes au statut « terminée ». Ils ne constituent pas un rapprochement des encaissements ni une analyse de marge comptable.</p>
        </section>
      </>}

      {module === 'settings' && <form onSubmit={saveSettings} className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-2">
        <label className="text-sm font-semibold">Nom du restaurant<input required value={settings.name} onChange={e=>setSettings({...settings,name:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Slogan<input value={settings.tagline} onChange={e=>setSettings({...settings,tagline:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Adresse<input value={settings.address} onChange={e=>setSettings({...settings,address:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Ville<input value={settings.city} onChange={e=>setSettings({...settings,city:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Téléphone<input value={settings.phone} onChange={e=>setSettings({...settings,phone:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Horaires d'ouverture<input value={settings.openingHours} onChange={e=>setSettings({...settings,openingHours:e.target.value})} placeholder="Ex. Lun–Dim : 11h–23h" className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Taux de taxe (%)<input type="number" min="0" max="100" step="0.01" value={settings.taxRatePercent} onChange={e=>setSettings({...settings,taxRatePercent:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/><span className="text-xs font-normal text-slate-500">Paramètre indicatif : non appliqué automatiquement aux prix/commandes.</span></label>
        <label className="text-sm font-semibold">Format d'impression ticket<select value={settings.receiptPaperWidth} onChange={e=>setSettings({...settings,receiptPaperWidth:e.target.value as '58mm'|'80mm'})} className="mt-1 w-full rounded-lg border p-3"><option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></label>
        <label className="text-sm font-semibold md:col-span-2">Pied de ticket<input value={settings.receiptFooter} onChange={e=>setSettings({...settings,receiptFooter:e.target.value})} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold md:col-span-2"><input type="checkbox" checked={settings.isOpen} onChange={e=>setSettings({...settings,isOpen:e.target.checked})}/> Restaurant ouvert aux commandes client</label>
        {canManage && <button disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 p-3 font-bold text-white md:col-span-2"><Save size={16}/> Enregistrer les paramètres</button>}
      </form>}
    </div>
  </div>;
};
