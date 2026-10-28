import type { MeResponse } from '@ada/contracts';

/** Cliente da API same-origin. Sessão por cookie HttpOnly; CSRF em memória (nunca em localStorage). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const API = `${BASE}/api/ada`;
let csrf = '';

export function setCsrf(token: string) {
  csrf = token;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
export function onUnauthenticated(fn: Listener): () => void {
  unauthListeners.add(fn);
  return () => {
    unauthListeners.delete(fn);
  };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined)
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) unauthListeners.forEach((l) => l());
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERRO', e.message ?? `Falha (HTTP ${res.status})`, e.details);
  }
  return data as T;
}

export const apiUrl = (path: string) => API + path;

export type Me = MeResponse;
