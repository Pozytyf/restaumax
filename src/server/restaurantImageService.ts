import { randomUUID } from 'node:crypto';

type RestaurantImageHandlerDependencies = {
  adminDb: any; adminAuth: any; imageKitPrivateKey?: string; imageKitUrlEndpoint?: string;
  requestHasValidOrigin: (req: any) => boolean;
  getRestaurantOwnerUid: (db: any, slug: string, tx?: any, legacy?: any) => Promise<string | null>;
  fetchImpl?: typeof fetch; logger?: Pick<Console, 'error'>;
};
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function validImage(bytes: Buffer, type: string) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  return type === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}
export function createRestaurantImageHandler(deps: RestaurantImageHandlerDependencies) {
  const fetchImpl = deps.fetchImpl || fetch;
  const authHeader = () => 'Basic ' + Buffer.from(`${deps.imageKitPrivateKey || ''}:`).toString('base64');
  return async function handleRestaurantImageRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
    const method = String(req?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'DELETE') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
    if (!deps.adminDb || !deps.adminAuth || !deps.imageKitPrivateKey || !deps.imageKitUrlEndpoint) return { statusCode: 503, body: { success: false, error: 'Service photo non configuré.' } };
    if (!req || !deps.requestHasValidOrigin(req)) return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
    try {
      const authorization = String(req.headers?.authorization || '');
      const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion requise.' } };
      const decoded = await deps.adminAuth.verifyIdToken(idToken, true);
      if (decoded?.role === 'super_admin' || decoded?.role === 'admin') return { statusCode: 403, body: { success: false, error: 'Le super-administrateur n’a pas accès aux opérations d’un restaurant.' } };
      const input = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
      const restaurantSlug = String(input.restaurantSlug || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) return { statusCode: 400, body: { success: false, error: 'Restaurant invalide.' } };
      const [restaurantSnap, memberSnap] = await Promise.all([
        deps.adminDb.collection('restaurants').doc(restaurantSlug).get(),
        deps.adminDb.collection('managers').doc(decoded.uid).get()
      ]);
      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const member = memberSnap.exists ? memberSnap.data() : null;
      if (!restaurant || (restaurant.status ?? 'active') !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
          !member || member.active !== true || member.restaurantSlug !== restaurantSlug ||
          (member.status && member.status !== 'active') || Number(decoded.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
        return { statusCode: 403, body: { success: false, error: 'Accès au stockage du restaurant refusé.' } };
      }
      const kind = String(input.kind || '');
      if (kind !== 'menu' && kind !== 'branding') return { statusCode: 400, body: { success: false, error: 'Type de photo invalide.' } };
      const ownerUid = member.role === 'owner' ? await deps.getRestaurantOwnerUid(deps.adminDb, restaurantSlug, undefined, restaurant) : null;
      const isOwner = member.role === 'owner' && ownerUid === decoded.uid;
      const requiredPermission = kind === 'menu' ? 'menu.manage' : 'settings.manage';
      const isAuthorizedManager = member.role === 'manager' && Array.isArray(member.permissions) && member.permissions.includes(requiredPermission);
      if (!isOwner && !isAuthorizedManager) return { statusCode: 403, body: { success: false, error: 'Permission de gestion des photos insuffisante.' } };
      const apiBase = 'https://api.imagekit.io/v1/files';
      if (method === 'DELETE') {
        const fileId = String(input.path || '');
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(fileId)) return { statusCode: 400, body: { success: false, error: 'Identifiant de photo invalide.' } };
        const detail = await fetchImpl(`${apiBase}/${encodeURIComponent(fileId)}`, { headers: { Authorization: authHeader() } });
        if (detail.status === 404) return { statusCode: 200, body: { success: true } };
        if (!detail.ok) throw new Error(`ImageKit metadata request failed: ${detail.status}`);
        const details = await detail.json() as any;
        if (typeof details.filePath !== 'string' || !details.filePath.startsWith(`/restaurants/${restaurantSlug}/${kind}/`)) return { statusCode: 403, body: { success: false, error: 'Suppression de cette photo non autorisée.' } };
        const removed = await fetchImpl(`${apiBase}/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: authHeader() } });
        if (!removed.ok && removed.status !== 404) throw new Error(`ImageKit delete failed: ${removed.status}`);
        return { statusCode: 200, body: { success: true } };
      }
      const contentType = String(input.contentType || ''), size = Number(input.size), dataBase64 = String(input.dataBase64 || '');
      if (!ALLOWED_TYPES[contentType] || !Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES || dataBase64.length > 4194304 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
        return { statusCode: 400, body: { success: false, error: 'Image invalide : JPEG, PNG ou WebP, 3 Mo maximum.' } };
      }
      const bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length !== size || bytes.length > MAX_IMAGE_BYTES || !validImage(bytes, contentType)) return { statusCode: 400, body: { success: false, error: 'Le contenu du fichier ne correspond pas à un format image autorisé.' } };
      const fileName = `${randomUUID().replace(/-/g, '')}.${ALLOWED_TYPES[contentType]}`;
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: contentType }), fileName);
      form.append('fileName', fileName); form.append('folder', `/restaurants/${restaurantSlug}/${kind}`); form.append('useUniqueFileName', 'false');
      const response = await fetchImpl('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', headers: { Authorization: authHeader() }, body: form });
      const uploaded = await response.json().catch(() => ({})) as any;
      if (!response.ok || !uploaded.fileId || !uploaded.url || !uploaded.filePath) {
        deps.logger?.error('[RestauMax ImageKit] Upload failed:', response.status, uploaded?.message || '');
        return { statusCode: response.status === 429 ? 429 : 503, body: { success: false, error: response.status === 403 ? 'Quota ImageKit atteint ou accès refusé. Aucun paiement ne sera déclenché.' : 'Le service photo a refusé le fichier. Réessayez plus tard.' } };
      }
      const endpoint = new URL(deps.imageKitUrlEndpoint), imageUrl = new URL(uploaded.url);
      if (endpoint.protocol !== 'https:' || imageUrl.protocol !== 'https:' || endpoint.host !== imageUrl.host || !String(uploaded.filePath).startsWith(`/restaurants/${restaurantSlug}/${kind}/`)) {
        await fetchImpl(`${apiBase}/${encodeURIComponent(uploaded.fileId)}`, { method: 'DELETE', headers: { Authorization: authHeader() } }).catch(() => undefined);
        return { statusCode: 502, body: { success: false, error: 'Réponse de stockage photo invalide.' } };
      }
      return { statusCode: 201, body: { success: true, path: uploaded.fileId, url: uploaded.url } };
    } catch (error: any) {
      deps.logger?.error('[RestauMax restaurant image] Request failed:', error?.message || String(error));
      const code = String(error?.code || '');
      if (code === 'auth/id-token-expired' || code === 'auth/id-token-revoked' || code === 'auth/invalid-id-token') return { statusCode: 401, body: { success: false, error: 'Session expirée. Reconnectez-vous.' } };
      return { statusCode: 503, body: { success: false, error: 'Opération photo momentanément indisponible.' } };
    }
  };
}
