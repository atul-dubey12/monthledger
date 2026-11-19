import { createHash, timingSafeEqual } from 'node:crypto';
import { type TransactionDatabase } from './db';
import { ApiError, object } from './validation';
import { settings, categories, goals, recurring } from './resources';
import { listEntries, writeEntry, deleteEntry, exportEntries, importEntries } from './entries';
export interface ApiConfig { apiKey?: string; requireKey?: boolean; allowedOrigins?: string[] }
function environmentConfig(): ApiConfig {
  return { apiKey: process.env.API_KEY, requireKey: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL), allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4201').split(',').map(s => s.trim()).filter(Boolean) };
}
function matchesKey(actual: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}
const methods: Record<string, string[]> = {
  health: ['GET'], settings: ['GET', 'PUT'], categories: ['GET', 'POST'], goals: ['GET', 'POST'], recurring: ['GET', 'POST'], entries: ['GET', 'POST'],
  'entries/export': ['GET'], 'entries/import': ['POST'], 'categories/:id': ['PUT'], 'goals/:id': ['PUT'], 'recurring/:id': ['PUT'], 'entries/:id': ['PUT', 'DELETE'],
};
async function body(request: Request): Promise<Record<string, unknown>> {
  try { return object(await request.json()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Some fields have the wrong format.'); }
}
export function createApi(db: TransactionDatabase, suppliedConfig?: ApiConfig) {
  return async (request: Request): Promise<Response> => {
    const config = suppliedConfig ?? environmentConfig();
    const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' });
    const origin = request.headers.get('origin');
    const allowed = !origin || origin === new URL(request.url).origin || (config.allowedOrigins ?? []).includes(origin);
    if (origin && allowed) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Expose-Headers', 'Content-Disposition'); }
    let response: Response;
    try {
      if (!allowed) throw new ApiError(403, 'This origin is not allowed.');
      const method = request.method, url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, ''), parts = path.split('/');
      const id = parts.length === 2 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : undefined;
      const route = id !== undefined ? `${parts[0]}/:id` : path;
      if (id !== undefined && !Number.isSafeInteger(id)) throw new ApiError(400, 'Some fields have the wrong format.');
      if (method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
        headers.set('Access-Control-Max-Age', '3600');
        response = new Response(null, { status: 204 });
      } else {
        if (path !== 'health') {
          if (config.requireKey && (!config.apiKey || config.apiKey.length < 32)) throw new ApiError(503, 'Server authentication is not configured.');
          if (config.apiKey && !matchesKey(request.headers.get('X-Api-Key') ?? '', config.apiKey)) throw new ApiError(401, 'Invalid or missing server key');
        }
        const permitted = Object.hasOwn(methods, route) ? methods[route] : undefined;
        if (!permitted) throw new ApiError(404, 'Not found.');
        if (!permitted.includes(method)) { headers.set('Allow', [...permitted, 'OPTIONS'].join(', ')); throw new ApiError(405, 'Method not allowed.'); }
        if (route === 'health') response = Response.json({ status: 'ok' });
        else if (route === 'entries/export') response = await exportEntries(db, url.searchParams);
        else if (route === 'entries/import') response = Response.json(await importEntries(db, await body(request)));
        else if (route === 'entries/:id' && method === 'DELETE') { await deleteEntry(db, id!); response = new Response(null, { status: 204 }); }
        else {
          const data = method === 'GET' ? undefined : await body(request);
          let result: unknown;
          switch (parts[0]) {
            case 'settings': result = await settings(db, data); break;
            case 'categories': result = await categories(db, data, id); break;
            case 'goals': result = await goals(db, data, id); break;
            case 'recurring': result = await recurring(db, data, id); break;
            case 'entries': result = data ? await writeEntry(db, data, id) : await listEntries(db, url.searchParams); break;
          }
          response = Response.json(result, { status: method === 'POST' ? 201 : 200 });
        }
      }
    } catch (error) {
      if (error instanceof ApiError) response = Response.json({ message: error.message }, { status: error.status });
      else {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        // Never log connection strings, query parameters or personal financial data.
        console.error('API request failed', { code });
        response = Response.json({ message: 'The server could not complete this request.' }, { status: 500 });
      }
    }
    headers.forEach((value, name) => response.headers.set(name, value));
    return response;
  };
}
