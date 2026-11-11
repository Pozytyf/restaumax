import { createHash } from 'node:crypto';

const normalizeTableNumber = (value: unknown) =>
  String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

export interface CreateTableInput {
  id: string;
  tableNumber: string;
  section: 'salle' | 'terrasse' | 'bar' | 'vip';
  capacity: number;
  isActive: boolean;
}

export async function createTableWithDb(db: any, restaurantSlug: string, input: CreateTableInput, now = Date.now()) {
  const slug = String(restaurantSlug || '').trim();
  const id = String(input?.id || '').trim();
  const tableNumber = String(input?.tableNumber || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const normalized = normalizeTableNumber(tableNumber);
  const section = input?.section;
  const capacity = Number(input?.capacity);
  if (!db || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
      tableNumber.length < 1 || tableNumber.length > 64 ||
      !['salle', 'terrasse', 'bar', 'vip'].includes(section) ||
      !Number.isInteger(capacity) || capacity < 1 || capacity > 100 ||
      input?.isActive !== true || !Number.isSafeInteger(now)) {
    return { success: false, error: 'Les informations de la table sont invalides.' };
  }

  const restaurantRef = db.collection('restaurants').doc(slug);
  const tablesRef = restaurantRef.collection('tables');
  const tableRef = tablesRef.doc(id);
  const indexRef = restaurantRef.collection('table_number_index').doc('tblnum_' + hash(normalized));

  return db.runTransaction(async (tx: any) => {
    const [restaurantSnap, tableSnap, indexSnap, allTablesSnap] = await Promise.all([
      tx.get(restaurantRef), tx.get(tableRef), tx.get(indexRef), tx.get(tablesRef)
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() || {} : null;
    if (!restaurant || String(restaurant.status || 'active') !== 'active' || restaurant.deletedAt || restaurant.isActive === false) {
      return { success: false, error: 'Restaurant inactif ou indisponible.' };
    }
    if (tableSnap.exists) return { success: false, conflict: true, error: 'Cette référence de table existe déjà.' };

    const documents = Array.isArray(allTablesSnap.docs) ? allTablesSnap.docs : [];
    const duplicate = documents.find((doc: any) => {
      const existing = doc.data() || {};
      return normalizeTableNumber(existing.tableNumberNormalized || existing.tableNumber) === normalized;
    });
    if (duplicate) return { success: false, conflict: true, error: `La table "${tableNumber}" existe déjà.` };

    const previousIndex = indexSnap.exists ? indexSnap.data() || {} : null;
    if (previousIndex?.tableId === id) {
      return { success: false, conflict: true, error: 'Une ancienne référence QR utilise déjà cet identifiant de table. Réessayez la création.' };
    }

    const table = {
      id, tableNumber, tableNumberNormalized: normalized, section, capacity,
      isActive: true, createdAt: now, updatedAt: now
    };
    if (indexSnap.exists) {
      tx.update(indexRef, { tableId: id, tableNumberNormalized: normalized, updatedAt: now });
    } else {
      tx.create(indexRef, { id: indexRef.id, tableId: id, tableNumberNormalized: normalized, createdAt: now, updatedAt: now });
    }
    tx.create(tableRef, table);
    return { success: true, table };
  });
}
