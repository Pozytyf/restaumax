/**
 * Pure helpers shared by the Preview migration and its regression tests.
 * Existing private values are canonical; legacy public values only fill gaps.
 */
export const LEGACY_PRIVATE_FIELDS = Object.freeze([
  'ownerUid',
  'ownerName',
  'ownerEmail',
  'createdBy',
  'updatedBy',
]);

export function collectLegacyPrivateMetadata(data = {}) {
  return Object.fromEntries(
    LEGACY_PRIVATE_FIELDS
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]])
  );
}

export function mergePrivateOwnership(existing = {}, legacy = {}) {
  if (existing.ownerUid && legacy.ownerUid && existing.ownerUid !== legacy.ownerUid) {
    throw new Error('Conflit d’identité propriétaire.');
  }

  const merged = { ...existing };
  for (const [key, value] of Object.entries(legacy)) {
    if (merged[key] === undefined && value !== undefined) merged[key] = value;
  }
  return merged;
}
