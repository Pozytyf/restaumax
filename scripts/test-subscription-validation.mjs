import { readFileSync } from 'node:fs';
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
  endsAt: 1796515199999,
  notes: 'Essai commercial'
};

console.log('\n--- Validation des abonnements plateforme ---');
const validResult = validateSubscriptionInput(valid);
assert(validResult.success === true, 'Un abonnement mensuel valide est accepté');
assert(validateSubscriptionInput({ ...valid, billingCycle: 'quarterly', endsAt: Date.UTC(2027, 1, 5, 23, 59, 59, 999) }).success === true, 'Un abonnement trimestriel valide est accepté');
assert(validateSubscriptionInput({ ...valid, billingCycle: 'yearly', endsAt: Date.UTC(2027, 10, 5, 23, 59, 59, 999) }).success === true, 'Un abonnement annuel valide est accepté');
assert(validateSubscriptionInput({ ...valid, endsAt: Date.UTC(2026, 10, 19, 23, 59, 59, 999) }).success === false, 'Une période mensuelle qui ne correspond pas à un mois civil est refusée');
assert(validateSubscriptionInput({ ...valid, endsAt: Number.MAX_SAFE_INTEGER }).success === false, 'Une date hors plage calendaire est refusée sans erreur serveur');
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
assert(validateSubscriptionInput({ ...valid, gracePeriodDays: 61 }).success === false, 'Un délai de grâce supérieur à 60 jours est refusé');
assert(validateSubscriptionInput({ ...valid, nextBillingAt: -1 }).success === false, 'Une prochaine échéance invalide est refusée');
assert(validateSubscriptionInput({ ...valid, nextBillingAt: valid.endsAt + 86400000 }).success === false, 'La prochaine échéance doit correspondre exactement à la fin de période contractuelle');
assert(validateSubscriptionInput({ ...valid, billingCycle: 'custom' }).success === false, 'Un cycle personnalisé ne peut pas activer le renouvellement automatique');
assert(validateSubscriptionInput({ ...valid, billingCycle: 'custom', autoRenew: false }).success === true, 'Un cycle personnalisé sans renouvellement automatique est accepté');
const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const billingDocs = readFileSync(new URL('../docs/SUBSCRIPTION_BILLING_OPERATIONS.md', import.meta.url), 'utf8');
assert(vercelConfig.crons?.some(cron => cron.path === '/api/subscriptions/billing-cycle' && cron.schedule === '0 2 * * *'),
  'Le cycle de facturation est planifié chaque jour à 02:00 UTC');
assert(serverSource.includes('process.env.CRON_SECRET') && serverSource.includes('timingSafeEqual'),
  'Le point d’entrée Cron exige un secret comparé de façon sûre');
assert(billingDocs.includes('ne débite pas automatiquement') && billingDocs.includes('CRON_SECRET'),
  'Les limites de prélèvement et les conditions d’activation sont documentées');

console.log('\n--- Indicateurs d’abonnement plateforme ---');
const metrics = calculateSubscriptionMetrics([
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 12000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 120000, billingCycle: 'yearly' } },
  { status: 'active', subscription: { status: 'trial', endsAt: 2000000, priceFcfa: 0, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 500000, priceFcfa: 9000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'past_due', endsAt: 2000000, priceFcfa: 9000, billingCycle: 'monthly' } },
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 50000, billingCycle: 'custom' } },
  { status: 'active', subscription: { status: 'active', startsAt: 1000000, endsAt: 1000000 + 3 * 30.4375 * 86400000, priceFcfa: 9000, billingCycle: 'custom' } },
  { status: 'active', subscription: { status: 'active', endsAt: 2000000, priceFcfa: 30000, billingCycle: 'quarterly' } },
  { status: 'suspended' }
], 1000000);
assert(metrics.restaurantCount === 9, 'Le nombre total de restaurants est calculé');
assert(metrics.activeRestaurantCount === 8, 'Les restaurants suspendus sont exclus des établissements actifs');
assert(metrics.activeSubscriptionCount === 5, 'Les abonnements actifs non expirés sont comptabilisés');
assert(metrics.trialSubscriptionCount === 1, 'Les périodes d’essai valides sont comptabilisées séparément');
assert(metrics.attentionSubscriptionCount === 2, 'Les abonnements expirés et en retard sont signalés');
assert(metrics.estimatedMonthlyRevenue === 35000, 'Le MRR convertit les cycles mensuels, trimestriels, annuels et personnalisés datés en équivalent mensuel');

console.log('\nRésultats abonnements : ' + passed + '/' + (passed + failed) + ' réussis (' + failed + ' échec(s)).');
if (failed > 0) process.exit(1);
