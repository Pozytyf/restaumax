import fs from 'node:fs';

const REQUIRED_FIELDS = [
  ['customerPhoneNormalized', 'ASCENDING'],
  ['status', 'ASCENDING']
];

export function findRequiredOrdersIndex(indexes) {
  if (!Array.isArray(indexes)) return null;
  return indexes.find((index) => {
    if (index?.collectionGroup !== 'orders') return false;
    const fields = Array.isArray(index.fields) ? index.fields : [];
    const actual = fields
      .filter((field) => field?.fieldPath !== '__name__')
      .map((field) => [field?.fieldPath, field?.order || (field?.arrayConfig ? 'CONTAINS' : '')]);
    return actual.length === REQUIRED_FIELDS.length &&
      REQUIRED_FIELDS.every(([path, order], position) =>
        actual[position]?.[0] === path && actual[position]?.[1] === order
      );
  }) || null;
}

export function isRequiredOrdersIndexReady(indexes) {
  return findRequiredOrdersIndex(indexes)?.state === 'READY';
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mode = process.argv[2];
  if (!['exists', 'ready'].includes(mode)) {
    console.error('Usage: node scripts/check-firestore-index.mjs <exists|ready>');
    process.exit(2);
  }
  const raw = fs.readFileSync(0, 'utf8');
  const indexes = JSON.parse(raw);
  const found = findRequiredOrdersIndex(indexes);
  if (!found || (mode === 'ready' && found.state !== 'READY')) process.exit(1);
  console.log(`Found required orders index: ${found.state || 'state unknown'}`);
}
