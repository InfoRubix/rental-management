// Netlify Function (v2 syntax). All /api/* requests are routed here.
// Firebase Admin credentials are read from server-side environment variables only.
import { handleApi } from '../../server/handler';

export default async (req: Request, context: { ip?: string }) => handleApi(req, { ip: context?.ip });

export const config = { path: '/api/*' };
