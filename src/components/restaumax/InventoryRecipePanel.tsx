import React, { useEffect, useState } from 'react';
import { formatFCFA } from '../../utils/format';
import { calculateDishProfitability } from '../../utils/menuProfitability';
const formatCost = (amount: number) => formatFCFA(Math.round(amount));
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  db,
  saveInventoryRecipeWithServerValidation,
  saveInventoryCustomizationRecipeWithServerValidation
} from '../../lib/firebase';

type StockItem = { id: string; name: string; unit: string; unitCost: number; active?: boolean };
type OptionGroup = { id: string; name: string; options: Array<{ id: string; name: string }> };
type MenuItem = { id: string; name: string; price: number; optionGroups?: OptionGroup[]; availableExtras?: Array<{ id: string; name: string }> };
type Recipe = {
  id?: string;
  menuItemId: string;
  menuItemName: string;
  lines: Array<{ inventoryItemId: string; itemName: string; unit: string; quantityPerDish: number }>;
  customizationType?: 'option' | 'extra';
  groupId?: string | null;
  optionId?: string | null;
  extraId?: string | null;
  targetName?: string;
};
type Line = { inventoryItemId: string; quantityPerDish: string };
type RecipeType = 'dish' | 'option' | 'extra';

export const InventoryRecipePanel: React.FC<{ restaurantSlug: string; canManage: boolean; inventory: StockItem[] }> = ({ restaurantSlug, canManage, inventory }) => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeType, setRecipeType] = useState<RecipeType>('dish');
  const [menuItemId, setMenuItemId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantityPerDish: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedMenuItem = menu.find(item => item.id === menuItemId);
  const selectedGroup = selectedMenuItem?.optionGroups?.find(group => group.id === groupId);
  const targetOptions = recipeType === 'option'
    ? (selectedGroup?.options || [])
    : recipeType === 'extra'
      ? (selectedMenuItem?.availableExtras || [])
      : [];

  useEffect(() => {
    const stopMenu = onSnapshot(query(collection(db, 'restaurants', restaurantSlug, 'menuItems'), where('restaurantSlug', '==', restaurantSlug)), snap => {
      setMenu(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, name: String(data.name || ''), price: Number(data.price || 0),
          optionGroups: Array.isArray(data.optionGroups) ? data.optionGroups : [],
          availableExtras: Array.isArray(data.availableExtras) ? data.availableExtras : []
        };
      }).sort((a,b) => a.name.localeCompare(b.name)));
    }, e => setError(e.message));
    const stopRecipes = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuRecipes'), snap => {
      setRecipes(current => [
        ...snap.docs.map(d => ({ ...d.data(), id: d.id, customizationType: undefined } as Recipe)),
        ...current.filter(recipe => recipe.customizationType)
      ].sort((a,b) => a.menuItemName.localeCompare(b.menuItemName)));
    }, e => setError(e.message));
    const stopCustomRecipes = onSnapshot(collection(db, 'restaurants', restaurantSlug, 'menuCustomizationRecipes'), snap => {
      setRecipes(current => [
        ...current.filter(recipe => !recipe.customizationType),
        ...snap.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))
      ].sort((a,b) => a.menuItemName.localeCompare(b.menuItemName)));
    }, e => setError(e.message));
    return () => { stopMenu(); stopRecipes(); stopCustomRecipes(); };
  }, [restaurantSlug]);

  const resetForm = () => {
    setRecipeType('dish'); setMenuItemId(''); setGroupId(''); setTargetId('');
    setLines([{ inventoryItemId: '', quantityPerDish: '' }]);
  };

  const edit = (recipe: Recipe) => {
    setMenuItemId(recipe.menuItemId);
    setRecipeType(recipe.customizationType || 'dish');
    setGroupId(String(recipe.groupId || ''));
    setTargetId(String(recipe.optionId || recipe.extraId || ''));
    setLines(recipe.lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: String(line.quantityPerDish) })));
    setError(''); setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    const normalized = lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantityPerDish: Number(line.quantityPerDish) }));
    if (!menuItemId || normalized.length === 0 || normalized.some(line => !line.inventoryItemId || !Number.isFinite(line.quantityPerDish) || line.quantityPerDish <= 0) ||
        new Set(normalized.map(line => line.inventoryItemId)).size !== normalized.length ||
        (recipeType !== 'dish' && !targetId) || (recipeType === 'option' && !groupId)) {
      setError('Choisissez un plat, une option ou un supplément et des composants distincts avec une quantité positive par portion.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = recipeType === 'dish'
        ? await saveInventoryRecipeWithServerValidation(restaurantSlug, menuItemId, normalized)
        : await saveInventoryCustomizationRecipeWithServerValidation(restaurantSlug, {
            menuItemId, customizationType: recipeType,
            ...(recipeType === 'option' ? { groupId, optionId: targetId } : { extraId: targetId })
          }, normalized);
      if (!result.success) throw new Error(result.error);
      setNotice('Fiche de stock enregistrée et liée au catalogue officiel.');
      resetForm();
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement de la fiche impossible.'); }
    finally { setBusy(false); }
  };

  const inventoryById = new Map(inventory.map(item => [item.id, item]));
  const menuById = new Map(menu.map(item => [item.id, item]));
  const recipeLabel = (recipe: Recipe) => recipe.customizationType
    ? `${recipe.menuItemName} · ${recipe.targetName || (recipe.customizationType === 'option' ? 'Option' : 'Supplément')}`
    : recipe.menuItemName;

  return <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
    <div className="border-b p-4"><h2 className="font-bold">Fiches de stock · {recipes.length}</h2><p className="mt-1 text-xs text-slate-500">Définissez les composants consommés par un plat, une option ou un supplément. Le coût matière et la marge brute par portion sont calculés depuis les coûts unitaires de l’inventaire, sans conversion implicite d’unités. La marge affichée exclut main-d’œuvre, énergie, emballage, taxes et frais de paiement.</p></div>
    {error && <p role="alert" className="p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="p-3 text-sm text-emerald-700">{notice}</p>}
    {canManage && <form onSubmit={save} className="grid gap-3 border-b p-4">
      <label className="text-sm font-semibold">Type de fiche
        <select value={recipeType} onChange={e=>{setRecipeType(e.target.value as RecipeType);setGroupId('');setTargetId('');}} className="mt-1 w-full rounded-lg border p-3">
          <option value="dish">Plat principal</option><option value="option">Option configurable</option><option value="extra">Supplément</option>
        </select>
      </label>
      <label className="text-sm font-semibold">Plat du catalogue
        <select required value={menuItemId} onChange={e=>{setMenuItemId(e.target.value);setGroupId('');setTargetId('');}} className="mt-1 w-full rounded-lg border p-3">
          <option value="">Sélectionner un plat</option>
          {menu.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {recipeType === 'option' && <label className="text-sm font-semibold">Groupe d'options
        <select required value={groupId} onChange={e=>{setGroupId(e.target.value);setTargetId('');}} className="mt-1 w-full rounded-lg border p-3">
          <option value="">Sélectionner un groupe</option>
          {(selectedMenuItem?.optionGroups || []).map(group=><option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>}
      {recipeType !== 'dish' && <label className="text-sm font-semibold">{recipeType === 'option' ? 'Option' : 'Supplément'}
        <select required value={targetId} onChange={e=>setTargetId(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
          <option value="">Sélectionner</option>
          {targetOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {lines.map((line,index)=><div key={index} className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <select required value={line.inventoryItemId} onChange={e=>setLines(current=>current.map((entry,i)=>i===index?{...entry,inventoryItemId:e.target.value}:entry))} className="rounded-lg border p-3">
          <option value="">Choisir un composant</option>
          {inventory.map(item=><option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
        </select>
        <input required type="number" min="0.001" step="0.001" value={line.quantityPerDish} onChange={e=>setLines(current=>current.map((entry,i)=>i===index?{...entry,quantityPerDish:e.target.value}:entry))} placeholder="Quantité / portion" className="rounded-lg border p-3"/>
        <button type="button" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))} className="rounded-lg border px-3 py-2 text-sm text-rose-700">Retirer</button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={()=>setLines(current=>[...current,{inventoryItemId:'',quantityPerDish:''}])} className="rounded-lg border px-3 py-2 text-sm font-semibold">+ Ajouter un composant</button>
        <button disabled={busy || inventory.length===0 || menu.length===0} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white">{busy ? 'Enregistrement…' : 'Enregistrer la fiche de stock'}</button>
        <button type="button" onClick={resetForm} className="rounded-lg border px-3 py-2 text-sm">Réinitialiser</button>
      </div>
    </form>}
    {recipes.map(recipe=>{
      const menuItem = menuById.get(recipe.menuItemId);
      const profitability = menuItem ? calculateDishProfitability(menuItem.price, recipe.lines, inventory) : null;
      const cost = profitability?.costFcfa ?? 0;
      const margin = profitability?.grossMarginFcfa ?? null;
      const marginPercent = profitability?.grossMarginPercent ?? null;
      const hasCompleteCost = profitability?.complete === true;
      return <div key={recipe.id || recipe.menuItemId} className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-0">
        <div className="min-w-0 flex-1"><p className="font-bold">{recipeLabel(recipe)}</p>
          <p className="mt-1 text-sm text-slate-600">{recipe.lines.map(line=>line.itemName + ' : ' + line.quantityPerDish + ' ' + line.unit).join(' · ')}</p>
          {!recipe.customizationType && <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <span className="text-slate-600">Coût / portion : <strong>{hasCompleteCost ? formatCost(cost) : 'Coût incomplet'}</strong></span>
            <span className="text-slate-600">Prix : <strong>{menuItem ? formatCost(menuItem.price) : '—'}</strong></span>
            <span className={margin !== null && margin >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>Marge brute : {margin === null || !hasCompleteCost ? '—' : formatCost(margin)}{marginPercent === null || !hasCompleteCost ? '' : ' · ' + marginPercent + ' %'}</span>
          </div>}
        </div>{canManage && <button type="button" onClick={()=>edit(recipe)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Modifier</button>}
      </div>;
    })}
    {recipes.length===0 && <p className="p-5 text-sm text-slate-500">Aucune fiche définie. Créez les fiches des plats, options et suppléments pour activer leur consommation automatique.</p>}
  </section>;
};
