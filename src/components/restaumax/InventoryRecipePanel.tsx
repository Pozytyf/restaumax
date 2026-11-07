import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, saveInventoryRecipeWithServerValidation } from '../../lib/firebase';

type StockItem = { id: string; name: string; unit: string; active?: boolean };
type MenuItem = {
  id: string;
  name: string;
  optionGroups?: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>;
  availableExtras?: Array<{ id: string; name: string }>;
};
type Recipe = {
  menuItemId: string;
  menuItemName: string;
  targetType?: 'menu_item' | 'option' | 'extra';
  targetId?: string;
  targetLabel?: string;
  lines: Array<{ inventoryItemId: string; itemName: string; unit: string; quantityPerDish: number }>;
};
type Line = { inventoryItemId: string; quantityPerDish: string };
type RecipeTarget = { key: string; menuItemId: string; type: 'menu_item' | 'option' | 'extra'; id: string; label: string };

export const InventoryRecipePanel: React.FC<{ restaurantSlug: string; canManage: boolean; inventory: StockItem[] }> = ({ restaurantSlug, canManage, inventory }) => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantityPerDish: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const stopMenu = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuItems'), snap => {
      setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem)).sort((a,b) => a.name.localeCompare(b.name)));
    }, e => setError(e.message));
    const stopRecipes = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuRecipes'), snap => {
      setRecipes(snap.docs.map(d => d.data() as Recipe).sort((a,b) => a.menuItemName.localeCompare(b.menuItemName)));
    }, e => setError(e.message));
    return () => { stopMenu(); stopRecipes(); };
  }, [restaurantSlug]);

  const targets = useMemo<RecipeTarget[]>(() => menu.flatMap(item => [
    { key: 'menu_item:' + item.id, menuItemId: item.id, type: 'menu_item' as const, id: item.id, label: 'Plat · ' + item.name },
    ...(item.optionGroups || []).flatMap(group => group.options.map(option => ({
      key: 'option:' + item.id + ':' + group.id + ':' + option.id,
      menuItemId: item.id, type: 'option' as const, id: group.id + ':' + option.id,
      label: 'Option · ' + item.name + ' / ' + group.name + ' / ' + option.name
    }))),
    ...(item.availableExtras || []).map(extra => ({
      key: 'extra:' + item.id + ':' + extra.id, menuItemId: item.id, type: 'extra' as const,
      id: extra.id, label: 'Supplément · ' + item.name + ' / ' + extra.name
    }))
  ]), [menu]);

  const edit = (recipe: Recipe) => {
    const type = recipe.targetType || 'menu_item';
    const id = recipe.targetId || recipe.menuItemId;
    setTargetKey(type === 'menu_item' ? 'menu_item:' + recipe.menuItemId :
      type === 'option' ? 'option:' + recipe.menuItemId + ':' + id.replace(':', ':') :
      'extra:' + recipe.menuItemId + ':' + id);
    setLines(recipe.lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: String(line.quantityPerDish) })));
    setError(''); setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    const target = targets.find(entry => entry.key === targetKey);
    const normalized = lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: Number(line.quantityPerDish) }));
    if (!target || normalized.length === 0 || normalized.some(line => !line.inventoryItemId || !Number.isFinite(line.quantityPerDish) || line.quantityPerDish <= 0) ||
        new Set(normalized.map(line => line.inventoryItemId)).size !== normalized.length) {
      setError('Choisissez un plat, une option ou un supplément et des ingrédients distincts avec une quantité positive par portion.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveInventoryRecipeWithServerValidation(
        restaurantSlug, target.menuItemId, normalized, target.type, target.id
      );
      if (!result.success) throw new Error(result.error);
      setNotice('Fiche recette enregistrée dans Firestore.');
      setLines([{ inventoryItemId: '', quantityPerDish: '' }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement de la recette impossible.'); }
    finally { setBusy(false); }
  };

  return <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
    <div className="border-b p-4"><h2 className="font-bold">Fiches recettes · {recipes.length}</h2><p className="mt-1 text-xs text-slate-500">Définissez les composants par portion pour chaque plat, option et supplément. Chaque quantité utilise exactement l’unité de l’article de stock ; aucune conversion implicite n’est appliquée.</p></div>
    {error && <p role="alert" className="p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="p-3 text-sm text-emerald-700">{notice}</p>}
    {canManage && <form onSubmit={save} className="grid gap-3 border-b p-4">
      <label className="text-sm font-semibold">Élément à suivre
        <select required value={targetKey} onChange={e=>setTargetKey(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
          <option value="">Sélectionner un plat, une option ou un supplément</option>
          {targets.map(target=><option key={target.key} value={target.key}>{target.label}</option>)}
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
        <button disabled={busy || inventory.length===0 || targets.length===0} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white">{busy ? 'Enregistrement…' : 'Enregistrer la fiche recette'}</button>
      </div>
    </form>}
    {recipes.map(recipe=><div key={(recipe.targetType || 'menu_item') + ':' + recipe.menuItemId + ':' + (recipe.targetId || recipe.menuItemId)} className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-0"><div><p className="font-bold">{recipe.menuItemName} · {recipe.targetLabel || 'Plat'}</p><p className="mt-1 text-sm text-slate-600">{recipe.lines.map(line=>line.itemName + ' : ' + line.quantityPerDish + ' ' + line.unit).join(' · ')}</p></div>{canManage && <button type="button" onClick={()=>edit(recipe)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Modifier la recette</button>}</div>)}
    {recipes.length===0 && <p className="p-5 text-sm text-slate-500">Aucune recette définie. La consommation automatique sera complète lorsque chaque plat, option et supplément commandable disposera de sa fiche.</p>}
  </section>;
};
