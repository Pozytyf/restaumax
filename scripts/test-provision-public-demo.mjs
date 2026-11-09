import { getPublicDemoProfiles, validatePublicDemoTarget } from './provision-public-demo-safe.mjs';

let passed = 0, failed = 0;
const assert = (ok, label) => { if (ok) { passed++; console.log('✓ '+label); } else { failed++; console.error('✗ '+label); } };
const credentials = { project_id:'restaumax-demo' };
assert(validatePublicDemoTarget({FIREBASE_PROJECT_ID:'restaumax-demo',FIRESTORE_DATABASE_ID:'(default)'}, credentials) === undefined, 'Cible Demo exacte acceptée');
for (const env of [
  {FIREBASE_PROJECT_ID:'gen-lang-client-0138815290',FIRESTORE_DATABASE_ID:'(default)'},
  {FIREBASE_PROJECT_ID:'restaumax-demo',FIRESTORE_DATABASE_ID:'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf'}
]) {
  let rejected = false; try { validatePublicDemoTarget(env, credentials); } catch { rejected = true; }
  assert(rejected, 'Toute cible Production ou base non-default rejetée');
}
let wrongCredentialRejected = false;
try { validatePublicDemoTarget({FIREBASE_PROJECT_ID:'restaumax-demo',FIRESTORE_DATABASE_ID:'(default)'}, {project_id:'gen-lang-client-0138815290'}); } catch { wrongCredentialRejected = true; }
assert(wrongCredentialRejected, 'Compte de service Production rejeté');
let wrongBranchRejected = false;
try { validatePublicDemoTarget({FIREBASE_PROJECT_ID:'restaumax-demo',FIRESTORE_DATABASE_ID:'(default)',GITHUB_REF:'refs/heads/main'}, credentials); } catch { wrongBranchRejected = true; }
assert(wrongBranchRejected, 'Exécution depuis main rejetée');
const profiles = getPublicDemoProfiles();
assert(profiles.length === 6, 'Six profils publics exactement');
assert(profiles.map(p=>p.role).join(',') === 'super_admin,owner,manager,cashier,server,kitchen', 'Les six rôles officiels sont présents dans l’ordre');
assert(profiles.every(p=>p.email.endsWith('@restaumax.test')), 'Toutes les adresses sont fictives en .test');
assert(profiles.filter(p=>p.role !== 'super_admin').every(p=>p.permissions.length > 0), 'Chaque rôle restaurant possède des permissions');
assert(profiles.find(p=>p.role==='kitchen').permissions.every(p=>!p.startsWith('reports.') && !p.startsWith('cash.')), 'Cuisine/Bar ne reçoit aucun droit financier');
console.log(`\nRésultat : ${passed} réussis / ${failed} échecs.`);
if (failed) process.exitCode = 1;
