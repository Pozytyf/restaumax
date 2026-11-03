import assert from 'node:assert/strict';
import {
  collectLegacyPrivateMetadata,
  mergePrivateOwnership,
  LEGACY_PRIVATE_FIELDS,
} from './restaurant-ownership-migration-utils.mjs';

const legacy = collectLegacyPrivateMetadata({
  slug: 'chez-awa',
  ownerUid: 'owner-uid',
  ownerName: 'Propriétaire',
  ownerEmail: 'owner@example.test',
  createdBy: 'admin-uid',
  updatedBy: 'admin-uid-2',
});

assert.deepEqual(Object.keys(legacy).sort(), [...LEGACY_PRIVATE_FIELDS].sort());
assert.equal(legacy.ownerUid, 'owner-uid');
assert.equal(legacy.createdBy, 'admin-uid');
assert.equal(legacy.updatedBy, 'admin-uid-2');
assert.deepEqual(collectLegacyPrivateMetadata({ slug: 'sans-identite' }), {});

const merged = mergePrivateOwnership(
  { ownerUid: 'owner-uid', ownerName: 'Nom privé', customPrivateField: true },
  { ownerUid: 'owner-uid', ownerName: 'Ancien nom public', ownerEmail: 'owner@example.test', createdBy: 'admin-uid' },
);
assert.equal(merged.ownerName, 'Nom privé', 'Existing private values must never be overwritten');
assert.equal(merged.ownerEmail, 'owner@example.test', 'Missing private values must be migrated');
assert.equal(merged.createdBy, 'admin-uid');
assert.equal(merged.customPrivateField, true, 'Unrelated private metadata must be preserved');

assert.throws(
  () => mergePrivateOwnership(
    { ownerUid: 'different-owner' },
    { ownerUid: 'legacy-owner' },
  ),
  /Conflit d’identité propriétaire/,
  'A conflicting owner identity must abort migration preflight',
);

console.log('Ownership migration utility tests passed.');
