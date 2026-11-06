import assert from 'node:assert/strict';
import { SWEET_AND_HOT_TEST_MENU_ITEMS as items } from './sweet-and-hot-test-menu.mjs';

assert.equal(items.length, 29, 'Le menu test doit contenir 28 références.');
assert.equal(new Set(items.map(item => item.id)).size, items.length, 'Les identifiants doivent être uniques.');
assert.ok(items.every(item => item.restaurantSlug === 'chez-awa'), 'Tous les plats doivent cibler Chez Awa.');
assert.ok(items.every(item => item.available === true), 'Tous les plats du jeu de test doivent être disponibles.');
assert.ok(items.every(item => Number.isInteger(item.price) && item.price > 0), 'Chaque prix de base doit être un entier positif en FCFA.');
assert.ok(items.every(item => ['plats', 'grillades', 'accompagnements'].includes(item.category)), 'Catégorie invalide.');
for (const item of items) {
  for (const group of item.optionGroups || []) {
    assert.ok(group.required, `Le choix de format doit être obligatoire : ${item.name}`);
    assert.ok(group.options.length >= 2, `Groupe de formats incomplet : ${item.name}`);
    assert.ok(group.options.every(option => Number.isInteger(option.extraPrice) && option.extraPrice >= 0));
  }
}
const expected = [
  ['sweet-hot-marmite-pecheur', 8000, 15000],
  ['sweet-hot-kedjenou-merou', 15000, 25000],
  ['sweet-hot-merou-braise', 15000, 25000],
  ['sweet-hot-brochette-gambas', 5000, 5000],
  ['sweet-hot-accompagnement', 500, 500]
];
for (const [id, min, max] of expected) {
  const found = items.find(item => item.id === id);
  assert.ok(found, `Plat manquant : ${id}`);
  const prices = [found.price, ...(found.optionGroups || []).flatMap(group => group.options.map(option => found.price + option.extraPrice))];
  assert.equal(Math.min(...prices), min, `Prix minimum incorrect : ${id}`);
  assert.equal(Math.max(...prices), max, `Prix maximum incorrect : ${id}`);
}
console.log(`✓ Menu Sweet and Hot validé : ${items.length} plats, identifiants uniques, catégories et tarifs FCFA cohérents.`);
