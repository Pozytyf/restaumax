import { validateSubscriptionInput } from '../src/server/subscriptionService.ts';
import { calculateSubscriptionMetrics } from '../src/lib/subscriptionMetrics.ts';

let passed = 0;
let failed = 0;
const assert = (condition, label) => {
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

console.log('\n--- Indicateurs d’abonnement plateforme ---');
const metrics = calculateSubscriptionMetrics([
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 12000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 120000, billingCycle: 'yearly' } },
  { status: 'active', subscription: { status: 'trial', endsAt: 2000000, priceFcfa: 0, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 500000, priceFcfa: 9000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'past_due', endsAt: 2000000, priceFcfa: 9000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 50000, billingCycle: 'custom' } },
  { status: 'suspended' }
], 1000000);
assert(metrics.restaurantCount === 7, 'Le nombre total de restaurants est calculé');
assert(metrics.activeRestaurantCount === 6, 'Les restaurants suspendus sont exclus des établissements actifs');
assert(metrics.activeSubscriptionCount === 3, 'Les abonnements actifs non expirés sont comptabilisés');
assert(metrics.trialSubscriptionCount === 1, 'Les périodes d’essai valides sont comptabilisées séparément');
assert(metrics.attentionSubscriptionCount === 2, 'Les abonnements expirés et en retard sont signalés');
assert(metrics.estimatedMonthlyRevenue === 22000, 'Le MRR estime les plans mensuels et annualise les plans annuels, sans compter les essais ni les personnalisés');

console.log('\nRésultats abonnements : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
if (failed > 0) process.exit(1);
