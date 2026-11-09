import assert from 'node:assert/strict';
import { provisionExistingDemoOwner, validateProvisionTarget } from './provision-restaumax-demo-owner.mjs';

const TARGET = {
  projectId: 'restaumax-demo',
  firestoreDatabaseId: '(default)',
};
const OWNER_UID = 'DCL1JQ9KJydgkdDkEBVl5DKoLms1';
const OWNER_EMAIL = 'restaumax@hp-logistics.net';
const CONFIRMATION = 'PROVISION_RESTAUMAX_DEMO_OWNER';

function makeDb() {
  const records = new Map();
  let generated = 0;
  const snapshot = (path) => ({
    exists: records.has(path),
    data: () => records.get(path),
  });
  const collection = (path) => ({
    doc(id) {
      const docId = id || `generated-${++generated}`;
      const docPath = `${path}/${docId}`;
      return {
        id: docId,
        path: docPath,
        get: async () => snapshot(docPath),
        create: async (data) => {
          if (records.has(docPath)) {
            const error = new Error('already exists');
            error.code = 6;
            throw error;
          }
          records.set(docPath, data);
        },
        delete: async () => records.delete(docPath),
        collection: (name) => collection(`${docPath}/${name}`),
      };
    },
    get: async () => ({ docs: [], empty: true }),
  });
  return {
    databaseId: '(default)',
    collection,
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs: [], empty: true }) }) }),
    }),
    batch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ type: 'set', ref, data }),
        delete: (ref) => operations.push({ type: 'delete', ref }),
        commit: async () => {
          for (const op of operations) {
            if (op.type === 'set') records.set(op.ref.path, op.data);
            else records.delete(op.ref.path);
          }
        },
      };
    },
    records,
  };
}

function makeAuth(customClaims = {}) {
  const user = {
    uid: OWNER_UID,
    email: OWNER_EMAIL,
    displayName: 'RestauMax Demo Owner',
    disabled: false,
    customClaims,
  };
  return {
    user,
    getUser: async (uid) => {
      assert.equal(uid, OWNER_UID);
      return { ...user, customClaims: { ...user.customClaims } };
    },
    setCustomUserClaims: async (uid, claims) => {
      assert.equal(uid, OWNER_UID);
      user.customClaims = { ...claims };
    },
  };
}

assert.throws(() => validateProvisionTarget(
  { projectId: 'gen-lang-client-0138815290', firestoreDatabaseId: '(default)' },
  { FIREBASE_PROJECT_ID: 'restaumax-demo', FIRESTORE_DATABASE_ID: '(default)' },
), /Cible Firebase incorrecte/);
assert.equal(validateProvisionTarget(
  TARGET,
  { FIREBASE_PROJECT_ID: 'restaumax-demo', FIRESTORE_DATABASE_ID: '(default)' },
), true);

{
  const db = makeDb();
  const auth = makeAuth();
  const result = await provisionExistingDemoOwner({ auth, db });
  assert.equal(result.status, 'preflight-passed-no-writes');
  assert.equal(db.records.size, 0, 'dry-run must not write Firestore records');
  assert.deepEqual(auth.user.customClaims, {}, 'dry-run must not change Firebase Auth claims');
}

{
  const db = makeDb();
  const auth = makeAuth();
  const result = await provisionExistingDemoOwner({ auth, db, apply: true, confirmation: CONFIRMATION });
  assert.equal(result.status, 'created-and-verified');
  assert.equal(db.records.get('restaurants/restaumax-demo')?.status, 'active');
  assert.equal(db.records.get(`restaurants/restaumax-demo/private/ownership`)?.ownerUid, OWNER_UID);
  assert.equal(db.records.get(`managers/${OWNER_UID}`)?.restaurantSlug, 'restaumax-demo');
  assert.equal(db.records.get(`restaurants/restaumax-demo/staff/${OWNER_UID}`)?.role, 'owner');
  assert.equal(auth.user.customClaims.role, 'owner');
  assert.equal(auth.user.customClaims.restaurantSlug, 'restaumax-demo');
  const repeated = await provisionExistingDemoOwner({ auth, db, apply: true, confirmation: CONFIRMATION });
  assert.equal(repeated.status, 'already-provisioned-and-verified', 're-running must be idempotent');
}

{
  const db = makeDb();
  const auth = makeAuth();
  await assert.rejects(
    provisionExistingDemoOwner({ auth, db, apply: true, confirmation: 'wrong' }),
    /Confirmation explicite/,
  );
  assert.equal(db.records.size, 0, 'invalid confirmation must not write');
}

{
  const db = makeDb();
  const auth = makeAuth({ role: 'super_admin' });
  await assert.rejects(provisionExistingDemoOwner({ auth, db }), /administrateur plateforme/);
  assert.equal(db.records.size, 0);
}

{
  const db = makeDb();
  const auth = makeAuth();
  db.records.set('restaurants/restaumax-demo', { slug: 'restaumax-demo', name: 'Unexpected tenant' });
  await assert.rejects(provisionExistingDemoOwner({ auth, db }), /existe déjà/);
  assert.equal(db.records.get('restaurants/restaumax-demo').name, 'Unexpected tenant');
}

console.log('Demo owner provisioning tests passed: target guard, dry-run, apply, verification, idempotency, confirmation, admin rejection and collision protection.');
