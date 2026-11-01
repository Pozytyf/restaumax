import { adminDb, handlePlatformAdmin } from '../server.ts';

export default async function handler(req: any, res: any) {
  return handlePlatformAdmin(req, res, adminDb);
}
