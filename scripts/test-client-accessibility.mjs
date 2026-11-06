import { readFileSync } from 'node:fs';

const files = {
  cards: readFileSync(new URL('../src/components/restaumax/ClientMenuView.tsx', import.meta.url), 'utf8'),
  product: readFileSync(new URL('../src/components/restaumax/ProductDetailModal.tsx', import.meta.url), 'utf8'),
  cart: readFileSync(new URL('../src/components/restaumax/CartDrawer.tsx', import.meta.url), 'utf8'),
  confirmation: readFileSync(new URL('../src/components/restaumax/OrderConfirmationModal.tsx', import.meta.url), 'utf8'),
  focus: readFileSync(new URL('../src/hooks/useAccessibleDialog.ts', import.meta.url), 'utf8')
};

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

console.log('RESTAUMAX — CONTRÔLES STATIQUES D’ACCESSIBILITÉ DU PARCOURS CLIENT');

const cardStart = files.cards.indexOf('{filteredItems.map((dish) => (');
const cardEnd = files.cards.indexOf('))}', cardStart);
const cardMarkup = cardStart >= 0 && cardEnd > cardStart ? files.cards.slice(cardStart, cardEnd) : '';
assert(cardMarkup.includes('<button') && cardMarkup.includes('type="button"'),
  'Chaque carte de plat est un contrôle natif utilisable au clavier');
assert(!cardMarkup.includes('role="button"') && !cardMarkup.includes('<button', cardMarkup.indexOf('<button') + 7),
  'Aucun contrôle bouton imbriqué dans une carte de plat');
assert(cardMarkup.includes('focus-visible:ring-2'),
  'Les cartes affichent un indicateur de focus visible');
assert(files.cards.includes('aria-live="polite"') && files.cards.includes('dans le panier'),
  'Les changements du nombre d’articles sont annoncés');

assert(files.focus.includes("event.key === 'Escape'"),
  'La touche Échap ferme le dialogue');
assert(files.focus.includes("event.key !== 'Tab'"),
  'La navigation Tab est interceptée pour confiner le focus');
assert(files.focus.includes('last.focus()') && files.focus.includes('first.focus()'),
  'Le focus boucle entre le premier et le dernier contrôle');
assert(files.focus.includes('previousFocus.focus()'),
  'Le focus revient à son déclencheur après fermeture');

for (const [name, source] of [['détail produit', files.product], ['panier', files.cart], ['confirmation', files.confirmation]]) {
  assert(source.includes('role="dialog"') && source.includes('aria-modal="true"') &&
    source.includes('ref={dialogRef}') && source.includes('tabIndex={-1}'),
    'Le dialogue ' + name + ' expose un rôle modal nommé et gère son focus');
}

assert(files.product.includes('role="alert"') && files.product.includes('aria-live="assertive"'),
  'Les erreurs de validation des options sont annoncées');
assert(files.cart.includes('role="alert"') && files.cart.includes('aria-live="assertive"'),
  'Les erreurs de soumission de commande sont annoncées');
assert(files.cart.includes('Transmission incertaine') && files.cart.includes('role="alert" aria-live="assertive" className="mx-4 mt-3 p-3.5'),
  'Les transmissions réseau incertaines sont annoncées même lorsque le panier est verrouillé');
assert(files.cart.includes('role="status"') && files.cart.includes('aria-live="polite"'),
  'Le chargement de la commande est annoncé');
assert(files.cart.includes('catch (err') && files.cart.includes('setSubmitError(err?.message'),
  'Une erreur réseau est capturée et présentée sans vider le panier');
assert(files.confirmation.includes('role="status"') && files.confirmation.includes('aria-live="polite"'),
  'La confirmation de commande est annoncée');
assert(files.confirmation.includes('paymentError') && files.confirmation.includes('role="alert"'),
  'Les erreurs de préparation du paiement sont annoncées sans masquer la commande confirmée');

console.log('BILAN ACCESSIBILITÉ : ' + passed + '/' + (passed + failed) + ' contrôles réussis.');
if (failed > 0) process.exit(1);
