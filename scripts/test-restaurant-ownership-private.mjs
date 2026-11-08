import assert from 'node:assert/strict';
import { getRestaurantOwnership, getRestaurantOwnerUid } from '../src/server/restaurantOwnership.ts';
import fs from 'node:fs';

class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new Col(this.db, this.path + '/' + name); }
  async get() {
    const value = this.db.store.get(this.path);
    return { exists: value !== undefined, data: () => value };
  }
}
class Col {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, this.path + '/' + id); }
}
const db = {
  store: new Map(),
  collection(name) { return new Col(this, name); }
};
const legacy = { ownerUid: 'owner-legacy', ownerName: 'Legacy Owner', ownerEmail: 'legacy@example.test', createdBy: 'admin-1' };
assert.equal(await getRestaurantOwnerUid(db, 'rest-a', undefined, legacy), 'owner-legacy',
  'legacy root metadata remains usable during the controlled migration window');
db.store.set('restaurants/rest-a/private/ownership', {
  ownerUid: 'owner-private', ownerName: 'Private Owner', ownerEmail: 'private@example.test'
});
assert.equal(await getRestaurantOwnerUid(db, 'rest-a', undefined, legacy), 'owner-private',
  'private ownership is canonical when present');
const ownership = await getRestaurantOwnership(db, 'rest-a', undefined, legacy);
assert.equal(ownership.ownerEmail, 'private@example.test');
db.store.set('restaurants/rest-a/private/ownership', { ownerUid: null, ownerName: null, ownerEmail: null });
assert.equal(await getRestaurantOwnerUid(db, 'rest-a', undefined, legacy), null,
  'an explicit owner removal in the private record cannot fall back to a stale public owner UID');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert(rules.includes('function isBoundRestaurantOwner') && rules.includes('/private/ownership'),
  'Firestore owner binding uses the private ownership document');
assert(rules.includes("match /private/{privateDoc}") && rules.includes('allow read, write: if false;'),
  'client SDK access to private ownership metadata is denied');
assert(rules.includes("data.keys().hasOnly(['slug', 'name', 'isOpen'"),
  'restaurant public profile fields are explicitly allowlisted');
console.log('Private restaurant ownership tests passed.');
