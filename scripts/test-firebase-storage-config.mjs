import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebase = readFileSync(new URL('../src/lib/firebase.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const imageService = readFileSync(new URL('../src/server/restaurantImageService.ts', import.meta.url), 'utf8');
const imageRules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

assert(firebase.includes("VITE_RESTAUMAX_IMAGEKIT_UPLOADS_ENABLED === 'true'"),
  'ImageKit uploads must be disabled unless the dedicated Preview feature flag is explicitly enabled');
assert(firebase.includes("callRestaurantImageApi('POST'") && firebase.includes("callRestaurantImageApi('DELETE'"),
  'Browser uploads and deletes must be mediated by the authenticated server API');
assert(!firebase.includes('getDownloadURL') && !firebase.includes('VITE_RESTAUMAX_STORAGE_IMAGES_ENABLED'),
  'The ImageKit path must not depend on Firebase Storage client download URLs or the old Storage flag');
assert(server.includes("process.env.RESTAUMAX_IMAGEKIT_UPLOADS_ENABLED !== 'true'") &&
  server.includes('imageKitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY') &&
  server.includes('imageKitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT'),
  'Server ImageKit upload route must remain disabled unless its server-only key and endpoint are configured');
assert(imageService.includes('deps.adminAuth.verifyIdToken(idToken, true)') &&
  imageService.includes('member.active !== true') && imageService.includes('member.restaurantSlug !== restaurantSlug') &&
  imageService.includes('Number(decoded.sessionVersion || 0) !== Number(member.sessionVersion || 0)') &&
  imageService.includes('deps.getRestaurantOwnerUid(deps.adminDb, restaurantSlug') &&
  imageService.includes('member.permissions.includes(requiredPermission)'),
  'ImageKit uploads must retain revocation-aware authentication, tenant isolation and role permissions');
assert(imageService.includes('bytes.length > MAX_IMAGE_BYTES') && imageService.includes('validImage(bytes, contentType)'),
  'ImageKit uploads must validate actual image bytes and enforce the 3 MB limit');
assert(imageService.includes('https://upload.imagekit.io/api/v1/files/upload') &&
  imageService.includes('https://api.imagekit.io/v1/files') &&
  imageService.includes('endpoint.host !== imageUrl.host'),
  'ImageKit uploads and deletes must use HTTPS APIs and validate the returned delivery host');
assert(imageService.includes("details.filePath.startsWith(`/restaurants/${restaurantSlug}/${kind}/`)"),
  'ImageKit deletion must verify file ownership by restaurant and media kind');
assert(imageRules.includes('allow read: if true') && imageRules.includes('allow write: if false'),
  'Legacy Firebase Storage client writes must remain denied');
console.log('ImageKit configuration and secure upload pipeline checks passed.');
