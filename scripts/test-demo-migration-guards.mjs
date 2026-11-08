import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEMO_TARGET, validateDemoMigrationTarget } from './migrate-legacy-restaurant-private-data-demo.mjs';

assert.deepEqual(DEMO_TARGET, { projectId: 'restaumax-demo', databaseId: '(default)' });
assert.equal(validateDemoMigrationTarget({
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: '(default)',
}), true);
assert.throws(() => validateDemoMigrationTarget({
  FIREBASE_PROJECT_ID: 'gen-lang-client-0138815290',
  FIRESTORE_DATABASE_ID: 'ai-studio-restomax-85affd15-48b4-463e-b365-b881673ebbcf',
}), /FIREBASE_PROJECT_ID doit être exactement/);
assert.throws(() => validateDemoMigrationTarget({
  FIREBASE_PROJECT_ID: 'restaumax-demo',
  FIRESTORE_DATABASE_ID: 'production',
}), /FIRESTORE_DATABASE_ID doit être exactement/);

const source = await readFile(new URL('./migrate-legacy-restaurant-private-data-demo.mjs', import.meta.url), 'utf8');
assert.match(source, /MIGRATE_RESTAUMAX_DEMO_PRIVATE_METADATA/);
assert.match(source, /admin_audit_logs/);
assert.match(source, /privateFields/);
assert.match(source, /FieldValue\.delete\(\)/);
assert.match(source, /getFirestore\(app, DEMO_TARGET\.databaseId\)/);
console.log('Demo historical migration guards: OK.');
