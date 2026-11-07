import { resolveTableQrOrigin } from '../src/server/tableQrOrigin.ts';

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed += 1; console.log('  ✓ ' + label); }
  else { failed += 1; console.error('  ✗ ' + label); }
}

console.log('RESTAUMAX — TESTS DE COHÉRENCE DU DOMAINE QR / ENVIRONNEMENT');

const previewRequest = {
  headers: {
    origin: 'https://restaumax-git-fix-tenant-qr-origin-pozytyf.vercel.app',
    host: 'restaumax-git-fix-tenant-qr-origin-pozytyf.vercel.app',
    'x-forwarded-host': 'restaumax-git-fix-tenant-qr-origin-pozytyf.vercel.app',
    'x-forwarded-proto': 'https'
  }
};
assert(
  resolveTableQrOrigin(previewRequest, {
    VERCEL_ENV: 'preview',
    APP_ORIGIN: 'https://restaumax.vercel.app'
  }) === 'https://restaumax-git-fix-tenant-qr-origin-pozytyf.vercel.app',
  'Un QR Preview utilise le domaine Preview même si APP_ORIGIN désigne Production'
);

assert(
  resolveTableQrOrigin({
    headers: {
      origin: 'https://restaumax.vercel.app',
      host: 'restaumax.vercel.app',
      'x-forwarded-host': 'restaumax.vercel.app',
      'x-forwarded-proto': 'https'
    }
  }, {
    VERCEL_ENV: 'production',
    APP_ORIGIN: 'https://restaumax.vercel.app'
  }) === 'https://restaumax.vercel.app',
  'Production conserve son domaine canonique configuré'
);

assert(
  resolveTableQrOrigin({
    headers: {
      host: 'restaumax-preview.vercel.app',
      'x-forwarded-host': 'restaumax-preview.vercel.app',
      'x-forwarded-proto': 'https'
    }
  }, { VERCEL_ENV: 'preview', APP_ORIGIN: 'https://restaumax.vercel.app' }) === 'https://restaumax-preview.vercel.app',
  'Preview retrouve son hôte même si le navigateur ne transmet pas Origin'
);

let rejected = false;
try {
  resolveTableQrOrigin({ headers: {} }, { VERCEL_ENV: 'preview', APP_ORIGIN: 'https://restaumax.vercel.app' });
} catch {
  rejected = true;
}
assert(rejected, 'Preview refuse de créer un QR si son hôte réel est introuvable');

console.log(`Résultat : ${passed}/${passed + failed} tests validés.`);
if (failed > 0) process.exit(1);
