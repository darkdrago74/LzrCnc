/**
 * Shared API helpers.
 *
 * By default all requests are relative to the page origin:
 *  - in production the Fastify server serves the client, so the origin IS the API;
 *  - in development Vite proxies the API routes to the server (see vite.config.ts).
 * This keeps the UI working when it is opened from another device on the LAN
 * (e.g. a tablet controlling the Raspberry Pi). VITE_API_URL can still override it.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const apiUrl = (path: string) => `${API_URL}${path}`;

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : {}; } catch { /* plain text */ }
    if (!res.ok) {
        const msg = (data && typeof data === 'object' && ('error' in data || 'message' in data))
            ? String((data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message)
            : `HTTP ${res.status} ${typeof data === 'string' ? data : ''}`;
        throw new ApiError(res.status, msg);
    }
    return data as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
    return parse<T>(await fetch(apiUrl(path)));
}

export async function apiPost<T = unknown>(path: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<T> {
    const res = await fetch(apiUrl(path), {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
}

/** Normalise a user-typed LzrCnc address ("192.168.1.20:3001" → "http://192.168.1.20:3001"). */
export function normalizeServerUrl(input: string): string {
    let url = input.trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url;
}

/** POST JSON to another LzrCnc server (e.g. the Raspberry Pi). The server allows any CORS origin. */
export async function remotePost<T = unknown>(baseUrl: string, path: string, body: unknown, timeoutMs = 8000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${normalizeServerUrl(baseUrl)}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        return await parse<T>(res);
    } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(0, `Cannot reach ${normalizeServerUrl(baseUrl)} (is LzrCnc running there, and is port 3001 allowed by its firewall?)`);
    } finally {
        clearTimeout(timer);
    }
}
