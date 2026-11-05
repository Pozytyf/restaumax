import { validateSubscriptionInput } from '../src/server/subscriptionService.ts';

let passed = 0;
let failed = 0;
const assert = (condition: boolean, label: string) => {
  if (condition) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
};

const valid = {
  planName: 'Essentiel',
  priceFcfa: 15000,
  billingCycle: 'monthly',
  status: 'trial',
  startsAt: 1793836800000,
  endsAt: 1795046400000,
  notes: 'Essai commercial'
};

console.log('\n--- Validation des abonnements plateforme ---');
const validResult = validateSubscriptionInput(valid);
assert(validResult.success === true, 'Un abonnement mensuel valide est accepté');
assert(validResult.success === true && validResult.subscription.currency === 'XOF', 'La devise est normalisée en XOF');
assert(validResult.success === true && validResult.subscription.priceFcfa === 15000, 'Le tarif FCFA est conservé sans arrondi');
const freeResult = validateSubscriptionInput({ ...valid, priceFcfa: 0, status: 'active' });
assert(freeResult.success === true, 'Un plan gratuit à zéro FCFA est autorisé');
const trimmed = validateSubscriptionInput({ ...valid, planName: '  Pro  ', notes: 'x'.repeat(700) });
assert(trimmed.success === true && trimmed.subscription.planName === 'Pro', 'Le nom du plan est normalisé');
assert(trimmed.success === true && trimmed.subscription.notes.length === 500, 'Les notes internes sont limitées à 500 caractères');

assert(validateSubscriptionInput(null).success === false, 'Une charge utile absente est refusée');
assert(validateSubscriptionInput({ ...valid, planName: 'A' }).success === false, 'Un nom de plan trop court est refusé');
assert(validateSubscriptionInput({ ...valid, priceFcfa: 1.5 }).success === false, 'Un tarif décimal est refusé');
assert(validateSubscriptionInput({ ...valid, priceFcfa: -1 }).success === false, 'Un tarif négatif est refusé');
assert(validateSubscriptionInput({ ...valid, priceFcfa: 1000000001 }).success === false, 'Un tarif supérieur à la limite est refusé');
assert(validateSubscriptionInput({ ...valid, billingCycle: 'weekly' }).success === false, 'Une périodicité inconnue est refusée');
assert(validateSubscriptionInput({ ...valid, status: 'enabled' }).success === false, 'Un statut inconnu est refusé');
assert(validateSubscriptionInput({ ...valid, startsAt: 0 }).success === false, 'Une date de début invalide est refusée');
assert(validateSubscriptionInput({ ...valid, endsAt: valid.startsAt }).success === false, 'Une fin antérieure ou égale au début est refusée');

console.log('\nRésultats abonnements : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
if (failed > 0) process.exit(1);
