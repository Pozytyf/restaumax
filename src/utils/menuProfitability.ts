export interface RecipeCostLine {
  inventoryItemId: string;
  itemName?: string;
  unit?: string;
  quantityPerDish: number;
}
export interface InventoryCostItem {
  id: string;
  unit: string;
  unitCost: number;
}
export interface RecipeCostResult {
  complete: boolean;
  costFcfa: number;
  missingIngredients: string[];
}
export function calculateRecipeCost(lines: RecipeCostLine[], inventory: InventoryCostItem[]): RecipeCostResult {
  const byId = new Map(inventory.map(item => [item.id, item]));
  let total = 0;
  const missingIngredients: string[] = [];
  for (const line of lines) {
    const item = byId.get(line.inventoryItemId);
    const quantity = Number(line.quantityPerDish);
    const unitCost = Number(item?.unitCost);
    if (!item || !Number.isFinite(quantity) || quantity <= 0 ||
        item.unit !== line.unit || !Number.isFinite(unitCost) || unitCost <= 0) {
      missingIngredients.push(line.itemName || line.inventoryItemId);
      continue;
    }
    total += quantity * unitCost;
  }
  return { complete: missingIngredients.length === 0, costFcfa: Math.round(total), missingIngredients };
}
export function calculateDishProfitability(priceFcfa: number, lines: RecipeCostLine[], inventory: InventoryCostItem[]) {
  const cost = calculateRecipeCost(lines, inventory);
  const price = Number(priceFcfa);
  const validPrice = Number.isSafeInteger(price) && price > 0;
  const complete = cost.complete && validPrice;
  const grossMarginFcfa = complete ? price - cost.costFcfa : null;
  return {
    ...cost,
    complete,
    grossMarginFcfa,
    grossMarginPercent: complete ? Math.round((Number(grossMarginFcfa) / price) * 1000) / 10 : null
  };
}
