import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const port = Number(process.env.E2E_PORT || 4173);
const baseUrl = `http://127.0.0.1:${port}`;
const app = initializeApp({ projectId: firebaseConfig.projectId }, 'restaumax-client-e2e-' + Date.now());
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
// The public demo seed intentionally contains only client-facing restaurant fields.
// Complete the emulator-only operational state required by the trusted order service.
await db.collection('restaurants').doc('chez-awa').set({ status: 'active', isActive: true, isOpen: true }, { merge: true });
const server = spawn('npm', ['run', 'dev'], {
  env: {
    ...process.env,
    PORT: String(port),
    VITE_USE_FIREBASE_EMULATOR: 'true',
    VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIRESTORE_EMULATOR_PORT: '8080',
    VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let browser;
let firstOrderResponse = null;
let replayResponse = null;
let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('  ✓ ' + message);
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(1000);
  }
  throw new Error('Le serveur RestauMax local ne démarre pas : ' + String(lastError || 'timeout'));
}

async function checkA11y(page, name) {
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length) {
    console.error('Violations axe (' + name + '):', results.violations.map(v => ({
      id: v.id, impact: v.impact, description: v.description,
      nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary }))
    })));
  }
  check(results.violations.length === 0, 'Axe WCAG 2.1 AA sans violation sur la fenêtre ' + name);
}

try {
  server.stdout.on('data', chunk => process.stdout.write('[server] ' + chunk.toString()));
  server.stderr.on('data', chunk => process.stderr.write('[server] ' + chunk.toString()));
  await waitForServer();

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  page.setDefaultTimeout(20000);
  await page.goto(`${baseUrl}/r/chez-awa`, { waitUntil: 'domcontentloaded' });

  const dishCard = page.getByRole('button', { name: /Capitaine Braisé au Feu de Bois/ });
  await dishCard.waitFor({ state: 'visible' });
  check(await dishCard.isVisible(), 'Le menu du restaurant chargé depuis Firestore affiche un plat disponible');

  await dishCard.click();
  const productDialog = page.getByRole('dialog');
  await productDialog.waitFor({ state: 'visible' });
  await checkA11y(page, 'détail produit');

  const productButtons = productDialog.getByRole('button');
  const firstProductButton = productButtons.first();
  await productButtons.last().focus();
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement === document.querySelector('[role="dialog"] button:not([disabled])')),
    'Tab depuis le dernier contrôle revient au premier contrôle du détail produit');
  await page.keyboard.press('Shift+Tab');
  check(await productButtons.last().evaluate(element => element === document.activeElement),
    'Maj+Tab depuis le premier contrôle revient au dernier contrôle du détail produit');
  await page.keyboard.press('Escape');
  await productDialog.waitFor({ state: 'hidden' });
  check(true, 'Échap ferme le détail produit');

  await dishCard.click();
  await page.getByRole('button', { name: /Ajouter au panier/ }).click();
  check(await page.getByText(/Panier \(1\)/).first().isVisible(), 'Un plat configuré est ajouté au panier');
  await page.getByRole('button', { name: /Panier/ }).first().click();

  const cartDialog = page.getByRole('dialog');
  await cartDialog.waitFor({ state: 'visible' });
  await checkA11y(page, 'panier');
  check(await cartDialog.getByText('Poulet', { exact: false }).count() + await cartDialog.getByText('Capitaine', { exact: false }).count() > 0,
    'Le panier affiche le produit sélectionné');

  // The first request reaches Firestore and commits, but its HTTP response is deliberately
  // dropped to simulate a lost network response after a successful server write.
  await page.route('**/api/orders', async route => {
    const response = await route.fetch();
    firstOrderResponse = await response.json();
    await route.abort('failed');
  });
  await cartDialog.getByRole('button', { name: /Valider et commander à emporter/ }).click();
  await cartDialog.getByText(/Transmission incertaine/i).waitFor({ state: 'visible' });
  check(await cartDialog.getByText(/Transmission incertaine/i).isVisible(),
    'Une réponse réseau perdue est signalée comme transmission incertaine');
  check(await cartDialog.getByText('Poulet', { exact: false }).count() + await cartDialog.getByText('Capitaine', { exact: false }).count() > 0,
    'Le panier reste intact après une erreur réseau ambiguë');
  check(firstOrderResponse?.success === true && firstOrderResponse?.order?.id,
    'La première requête a bien été validée côté serveur avant la perte de réponse');

  await page.unroute('**/api/orders');
  await page.route('**/api/orders', async route => {
    const response = await route.fetch();
    replayResponse = await response.json();
    await route.fulfill({ response });
  });
  await cartDialog.getByRole('button', { name: /Réessayer la transmission/ }).click();

  await page.getByRole('heading', { name: /Votre commande est en cuisine/ }).waitFor({ state: 'visible' });
  check(replayResponse?.success === true && replayResponse?.idempotentReplay === true,
    'La reprise avec la même intention retourne la commande existante par idempotence');
  const persistedOrder = await db.collection('restaurants').doc('chez-awa')
    .collection('orders').doc(firstOrderResponse.order.id).get();
  check(persistedOrder.exists, 'La commande confirmée est persistée dans Firestore Emulator');
  const matchingOrders = await db.collection('restaurants').doc('chez-awa')
    .collection('orders').where('idempotencyKey', '==', firstOrderResponse.order.idempotencyKey).get();
  check(matchingOrders.size === 1, 'Une seule commande Firestore existe pour cette clé malgré la reprise réseau');

  const confirmationDialog = page.getByRole('dialog');
  await checkA11y(page, 'confirmation de commande');
  await page.keyboard.press('Escape');
  await confirmationDialog.waitFor({ state: 'hidden' });
  check(true, 'Échap ferme la confirmation sans altérer la commande enregistrée');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Capitaine Braisé au Feu de Bois/ }).waitFor({ state: 'visible' });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!horizontalOverflow, 'Le menu client ne déborde pas horizontalement sur un écran mobile de 390 px');

  console.log('RECETTE NAVIGATEUR CLIENT : ' + passed + '/' + passed + ' contrôles réussis.');
} catch (error) {
  console.error('ÉCHEC DE LA RECETTE NAVIGATEUR CLIENT :', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await app.delete().catch(() => {});
}
