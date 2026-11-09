import assert from 'node:assert/strict';
import { findRequiredOrdersIndex, isRequiredOrdersIndexReady } from './check-firestore-index.mjs';

const ready = [{
  collectionGroup: 'orders',
  queryScope: 'COLLECTION',
  state: 'READY',
  fields: [
    { fieldPath: 'customerPhoneNormalized', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' }
  ]
}];
assert.equal(findRequiredOrdersIndex(ready), ready[0], 'implicit __name__ field is ignored');
assert.equal(isRequiredOrdersIndexReady(ready), true, 'READY index is accepted');

const creating = [{ ...ready[0], state: 'CREATING' }];
assert.equal(findRequiredOrdersIndex(creating), creating[0], 'existing CREATING index is recognized');
assert.equal(isRequiredOrdersIndexReady(creating), false, 'CREATING index is not reported READY');

assert.equal(findRequiredOrdersIndex([{ ...ready[0], fields: ready[0].fields.slice(0, 2).reverse() }]), null,
  'field order mismatch is rejected');
assert.equal(findRequiredOrdersIndex([{ ...ready[0], collectionGroup: 'payments' }]), null,
  'wrong collection group is rejected');
assert.equal(findRequiredOrdersIndex([{ ...ready[0], fields: [...ready[0].fields, { fieldPath: 'extra', order: 'ASCENDING' }] }]), null,
  'unexpected indexed fields are rejected');

console.log('Firestore composite index readiness matching tests passed.');
