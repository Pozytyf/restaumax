import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, saveInventoryRecipeWithServerValidation } from '../../lib/firebase';

type StockItem = { id: string; name: string; unit: string; active?: boolean };
type MenuItem = { id: string; name: string };
type Recipe = { menuItemId: string; menuItemName: string; lines: Array<{ inventoryItemId: string; itemName: string; unit: string; quantityPerDish: number }> };
type Line = { inventoryItemId: string; quantityPerDish: string };

export const InventoryRecipePanel: React.FC<{ restaurantSlug: string; canManage: boolean; inventory: StockItem[] }> = ({ restaurantSlug, canManage, inventory }) => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [menuItemId, setMenuItemId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantityPerDish: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const stopMenu = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuItems'), snap => {
      setMenu(snap.docs.map(d => ({ id: d.id, name: String(d.data().name || '') })).sort((a,b) => a.name.localeCompare(b.name)));
    }, e => setError(e.message));
    const stopRecipes = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuRecipes'), snap => {
      setRecipes(snap.docs.map(d => d.data() as Recipe).sort((a,b) => a.menuItemName.localeCompare(b.menuItemName)));
    }, e => setError(e.message));
    return () => { stopMenu(); stopRecipes(); };
  }, [restaurantSlug]);

  const edit = (recipe: Recipe) => {
    setMenuItemId(recipe.menuItemId);
    setLines(recipe.lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: String(line.quantityPerDish) })));
    setError(''); setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    const normalized = lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: Number(line.quantityPerDish) }));
    if (!menuItemId || normalized.length === 0 || normalized.some(line => !line.inventoryItemId || !Number.isFinite(line.quantityPerDish) || line.quantityPerDish <= 0) ||
        new Set(normalized.map(line => line.inventoryItemId)).size !== normalized.length) {
      setError('Choisissez un plat et des ingrédients distincts avec une quantité positive par portion.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveInventoryRecipeWithServerValidation(restaurantSlug, menuItemId, normalized);
      if (!result.success) throw new Error(result.error);
      setNotice('Fiche recette enregistrée dans Firestore.');
      setLines([{ inventoryItemId: '', quantityPerDish: '' }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement de la recette impossible.'); }
    finally { setBusy(false); }
  };

  return <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
    <div className="border-b p-4"><h2 className="font-bold">Fiches recettes · {recipes.length}</h2><p className="mt-1 text-xs text-slate-500">Quantité nécessaire pour une portion. Chaque quantité utilise exactement l’unité de l’article de stock ; aucune conversion implicite n’est appliquée.</p></div>
    {error && <p role="alert" className="p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="p-3 text-sm text-emerald-700">{notice}</p>}
    {canManage && <form onSubmit={save} className="grid gap-3 border-b p-4">
      <label className="text-sm font-semibold">Plat du catalogue
        <select required value={menuItemId} onChange={e=>setMenuItemId(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
          <option value="">Sélectionner un plat</option>
          {menu.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {lines.map((line,index)=><div key={index} className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <select required value={line.inventoryItemId} onChange={e=>setLines(current=>current.map((entry,i)=>i===index?{...entry,inventoryItemId:e.target.value}:entry))} className="rounded-lg border p-3">
          <option value="">Choisir un ingrédient</option>
          {inventory.map(item=><option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
        </select>
        <input required type="number" min="0.001" step="0.001" value={line.quantityPerDish} onChange={e=>setLines(current=>current.map((entry,i)=>i===index?{...entry,quantityPerDish:e.target.value}:entry))} placeholder="Quantité / portion" className="rounded-lg border p-3"/>
        <button type="button" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))} className="rounded-lg border px-3 py-2 text-sm text-rose-700">Retirer</button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={()=>setLines(current=>[...current,{inventoryItemId:'',quantityPerDish:''}])} className="rounded-lg border px-3 py-2 text-sm font-semibold">+ Ajouter un ingrédient</button>
        <button disabled={busy || inventory.length===0 || menu.length===0} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white">{busy ? 'Enregistrement…' : 'Enregistrer la fiche recette'}</button>
      </div>
    </form>}
    {recipes.map(recipe=><div key={recipe.menuItemId} className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-0"><div><p className="font-bold">{recipe.menuItemName}</p><p className="mt-1 text-sm text-slate-600">{recipe.lines.map(line=>line.itemName + ' : ' + line.quantityPerDish + ' ' + line.unit).join(' · ')}</p></div>{canManage && <button type="button" onClick={()=>edit(recipe)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Modifier la recette</button>}</div>)}
    {recipes.length===0 && <p className="p-5 text-sm text-slate-500">Aucune recette définie. La déduction automatique des ventes sera activée après sécurisation du cycle transactionnel de commande.</p>}
  </section>;
};
