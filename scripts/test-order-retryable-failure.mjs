import assert from 'node:assert/strict';
import fs from 'node:fs';
import { processOrderSubmission } from '../src/server/orderService.ts';

const slug = 'retryable-order-test';
const payload = {
  restaurantSlug: slug,
  cart: [{ menuItemId: 'dish-1', quantity: 1 }],
  orderMode: 'a_emporter',
  tableNumber: null,
  idempotencyKey: 'retryable-key-0001',
  declaredTotal: 1000
};

const provider = {
  async getMenuItems() {
    return [{
      id: 'dish-1',
      restaurantSlug: slug,
      name: 'Plat de test',
      price: 1000,
      available: true,
      availableExtras: [],
      optionGroups: []
    }];
  },
  async executeOrderTransaction() {
    // Simule un acquittement réseau perdu après que Firestore ait pu valider le commit.
    throw new Error('simulated transaction acknowledgement timeout');
  }
};

const result = await processOrderSubmission(payload, provider);
assert.equal(result.success, false, 'Une transaction sans acquittement ne doit pas annoncer un succès');
assert.equal(result.retryable, true, 'Une erreur transactionnelle doit être classée comme rejouable');
assert.match(result.error || '', /enregistrer la commande/i, 'Le message reste explicite');

const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const firebaseSource = fs.readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
assert(serverSource.includes('return { statusCode: result.retryable ? 503 : 400, body: result };'),
  'Les handlers de commande transforment une erreur rejouable en HTTP 503');
assert(firebaseSource.includes('definitive: data.definitive === true || (response.status >= 400 && response.status < 500)'),
  'Le client ne libère pas la clé après un HTTP 503');

console.log('✓ Les erreurs transactionnelles conservent la clé d’idempotence et sont rejouables.');
