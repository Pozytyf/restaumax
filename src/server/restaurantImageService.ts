import { randomUUID } from 'node:crypto';

type RestaurantImageHandlerDependencies = {
  adminDb: any;
  adminAuth: any;
  adminStorage: any;
  requestHasValidOrigin: (req: any) => boolean;
  getRestaurantOwnerUid: (db: any, slug: string, tx?: any, legacy?: any) => Promise<string | null>;
  logger?: Pick<Console, 'error'>;
};

export function createRestaurantImageHandler(deps: RestaurantImageHandlerDependencies) {
  return async function handleRestaurantImageRequest(payload: unknown, req?: any): Promise<{ statusCode: number; body: any }> {
    const method = String(req?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'DELETE') {
      return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
    }
    if (!deps.adminDb || !deps.adminAuth || !deps.adminStorage) {
      return { statusCode: 503, body: { success: false, error: 'Service photo momentanément indisponible.' } };
    }
    if (!req || !deps.requestHasValidOrigin(req)) {
      return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
    }

    try {
      const authorization = String(req.headers?.authorization || '');
      const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion requise.' } };
      const decoded = await deps.adminAuth.verifyIdToken(idToken, true);
      if (decoded?.role === 'super_admin' || decoded?.role === 'admin') {
        return { statusCode: 403, body: { success: false, error: 'Le super-administrateur n’a pas accès aux opérations d’un restaurant.' } };
      }
      const input = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
      const restaurantSlug = String(input.restaurantSlug || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(restaurantSlug)) {
        return { statusCode: 400, body: { success: false, error: 'Restaurant invalide.' } };
      }

      const [restaurantSnap, memberSnap] = await Promise.all([
        deps.adminDb.collection('restaurants').doc(restaurantSlug).get(),
        deps.adminDb.collection('managers').doc(decoded.uid).get()
      ]);
      const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
      const member = memberSnap.exists ? memberSnap.data() : null;
      if (!restaurant || (restaurant.status ?? 'active') !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
          !member || member.active !== true || member.restaurantSlug !== restaurantSlug ||
          (member.status && member.status !== 'active') ||
          Number(decoded.sessionVersion || 0) !== Number(member.sessionVersion || 0)) {
        return { statusCode: 403, body: { success: false, error: 'Accès au stockage du restaurant refusé.' } };
      }

      const kind = String(input.kind || '');
      if (kind !== 'menu' && kind !== 'branding') {
        return { statusCode: 400, body: { success: false, error: 'Type de photo invalide.' } };
      }
      const ownerUid = member.role === 'owner'
        ? await deps.getRestaurantOwnerUid(deps.adminDb, restaurantSlug, undefined, restaurant)
        : null;
      const isOwner = member.role === 'owner' && ownerUid === decoded.uid;
      const requiredPermission = kind === 'menu' ? 'menu.manage' : 'settings.manage';
      const isAuthorizedManager = member.role === 'manager' &&
        Array.isArray(member.permissions) && member.permissions.includes(requiredPermission);
      if (!isOwner && !isAuthorizedManager) {
        return { statusCode: 403, body: { success: false, error: 'Permission de gestion des photos insuffisante.' } };
      }

      const prefix = `restaurants/${restaurantSlug}/${kind}/`;
      if (method === 'DELETE') {
        const objectPath = String(input.path || '');
        if (!objectPath.startsWith(prefix) ||
            !/^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/.test(objectPath.slice(prefix.length))) {
          return { statusCode: 400, body: { success: false, error: 'Chemin de photo invalide.' } };
        }
        await deps.adminStorage.file(objectPath).delete({ ignoreNotFound: true });
        return { statusCode: 200, body: { success: true } };
      }

      const contentType = String(input.contentType || '');
      const size = Number(input.size);
      const dataBase64 = String(input.dataBase64 || '');
      const allowedTypes: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp'
      };
      if (!allowedTypes[contentType] || !Number.isSafeInteger(size) || size <= 0 ||
          size > 3 * 1024 * 1024 || dataBase64.length > 4194304 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
        return { statusCode: 400, body: { success: false, error: 'Image invalide : JPEG, PNG ou WebP, 3 Mo maximum.' } };
      }
      const bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length !== size || bytes.length > 3 * 1024 * 1024) {
        return { statusCode: 400, body: { success: false, error: 'Taille du fichier invalide.' } };
      }
      const isJpeg = contentType === 'image/jpeg' && bytes.length >= 3 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isPng = contentType === 'image/png' && bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
      const isWebp = contentType === 'image/webp' && bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!isJpeg && !isPng && !isWebp) {
        return { statusCode: 400, body: { success: false, error: 'Le contenu du fichier ne correspond pas à un format image autorisé.' } };
      }

      const objectPath = `${prefix}${randomUUID().replace(/-/g, '')}.${allowedTypes[contentType]}`;
      const downloadToken = randomUUID();
      await deps.adminStorage.file(objectPath).save(bytes, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            restaurantSlug,
            uploadedBy: decoded.uid
          }
        }
      });
      return { statusCode: 201, body: { success: true, path: objectPath } };
    } catch (error: any) {
      deps.logger?.error('[RestauMax restaurant image] Request failed:', error?.message || String(error));
      const code = String(error?.code || '');
      if (code === 'auth/id-token-expired' || code === 'auth/id-token-revoked' || code === 'auth/invalid-id-token') {
        return { statusCode: 401, body: { success: false, error: 'Session expirée. Reconnectez-vous.' } };
      }
      return { statusCode: 503, body: { success: false, error: 'Opération photo momentanément indisponible.' } };
    }
  };
}
