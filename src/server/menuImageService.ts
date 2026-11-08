import { randomUUID } from 'node:crypto';

type UploadResult = { statusCode: number; body: { success: boolean; error?: string; url?: string; path?: string } };
type UploadDependencies = {
  db: any;
  auth: any;
  bucket: any;
  payload: unknown;
  req: any;
  originValidator: (req: any) => boolean;
};

export async function uploadMenuImageWithDb(deps: UploadDependencies): Promise<UploadResult> {
  const { db, auth, bucket, payload, req, originValidator } = deps;
  if (!db || !auth || !bucket) return { statusCode: 503, body: { success: false, error: 'Stockage photo indisponible : Firebase Storage ou ses droits serveur ne sont pas configurés.' } };
  if (String(req?.method || '').toUpperCase() !== 'POST') return { statusCode: 405, body: { success: false, error: 'Méthode non autorisée.' } };
  if (!req || !originValidator(req)) return { statusCode: 403, body: { success: false, error: 'Origine de requête non autorisée.' } };
  try {
    const authorization = String(req.headers?.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return { statusCode: 401, body: { success: false, error: 'Connexion du personnel requise.' } };
    const decoded = await auth.verifyIdToken(idToken, true);
    const input = payload && typeof payload === 'object' ? payload as any : {};
    const slug = String(input.restaurantSlug || '').trim();
    const dishId = String(input.dishId || '').trim();
    const mimeType = String(input.mimeType || '');
    const base64 = String(input.base64 || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,128}$/.test(dishId) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 4_200_000) {
      return { statusCode: 400, body: { success: false, error: 'Fichier image ou destination invalide.' } };
    }
    const [restaurantSnap, memberSnap] = await Promise.all([
      db.collection('restaurants').doc(slug).get(),
      db.collection('managers').doc(decoded.uid).get()
    ]);
    const restaurant = restaurantSnap.exists ? restaurantSnap.data() : null;
    const member = memberSnap.exists ? memberSnap.data() : null;
    if (!restaurant || restaurant.status !== 'active' || restaurant.deletedAt || restaurant.isActive === false ||
        !member || member.active !== true || member.restaurantSlug !== slug ||
        Number(member.sessionVersion || 0) !== Number(decoded.sessionVersion || 0)) {
      return { statusCode: 403, body: { success: false, error: 'Compte inactif ou accès à ce restaurant refusé.' } };
    }
    const owner = member.role === 'owner' && restaurant.ownerUid === decoded.uid;
    const manager = member.role === 'manager' && Array.isArray(member.permissions) && member.permissions.includes('menu.manage');
    if (!owner && !manager) return { statusCode: 403, body: { success: false, error: 'La permission menu.manage est requise pour héberger une photo.' } };
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return { statusCode: 413, body: { success: false, error: 'La photo doit peser 3 Mo maximum.' } };
    const isJpeg = mimeType === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = mimeType === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isWebp = mimeType === 'image/webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return { statusCode: 400, body: { success: false, error: 'Le contenu réel du fichier ne correspond pas à son format image.' } };
    const extension = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    const objectPath = 'restaurants/' + slug + '/menu/' + dishId + '/' + randomUUID() + '.' + extension;
    const downloadToken = randomUUID();
    const file = bucket.file(objectPath);
    await file.save(buffer, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: downloadToken, restaurantSlug: slug, menuItemId: dishId }
      }
    });
    const url = 'https://firebasestorage.googleapis.com/v0/b/' + bucket.name + '/o/' + encodeURIComponent(objectPath) + '?alt=media&token=' + downloadToken;
    return { statusCode: 200, body: { success: true, url, path: objectPath } };
  } catch (error: any) {
    const message = String(error?.message || '');
    if (/auth|token|revoked|expired/i.test(message)) return { statusCode: 401, body: { success: false, error: 'Session du personnel invalide. Reconnectez-vous.' } };
    console.error('[RestauMax menu image] Upload failed:', message);
    return { statusCode: 500, body: { success: false, error: 'La photo n’a pas pu être hébergée. Vérifiez la configuration et les droits de stockage Firebase.' } };
  }
}
