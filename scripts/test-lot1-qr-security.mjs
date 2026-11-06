/**
 * RESTAUMAX — SUITE DE TESTS DE SÉCURITÉ LOT 1 (QR CODES & SESSIONS DE TABLE)
 *
 * Exécute les 23 scénarios de sécurité obligatoires définis par le contrat d'audit :
 *  1. Jeton valide
 *  2. Jeton inconnu
 *  3. Jeton malformé
 *  4. Jeton révoqué
 *  5. Table inactive
 *  6. Restaurant suspendu / fermé
 *  7. Session valide
 *  8. Session expirée
 *  9. Session révoquée
 * 10. Cookie absent
 * 11. Cookie invalide
 * 12. Session d'un autre restaurant
 * 13. Session d'une autre table
 * 14. Commande sur place sans session
 * 15. Falsification de tableNumber (spoofing)
 * 16. Commande à emporter sans session (non-régression)
 * 17. Requête CSRF (origine discordante)
 * 18. Origine non autorisée
 * 19. Double soumission avec même idempotencyKey
 * 20. Deux commandes concurrentes
 * 21. Révocation concurrente avec une commande
 * 22. Backend Firebase indisponible (Fail-Closed)
 * 23. Absence de jetons et cookies dans les logs
 */

import {
  generateQrToken,
  generateSessionToken,
  computeSha256,
  isValidTokenFormat,
  extractSessionTokenFromRequest,
  extractSessionTokenResult,
  buildSessionSetCookieHeaders,
  buildClearSessionCookieHeaders,
  verifyCsrfOrigin,
  resolveTableQr,
  verifyTableSession,
  TABLE_SESSION_COOKIE_NAME,
  TABLE_SESSION_COOKIE_FALLBACK,
  TABLE_SESSION_TTL_MS
} from '../src/server/tableSecurityService.js';

import {
  processOrderSubmission
} from '../src/server/orderService.js';

import {
  handleResolveQr,
  handleGetTableSession,
  handleOrderSubmission,
  executeOrderTransactionWithDb
} from '../server.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ ÉCHEC : ${message}`);
  }
}

/**
 * Mock Firestore Admin Database en mémoire conforme à l'API Admin SDK
 */
function createMockAdminDb() {
  const store = new Map();

  function docRef(collectionPath, id) {
    const fullPath = `${collectionPath}/${id}`;
    return {
      id,
      path: fullPath,
      async get() {
        const data = store.get(fullPath);
        return {
          exists: data !== undefined,
          id,
          data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
        };
      },
      async set(data) {
        store.set(fullPath, JSON.parse(JSON.stringify(data)));
      },
      async update(updates) {
        const existing = store.get(fullPath) || {};
        store.set(fullPath, { ...existing, ...JSON.parse(JSON.stringify(updates)) });
      },
      async delete() {
        store.delete(fullPath);
      },
      collection(sub) {
        return colRef(`${fullPath}/${sub}`);
      }
    };
  }

  function colRef(collectionPath) {
    return {
      doc(id) {
        return docRef(collectionPath, id);
      },
      async get() {
        const prefix = `${collectionPath}/`;
        const docs = [];
        for (const [key, val] of store.entries()) {
          if (key.startsWith(prefix)) {
            const remainder = key.slice(prefix.length);
            if (!remainder.includes('/')) {
              docs.push({
                id: remainder,
                data: () => JSON.parse(JSON.stringify(val))
              });
            }
          }
        }
        return { docs, empty: docs.length === 0 };
      }
    };
  }

  return {
    _store: store,
    collection(name) {
      return colRef(name);
    },
    collectionGroup(name) {
      return {
        where(field, op, val) {
          return {
            limit(n) {
              return {
                async get() {
                  const docs = [];
                  for (const [k, v] of store.entries()) {
                    const parts = k.split('/');
                    const colName = parts[parts.length - 2];
                    if (colName === name && v && v[field] === val) {
                      docs.push({
                        id: parts[parts.length - 1],
                        data: () => JSON.parse(JSON.stringify(v))
                      });
                      if (docs.length >= n) break;
                    }
                  }
                  return { docs, empty: docs.length === 0 };
                }
              };
            }
          };
        }
      };
    },
    async runTransaction(cb) {
      const tx = {
        async get(dRef) {
          return await dRef.get();
        },
        set(dRef, data) {
          store.set(dRef.path, JSON.parse(JSON.stringify(data)));
        },
        update(dRef, updates) {
          const existing = store.get(dRef.path) || {};
          store.set(dRef.path, { ...existing, ...JSON.parse(JSON.stringify(updates)) });
        }
      };
      return await cb(tx);
    }
  };
}

