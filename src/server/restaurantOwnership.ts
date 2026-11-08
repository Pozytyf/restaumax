/**
 * Private restaurant ownership metadata.
 * The legacy root-document value is used only as a migration bridge until the
 * super-admin migration has copied it to restaurants/{slug}/private/ownership.
 */
export async function getRestaurantOwnership(
  db: any,
  restaurantSlug: string,
  tx?: any,
  legacyRestaurantData?: Record<string, any> | null
): Promise<Record<string, any>> {
  const ref = db.collection('restaurants').doc(restaurantSlug).collection('private').doc('ownership');
  const snap = tx ? await tx.get(ref) : await ref.get();
  const privateData = snap?.exists ? (snap.data() || {}) : {};
  const result = { ...privateData };
  const legacy = legacyRestaurantData || {};
  for (const key of ['ownerUid', 'ownerName', 'ownerEmail', 'createdBy', 'updatedBy', 'deletedBy']) {
    if (result[key] === undefined && legacy[key] !== undefined) result[key] = legacy[key];
  }
  return result;
}

export async function getRestaurantOwnerUid(
  db: any,
  restaurantSlug: string,
  tx?: any,
  legacyRestaurantData?: Record<string, any> | null
): Promise<string | null> {
  const ownership = await getRestaurantOwnership(db, restaurantSlug, tx, legacyRestaurantData);
  const uid = ownership.ownerUid;
  return typeof uid === 'string' && uid.trim() ? uid.trim() : null;
}
