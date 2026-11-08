import assert from 'node:assert/strict';
import { calculateRecipeCost, calculateDishProfitability } from '../src/utils/menuProfitability.ts';

const inventory = [
  { id: 'rice', unit: 'kg', unitCost: 800 },
  { id: 'oil', unit: 'L', unitCost: 1500 }
];
const lines = [
  { inventoryItemId: 'rice', itemName: 'Riz', unit: 'kg', quantityPerDish: 0.25 },
  { inventoryItemId: 'oil', itemName: 'Huile', unit: 'L', quantityPerDish: 0.05 }
];
const cost = calculateRecipeCost(lines, inventory);
assert.deepEqual(cost, { complete: true, costFcfa: 275, missingIngredients: [] });
const margin = calculateDishProfitability(2500, lines, inventory);
assert.equal(margin.complete, true);
assert.equal(margin.grossMarginFcfa, 2225);
assert.equal(margin.grossMarginPercent, 89);
const mismatch = calculateRecipeCost([{ inventoryItemId: 'rice', itemName: 'Riz', unit: 'g', quantityPerDish: 250 }], inventory);
assert.equal(mismatch.complete, false, 'No silent conversion between kg and g');
const missing = calculateDishProfitability(2500, [{ inventoryItemId: 'unknown', unit: 'kg', quantityPerDish: 1 }], inventory);
assert.equal(missing.complete, false);
assert.equal(missing.grossMarginFcfa, null);
console.log('Recipe costing and dish gross-margin tests passed.');