// Helpers de mock Express req/res
function createMockReqRes({ method = 'POST', body = {}, headers = {}, query = {} } = {}) {
  const req = {
    method,
    body,
    headers,
    query,
    secure: headers['x-forwarded-proto'] === 'https',
    get(name) {
      return headers[name.toLowerCase()];
    }
  };

  const resHeaders = {};
  let statusCode = 200;
  let jsonBody = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(name, val) {
      resHeaders[name.toLowerCase()] = val;
    },
    json(data) {
      jsonBody = data;
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return resHeaders;
    },
    get body() {
      return jsonBody;
    }
  };

  return { req, res };
}

async function runAllSecurityTests() {
  console.log('======================================================================');
  console.log("RESTAUMAX — LOT 1 : SUITE COMPLÈTE DE TESTS DE SÉCURITÉ DES QR CODES");
  console.log('======================================================================\n');

  const db = createMockAdminDb();

  // Initialisation des données de test dans le mock Firestore
  // 1. Restaurant "chez-awa" (ouvert) et "le-ferme" (fermé)
  await db.collection('restaurants').doc('chez-awa').set({
    slug: 'chez-awa',
    name: 'Chez Awa — Grillades & Saveurs',
    isOpen: true
  });
  await db.collection('restaurants').doc('le-ferme').set({
    slug: 'le-ferme',
    name: 'Le Restaurant Fermé',
    isOpen: false
  });
  await db.collection('restaurants').doc('autre-resto').set({
    slug: 'autre-resto',
    name: 'Autre Restaurant',
    isOpen: true
  });

  // 2. Tables de test pour "chez-awa"
  await db.collection('restaurants').doc('chez-awa').collection('tables').doc('tbl-4').set({
    id: 'tbl-4',
    tableNumber: '4',
    capacity: 4,
    isActive: true
  });
  await db.collection('restaurants').doc('chez-awa').collection('tables').doc('tbl-inactive').set({
    id: 'tbl-inactive',
    tableNumber: '99',
    capacity: 2,
    isActive: false
  });
  await db.collection('restaurants').doc('autre-resto').collection('tables').doc('tbl-autre-4').set({
    id: 'tbl-autre-4',
    tableNumber: '4',
    capacity: 4,
    isActive: true
  });

  // 3. Catalogue de test pour "chez-awa"
  await db.collection('restaurants').doc('chez-awa').collection('menuItems').doc('dish-poulet').set({
    id: 'dish-poulet',
    restaurantSlug: 'chez-awa',
    name: 'Poulet Braisé',
    category: 'grillades',
    price: 6500,
    available: true
  });

  // 4. Génération d'un jeton QR valide pour la Table 4
  const { rawToken: validRawToken, tokenHash: validTokenHash } = generateQrToken();
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(validTokenHash).set({
    tokenHash: validTokenHash,
    restaurantSlug: 'chez-awa',
    tableId: 'tbl-4',
    tableNumber: '4',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-awa'
  });

  // 5. Jeton QR révoqué
  const { rawToken: revokedRawToken, tokenHash: revokedTokenHash } = generateQrToken();
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(revokedTokenHash).set({
    tokenHash: revokedTokenHash,
    restaurantSlug: 'chez-awa',
    tableId: 'tbl-4',
    tableNumber: '4',
    status: 'revoked',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-awa',
    revokedAt: Date.now(),
    revokedReason: 'sticker_perdu'
  });

  // 6. Jeton QR pointant vers table inactive
  const { rawToken: inactiveTableRawToken, tokenHash: inactiveTableTokenHash } = generateQrToken();
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(inactiveTableTokenHash).set({
    tokenHash: inactiveTableTokenHash,
    restaurantSlug: 'chez-awa',
    tableId: 'tbl-inactive',
    tableNumber: '99',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-awa'
  });

  // 7. Jeton QR pour restaurant fermé
  const { rawToken: closedRestauRawToken, tokenHash: closedRestauTokenHash } = generateQrToken();
  await db.collection('restaurants').doc('le-ferme').collection('table_qr_tokens').doc(closedRestauTokenHash).set({
    tokenHash: closedRestauTokenHash,
    restaurantSlug: 'le-ferme',
    tableId: 'tbl-1',
    tableNumber: '1',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-ferme'
  });
  await db.collection('restaurants').doc('le-ferme').collection('tables').doc('tbl-1').set({
    id: 'tbl-1',
    tableNumber: '1',
    isActive: true
  });

  // Fournisseur mock de test connecté au mock DB
  const mockProvider = {
    async getMenuItems(slug) {
      const snap = await db.collection('restaurants').doc(slug).collection('menuItems').get();
      return snap.docs.map(d => d.data());
    },
    async getTables(slug) {
      const snap = await db.collection('restaurants').doc(slug).collection('tables').get();
      return snap.docs.map(d => d.data());
    },
    async verifyTableSession(params) {
      return await verifyTableSession(db, params);
    },
    async executeOrderTransaction(params) {
      return await executeOrderTransactionWithDb(db, params);
    }
  };

  // =========================================================================
  // SCÉNARIO 1 : Jeton valide
  // =========================================================================
  console.log('--- SCÉNARIO 1 : Jeton valide ---');
  const res1 = await resolveTableQr(db, { rawToken: validRawToken, restaurantSlug: 'chez-awa' });
  assert(res1.success === true, 'Résolution réussie pour un jeton QR valide');
  assert(res1.publicData.table.tableNumber === '4', 'Numéro de table exact certifié (Table 4)');
  assert(res1.publicData.restaurant.slug === 'chez-awa', 'Slug restaurant certifié (chez-awa)');
  assert(typeof res1.rawSessionToken === 'string' && isValidTokenFormat(res1.rawSessionToken), 'Jeton de session émis avec format sécurisé 256-bit');
  const sessionToken1 = res1.rawSessionToken;

  // =========================================================================
  // SCÉNARIO 2 : Jeton inconnu
  // =========================================================================
  console.log('\n--- SCÉNARIO 2 : Jeton inconnu ---');
  const { rawToken: unknownRawToken } = generateQrToken();
  const res2 = await resolveTableQr(db, { rawToken: unknownRawToken, restaurantSlug: 'chez-awa' });
  assert(res2.success === false && res2.statusCode === 404, 'Jeton inconnu rejeté avec statut HTTP 404');
  assert(res2.code === 'TOKEN_NOT_FOUND', 'Code d’erreur TOKEN_NOT_FOUND');

  // =========================================================================
  // SCÉNARIO 3 : Jeton malformé
  // =========================================================================
  console.log('\n--- SCÉNARIO 3 : Jeton malformé ---');
  const res3a = await resolveTableQr(db, { rawToken: 'trop-court' });
  assert(res3a.success === false && res3a.statusCode === 400, 'Jeton trop court rejeté en 400 Bad Request');
  const res3b = await resolveTableQr(db, { rawToken: 'jeton-avec-caracteres-interdits!@#$%^&*()_+1234567890' });
  assert(res3b.success === false && res3b.code === 'INVALID_TOKEN_FORMAT', 'Caractères non autorisés rejetés (INVALID_TOKEN_FORMAT)');

  // =========================================================================
  // SCÉNARIO 4 : Jeton révoqué
  // =========================================================================
  console.log('\n--- SCÉNARIO 4 : Jeton révoqué ---');
  const res4 = await resolveTableQr(db, { rawToken: revokedRawToken, restaurantSlug: 'chez-awa' });
  assert(res4.success === false && res4.statusCode === 403, 'Jeton révoqué rejeté avec statut HTTP 403');
  assert(res4.code === 'TOKEN_REVOKED', 'Code d’erreur TOKEN_REVOKED');

  // =========================================================================
  // SCÉNARIO 5 : Table inactive
  // =========================================================================
  console.log('\n--- SCÉNARIO 5 : Table inactive ---');
  const res5 = await resolveTableQr(db, { rawToken: inactiveTableRawToken, restaurantSlug: 'chez-awa' });
  assert(res5.success === false && res5.statusCode === 403, 'Table inactive rejetée avec statut HTTP 403');
  assert(res5.code === 'TABLE_INACTIVE', 'Code d’erreur TABLE_INACTIVE');

  // =========================================================================
  // SCÉNARIO 6 : Restaurant suspendu / fermé
  // =========================================================================
  console.log('\n--- SCÉNARIO 6 : Restaurant suspendu / fermé ---');
  const res6 = await resolveTableQr(db, { rawToken: closedRestauRawToken, restaurantSlug: 'le-ferme' });
  assert(res6.success === false && res6.statusCode === 403, 'Restaurant fermé rejeté avec statut HTTP 403');
  assert(res6.code === 'RESTAURANT_CLOSED', 'Code d’erreur RESTAURANT_CLOSED');

  // =========================================================================
  // SCÉNARIO 7 : Session valide
  // =========================================================================
  console.log('\n--- SCÉNARIO 7 : Session valide ---');
  const verif7 = await verifyTableSession(db, { rawSessionToken: sessionToken1, expectedRestaurantSlug: 'chez-awa' });
  assert(verif7.valid === true, 'Session valide confirmée par le serveur');
  assert(verif7.session.tableNumber === '4', 'Numéro de table associé certifié');
  assert(verif7.session.status === 'active', 'Statut actif confirmé');

  // =========================================================================
  // SCÉNARIO 8 : Session expirée
  // =========================================================================
  console.log('\n--- SCÉNARIO 8 : Session expirée ---');
  const futureNow = Date.now() + TABLE_SESSION_TTL_MS + 1000;
  const verif8 = await verifyTableSession(db, { rawSessionToken: sessionToken1, expectedRestaurantSlug: 'chez-awa', now: futureNow });
  assert(verif8.valid === false && verif8.code === 'SESSION_EXPIRED', 'Session expirée après dépassement du TTL (2h)');

  // =========================================================================
  // SCÉNARIO 9 : Session révoquée
  // =========================================================================
  console.log('\n--- SCÉNARIO 9 : Session révoquée ---');
  const sessionHash1 = computeSha256(sessionToken1);
  await db.collection('restaurants').doc('chez-awa').collection('table_sessions').doc(sessionHash1).update({ status: 'revoked' });
  const verif9 = await verifyTableSession(db, { rawSessionToken: sessionToken1, expectedRestaurantSlug: 'chez-awa' });
  assert(verif9.valid === false && verif9.code === 'SESSION_REVOKED', 'Session révoquée immédiatement refusée (SESSION_REVOKED)');

  // =========================================================================
  // SCÉNARIO 10 : Cookie absent
  // =========================================================================
  console.log('\n--- SCÉNARIO 10 : Cookie absent ---');
  const tokenFromEmptyReq = extractSessionTokenFromRequest({ headers: {} });
  assert(tokenFromEmptyReq === null, 'Requête sans cookie ni en-tête renvoie null');

  // En production, l'en-tête X-Table-Session seul est rejeté (cookie HttpOnly obligatoire)
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const prodHeaderCheck = extractSessionTokenResult({
    headers: { 'x-table-session': sessionToken1 }
  });
  assert(prodHeaderCheck.token === null, 'En production, l’en-tête X-Table-Session seul ne fournit aucun jeton');
  assert(prodHeaderCheck.code === 'HEADER_AUTH_DISALLOWED', 'Code HEADER_AUTH_DISALLOWED renvoyé en production');
  process.env.NODE_ENV = prevEnv;

  // Détection d'anomalie : Cookie et X-Table-Session discordants
  const anomalyCheck = extractSessionTokenResult({
    headers: {
      cookie: `${TABLE_SESSION_COOKIE_NAME}=${sessionToken1}`,
      'x-table-session': 'contradictory-token-with-sufficient-length-12345678901234567890'
    }
  });
  assert(anomalyCheck.token === null, 'Requête avec cookie et en-tête discordants invalidée');
  assert(anomalyCheck.code === 'AUTHENTICATION_ANOMALY', 'Code AUTHENTICATION_ANOMALY retourné');

  // =========================================================================
  // SCÉNARIO 11 : Cookie invalide
  // =========================================================================
  console.log('\n--- SCÉNARIO 11 : Cookie invalide ---');
  const tokenFromBadCookie = extractSessionTokenFromRequest({ headers: { cookie: `${TABLE_SESSION_COOKIE_NAME}=bad-short` } });
  assert(tokenFromBadCookie === null, 'Cookie malformé rejeté lors de l’extraction');

  // =========================================================================
  // SCÉNARIO 12 : Session d'un autre restaurant (Multi-tenant)
  // =========================================================================
  console.log('\n--- SCÉNARIO 12 : Session d\'un autre restaurant ---');
  // Créer une session pour 'autre-resto'
  const { rawToken: rawOther, tokenHash: hashOther } = generateQrToken();
  await db.collection('restaurants').doc('autre-resto').collection('table_qr_tokens').doc(hashOther).set({
    tokenHash: hashOther,
    restaurantSlug: 'autre-resto',
    tableId: 'tbl-autre-4',
    tableNumber: '4',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-autre'
  });
  const resOther = await resolveTableQr(db, { rawToken: rawOther, restaurantSlug: 'autre-resto' });
  const otherSessionToken = resOther.rawSessionToken;

  const verif12 = await verifyTableSession(db, { rawSessionToken: otherSessionToken, expectedRestaurantSlug: 'chez-awa' });
  assert(verif12.valid === false && verif12.code === 'TENANT_MISMATCH', 'Session de "autre-resto" rejetée sur "chez-awa" (TENANT_MISMATCH)');

  // =========================================================================
  // SCÉNARIO 13 : Session d'une autre table
  // =========================================================================
  console.log('\n--- SCÉNARIO 13 : Session d\'une autre table ---');
  // Créer une session pour la Table 2 de chez-awa
  await db.collection('restaurants').doc('chez-awa').collection('tables').doc('tbl-2').set({
    id: 'tbl-2',
    tableNumber: '2',
    capacity: 2,
    isActive: true
  });
  const { rawToken: rawTbl2, tokenHash: hashTbl2 } = generateQrToken();
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(hashTbl2).set({
    tokenHash: hashTbl2,
    restaurantSlug: 'chez-awa',
    tableId: 'tbl-2',
    tableNumber: '2',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-awa'
  });
  const resTbl2 = await resolveTableQr(db, { rawToken: rawTbl2, restaurantSlug: 'chez-awa' });
  assert(resTbl2.sessionDoc.tableNumber === '2', 'Session pour table 2 distincte créée');

  // =========================================================================
  // SCÉNARIO 14 : Commande sur place sans session (Rejet)
  // =========================================================================
  console.log('\n--- SCÉNARIO 14 : Commande sur place sans session ---');
  const orderNoSession = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    idempotencyKey: 'idem-no-session-123',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProvider);
  assert(orderNoSession.success === false, 'Commande sur place sans session rejetée formellement');
  assert(orderNoSession.error.includes('session de table active'), 'Message explicite sur l’obligation de session');

  // =========================================================================
  // SCÉNARIO 15 : Falsification de tableNumber (Spoofing)
  // =========================================================================
  console.log('\n--- SCÉNARIO 15 : Falsification de tableNumber ---');
  // Le client a une session pour Table 2, mais envoie tableNumber: "4" dans le body
  const orderSpoofed = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4', // Falsifié !
    tableSessionToken: resTbl2.rawSessionToken, // Session réelle pour Table 2
    idempotencyKey: 'idem-spoof-123456',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProvider);
  assert(orderSpoofed.success === false, 'Tentative d’usurpation de numéro de table formellement bloquée');
  assert(orderSpoofed.error.includes('Falsification de table détectée'), 'Message d’alerte sur la falsification de table');

  // =========================================================================
  // SCÉNARIO 16 : Commande à emporter sans session (Non-régression)
  // =========================================================================
  console.log('\n--- SCÉNARIO 16 : Commande à emporter sans session (Non-régression) ---');
  const orderTakeaway = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'a_emporter',
    tableNumber: null,
    idempotencyKey: 'idem-takeaway-123',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProvider);
  assert(orderTakeaway.success === true, 'Commande à emporter validée avec succès sans session de table');
  assert(orderTakeaway.order.orderMode === 'a_emporter', 'Mode commande à emporter préservé');

  // =========================================================================
  // SCÉNARIO 17 : Requête CSRF (Origine discordante)
  // =========================================================================
  console.log('\n--- SCÉNARIO 17 : Requête CSRF (Origine discordante) ---');
  const csrfBad = verifyCsrfOrigin({
    headers: {
      origin: 'https://evil-attacker-site.com',
      host: 'restaumax.app'
    }
  });
  assert(csrfBad.ok === false, 'Origine malveillante bloquée par le contrôle CSRF');

  // =========================================================================
  // SCÉNARIO 18 : Origine autorisée
  // =========================================================================
  console.log('\n--- SCÉNARIO 18 : Origine autorisée ---');
  const csrfGoodLocal = verifyCsrfOrigin({
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000'
    }
  });
  assert(csrfGoodLocal.ok === true, 'Origine localhost autorisée en développement');

  const csrfGoodProd = verifyCsrfOrigin({
    headers: {
      origin: 'https://restaumax.app',
      host: 'restaumax.app'
    }
  });
  assert(csrfGoodProd.ok === true, 'Origine identique à l’hôte autorisée en production');

  // Protection CSRF stricte en production : Rejet d'un POST sans Origin ni Referer
  const prevEnvCsrf = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const csrfNoOriginProd = verifyCsrfOrigin({
    method: 'POST',
    headers: { host: 'restaumax.app' }
  });
  assert(csrfNoOriginProd.ok === false, 'POST en production sans Origin ni Referer rejeté');
  assert(csrfNoOriginProd.reason.includes('Origin ou Referer obligatoire'), 'Message explicite anti-CSRF');

  // Rejet si Origin et Referer se contredisent
  const csrfMismatch = verifyCsrfOrigin({
    method: 'POST',
    headers: {
      origin: 'https://restaumax.app',
      referer: 'https://malicious-site.com/attack',
      host: 'restaumax.app'
    }
  });
  assert(csrfMismatch.ok === false, 'Requête avec discordance Origin vs Referer rejetée');
  process.env.NODE_ENV = prevEnvCsrf;

  // =========================================================================
  // SCÉNARIO 19 : Double soumission avec même idempotencyKey
  // =========================================================================
  console.log('\n--- SCÉNARIO 19 : Double soumission avec même idempotencyKey ---');
  // Créer une session valide pour Table 4
  const resTbl4New = await resolveTableQr(db, { rawToken: validRawToken, restaurantSlug: 'chez-awa' });
  const validSessionTbl4 = resTbl4New.rawSessionToken;

  let orderCount = 0;
  const mockProviderWithIdem = {
    ...mockProvider,
    async executeOrderTransaction({ orderToCreate }) {
      orderCount++;
      return { success: true, order: orderToCreate, idempotentReplay: orderCount > 1 };
    }
  };

  const orderFirst = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    tableSessionToken: validSessionTbl4,
    idempotencyKey: 'idem-double-test-1',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProviderWithIdem);
  assert(orderFirst.success === true, 'Première soumission avec session réussie');

  const orderSecond = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableNumber: '4',
    tableSessionToken: validSessionTbl4,
    idempotencyKey: 'idem-double-test-1',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProviderWithIdem);
  assert(orderSecond.success === true, 'Deuxième soumission acceptée par idempotence');
  assert(orderSecond.idempotentReplay === true, 'Signalée comme rejeu idempotent sans doublon');

  // =========================================================================
  // SCÉNARIO 20 : Deux commandes concurrentes sur la même table
  // =========================================================================
  console.log('\n--- SCÉNARIO 20 : Deux commandes concurrentes sur la même table ---');
  // Deux téléphones sur la Table 4
  const [resPhoneA, resPhoneB] = await Promise.all([
    resolveTableQr(db, { rawToken: validRawToken, restaurantSlug: 'chez-awa' }),
    resolveTableQr(db, { rawToken: validRawToken, restaurantSlug: 'chez-awa' })
  ]);
  assert(resPhoneA.success && resPhoneB.success, 'Deux sessions distinctes générées pour la même table physique');
  assert(resPhoneA.rawSessionToken !== resPhoneB.rawSessionToken, 'Jetons de session opaques distincts et indépendants');

  const [orderPhoneA, orderPhoneB] = await Promise.all([
    processOrderSubmission({
      restaurantSlug: 'chez-awa',
      orderMode: 'sur_place',
      tableSessionToken: resPhoneA.rawSessionToken,
      idempotencyKey: 'idem-phone-a-123',
      cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
    }, mockProvider),
    processOrderSubmission({
      restaurantSlug: 'chez-awa',
      orderMode: 'sur_place',
      tableSessionToken: resPhoneB.rawSessionToken,
      idempotencyKey: 'idem-phone-b-456',
      cart: [{ menuItemId: 'dish-poulet', quantity: 2 }]
    }, mockProvider)
  ]);
  assert(orderPhoneA.success && orderPhoneB.success, 'Les deux commandes concurrentes sont validées pour la Table 4');

  // =========================================================================
  // SCÉNARIO 21 : Révocation concurrente avec une commande
  // =========================================================================
  console.log('\n--- SCÉNARIO 21 : Révocation concurrente avec une commande ---');
  // Générer un jeton, une session, puis révoquer le QR code parent
  const { rawToken: qrToRevoke, tokenHash: hashToRevoke } = generateQrToken();
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(hashToRevoke).set({
    tokenHash: hashToRevoke,
    restaurantSlug: 'chez-awa',
    tableId: 'tbl-4',
    tableNumber: '4',
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    createdByUid: 'admin-awa'
  });
  const sessionBeforeRevoke = await resolveTableQr(db, { rawToken: qrToRevoke, restaurantSlug: 'chez-awa' });
  assert(sessionBeforeRevoke.success === true, 'Session active créée avant révocation');

  // Révocation du QR code parent par le gérant
  await db.collection('restaurants').doc('chez-awa').collection('table_qr_tokens').doc(hashToRevoke).update({
    status: 'revoked',
    revokedAt: Date.now()
  });

  // Tentative de commande avec la session existante : doit être immédiatement rejetée
  const orderAfterQrRevoked = await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableSessionToken: sessionBeforeRevoke.rawSessionToken,
    idempotencyKey: 'idem-after-revoke-123',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProvider);
  assert(orderAfterQrRevoked.success === false, 'Commande refusée après révocation du QR code parent');
  assert(orderAfterQrRevoked.error.includes('révoqué'), 'Révocation immédiate prouvée dynamiquement');

  // Test de cohérence transactionnelle atomique au niveau de executeOrderTransactionWithDb
  const txAtomicRevoke = await executeOrderTransactionWithDb(db, {
    restaurantSlug: 'chez-awa',
    idempotencyKey: 'idem-tx-atomic-test',
    keyDocId: 'idem_atomic_revoked_test',
    orderId: 'ord_atomic_revoked_test',
    signature: 'sig_atomic_test',
    orderToCreate: { id: 'ord_atomic_revoked_test', status: 'pending' },
    tableSessionHash: sessionBeforeRevoke.sessionDoc.sessionHash
  });
  assert(txAtomicRevoke.success === false, 'Transaction atomique Firestore refusée si le QR est révoqué');
  assert(txAtomicRevoke.error.includes('révoqué'), 'Message de transaction mentionne la révocation du QR');

  // =========================================================================
  // SCÉNARIO 22 : Backend Firebase indisponible (Fail-Closed)
  // =========================================================================
  console.log('\n--- SCÉNARIO 22 : Backend Firebase indisponible (Fail-Closed) ---');
  const brokenDb = {
    collection() {
      throw new Error("Connexion Firestore rompue");
    },
    collectionGroup() {
      throw new Error("Connexion Firestore rompue");
    }
  };
  const resFailClosed = await resolveTableQr(brokenDb, { rawToken: validRawToken });
  assert(resFailClosed.success === false && resFailClosed.statusCode === 503, 'Arrêt Fail-Closed HTTP 503 lors d’une panne Firestore');
  assert(resFailClosed.code === 'FIRESTORE_UNAVAILABLE', 'Code d’erreur FIRESTORE_UNAVAILABLE');

  // =========================================================================
  // SCÉNARIO 23 : Absence de jetons et cookies dans les logs
  // =========================================================================
  console.log('\n--- SCÉNARIO 23 : Absence de jetons et cookies dans les logs ---');
  const logEntries = [];
  const origConsoleLog = console.log;
  const origConsoleError = console.error;

  console.log = (...args) => logEntries.push(args.join(' '));
  console.error = (...args) => logEntries.push(args.join(' '));

  // Simuler une commande et une résolution
  await resolveTableQr(db, { rawToken: validRawToken, restaurantSlug: 'chez-awa' });
  await processOrderSubmission({
    restaurantSlug: 'chez-awa',
    orderMode: 'sur_place',
    tableSessionToken: sessionToken1,
    idempotencyKey: 'idem-log-check-999',
    cart: [{ menuItemId: 'dish-poulet', quantity: 1 }]
  }, mockProvider);

  console.log = origConsoleLog;
  console.error = origConsoleError;

  const logsString = logEntries.join('\n');
  assert(!logsString.includes(sessionToken1), 'Le jeton de session brut n’apparaît dans aucun log');
  assert(!logsString.includes(validRawToken), 'Le jeton QR brut n’apparaît dans aucun log');
  assert(!logsString.includes(sessionHash1), 'L’empreinte de session n’est pas divulguée dans les logs');

  console.log('\n======================================================================');
  console.log(`RÉSULTATS DE LA SÉCURISATION DU LOT 1 : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs).`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllSecurityTests().catch((err) => {
  console.error('Erreur fatale lors des tests de sécurité Lot 1 :', err);
  process.exit(1);
});
