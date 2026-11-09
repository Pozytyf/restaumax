type PlainRecord = Record<string, unknown>;
const MENU_CATEGORIES = new Set<string>(['grillades', 'plats', 'entrees', 'accompagnements', 'boissons', 'desserts']);
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : '';
const money = (value: unknown): number | null => Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
const plain = (value: unknown): PlainRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : null;

function sanitizeOptionGroups(value: unknown): PlainRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((groupValue: unknown): PlainRecord[] => {
    const group = plain(groupValue);
    if (!group || typeof group.id !== 'string' || !group.id.trim() ||
        typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.options)) return [];
    const options = group.options.slice(0, 50).flatMap((optionValue: unknown): PlainRecord[] => {
      const option = plain(optionValue);
      if (!option || typeof option.id !== 'string' || !option.id.trim() ||
          typeof option.name !== 'string' || !option.name.trim()) return [];
      const extraPrice = money(option.extraPrice);
      if (extraPrice === null) return [];
      return [{
        id: text(option.id, 128),
        name: text(option.name, 200),
        extraPrice,
        ...(option.isDefault === true ? { isDefault: true } : {})
      }];
    });
    return [{
      id: text(group.id, 128),
      name: text(group.name, 200),
      required: group.required === true,
      options
    }];
  });
}

function sanitizeExtras(value: unknown): PlainRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((extraValue: unknown): PlainRecord[] => {
    const extra = plain(extraValue);
    if (!extra || typeof extra.id !== 'string' || !extra.id.trim() ||
        typeof extra.name !== 'string' || !extra.name.trim()) return [];
    const price = money(extra.price);
    if (price === null) return [];
    return [{ id: text(extra.id, 128), name: text(extra.name, 200), price }];
  });
}

function sanitizeTranslations(value: unknown): PlainRecord | undefined {
  const translations = plain(value);
  if (!translations) return undefined;
  const result: PlainRecord = {};
  for (const language of ['en', 'pt']) {
    const entry = plain(translations[language]);
    if (entry) result[language] = {
      ...(typeof entry.name === 'string' ? { name: text(entry.name, 200) } : {}),
      ...(typeof entry.description === 'string' ? { description: text(entry.description, 2000) } : {})
    };
  }
  return Object.keys(result).length ? result : undefined;
}

/** Return only fields needed by the public QR menu. Never expose stock counts,
 * thresholds, recipe costs, supplier data, or arbitrary Admin SDK fields. */
export function sanitizePublicMenuItem(raw: unknown): PlainRecord | null {
  const item = plain(raw);
  if (!item || typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.restaurantSlug !== 'string' || !item.restaurantSlug.trim() ||
      typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.category !== 'string' || !MENU_CATEGORIES.has(item.category) ||
      typeof item.price !== 'number' || !Number.isSafeInteger(item.price) ||
      item.price <= 0 || item.available !== true) return null;
  if (item.trackStock === true &&
      (typeof item.stockQuantity !== 'number' || !Number.isSafeInteger(item.stockQuantity) || item.stockQuantity <= 0)) return null;
  const translations = sanitizeTranslations(item.translations);
  return {
    id: text(item.id, 128),
    restaurantSlug: text(item.restaurantSlug, 100),
    name: text(item.name, 200),
    category: item.category,
    price: item.price,
    available: true,
    description: text(item.description, 2000),
    imageUrl: text(item.imageUrl, 2048),
    prepTimeMinutes: typeof item.prepTimeMinutes === 'number' && Number.isSafeInteger(item.prepTimeMinutes)
      ? Math.max(1, Math.min(1440, item.prepTimeMinutes)) : 1,
    ...(Array.isArray(item.tags) ? { tags: item.tags.slice(0, 30).filter((x: unknown): x is string => typeof x === 'string').map((x: string) => text(x, 80)) } : {}),
    ...(Array.isArray(item.allergens) ? { allergens: item.allergens.slice(0, 30).filter((x: unknown): x is string => typeof x === 'string').map((x: string) => text(x, 80)) } : {}),
    ...(typeof item.spiceLevel === 'number' && Number.isInteger(item.spiceLevel) && item.spiceLevel >= 0 && item.spiceLevel <= 3 ? { spiceLevel: item.spiceLevel } : {}),
    ...(Array.isArray(item.pairings) ? { pairings: item.pairings.slice(0, 20).filter((x: unknown): x is string => typeof x === 'string').map((x: string) => text(x, 120)) } : {}),
    ...(Array.isArray(item.optionGroups) ? { optionGroups: sanitizeOptionGroups(item.optionGroups) } : {}),
    ...(Array.isArray(item.availableExtras) ? { availableExtras: sanitizeExtras(item.availableExtras) } : {}),
    ...(translations ? { translations } : {})
  };
}
