const MENU_CATEGORIES = new Set(['grillades', 'plats', 'entrees', 'accompagnements', 'boissons', 'desserts']);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const money = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;

function sanitizeOptionGroups(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(groupValue => {
    const group = plain(groupValue);
    if (!group || !Array.isArray(group.options)) return [];
    const options = group.options.slice(0, 50).flatMap(optionValue => {
      const option = plain(optionValue);
      if (!option || !text(option.id, 128) || !text(option.name, 200)) return [];
      return [{
        id: text(option.id, 128),
        name: text(option.name, 200),
        extraPrice: money(option.extraPrice),
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

function sanitizeExtras(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap(extraValue => {
    const extra = plain(extraValue);
    if (!extra || !text(extra.id, 128) || !text(extra.name, 200)) return [];
    return [{ id: text(extra.id, 128), name: text(extra.name, 200), price: money(extra.price) }];
  });
}

function sanitizeTranslations(value) {
  const translations = plain(value);
  if (!translations) return undefined;
  const result = {};
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
export function sanitizePublicMenuItem(raw) {
  const item = plain(raw);
  if (!item || typeof item.id !== 'string' || typeof item.restaurantSlug !== 'string' ||
      typeof item.name !== 'string' || !MENU_CATEGORIES.has(item.category) ||
      !Number.isSafeInteger(item.price) || item.price <= 0 || item.available !== true) return null;
  if (item.trackStock === true && (!Number.isSafeInteger(item.stockQuantity) || item.stockQuantity <= 0)) return null;
  return {
    id: text(item.id, 128),
    restaurantSlug: text(item.restaurantSlug, 100),
    name: text(item.name, 200),
    category: item.category,
    price: item.price,
    available: true,
    description: text(item.description, 2000),
    imageUrl: text(item.imageUrl, 2048),
    prepTimeMinutes: Number.isSafeInteger(item.prepTimeMinutes) ? Math.max(1, Math.min(1440, item.prepTimeMinutes)) : 1,
    ...(Array.isArray(item.tags) ? { tags: item.tags.slice(0, 30).filter(x => typeof x === 'string').map(x => text(x, 80)) } : {}),
    ...(Array.isArray(item.allergens) ? { allergens: item.allergens.slice(0, 30).filter(x => typeof x === 'string').map(x => text(x, 80)) } : {}),
    ...(Number.isInteger(item.spiceLevel) && item.spiceLevel >= 0 && item.spiceLevel <= 3 ? { spiceLevel: item.spiceLevel } : {}),
    ...(Array.isArray(item.pairings) ? { pairings: item.pairings.slice(0, 20).filter(x => typeof x === 'string').map(x => text(x, 120)) } : {}),
    ...(Array.isArray(item.optionGroups) ? { optionGroups: sanitizeOptionGroups(item.optionGroups) } : {}),
    ...(Array.isArray(item.availableExtras) ? { availableExtras: sanitizeExtras(item.availableExtras) } : {}),
    ...(sanitizeTranslations(item.translations) ? { translations: sanitizeTranslations(item.translations) } : {})
  };
}
