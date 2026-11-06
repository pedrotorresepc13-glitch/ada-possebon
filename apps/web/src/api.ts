import type { MeResponse } from '@ada/contracts';

/** Cliente da API same-origin. Sessão por cookie HttpOnly; CSRF em memória (nunca em localStorage). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const API = `${BASE}/api/ada`;
let csrf = '';
let sessionContext: { userId: number; unitId: number } | null = null;

export function setSessionContext(me: MeResponse | null) {
  sessionContext = me ? { userId: me.user.systemUserId, unitId: me.activeUnit.id } : null;
}

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
  if (sessionContext) {
    headers['X-Possebon-User'] = String(sessionContext.userId);
    headers['X-Possebon-Unit'] = String(sessionContext.unitId);
  }
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
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error ?? {};
    if (res.status === 401 || e.code === 'SESSION_CONTEXT_CHANGED') unauthListeners.forEach((l) => l());
    throw new ApiError(res.status, e.code ?? 'ERRO', e.message ?? `Falha (HTTP ${res.status})`, e.details);
  }
  return data as T;
}

export const apiUrl = (path: string) => API + path;

export type Me = MeResponse;

export async function reconnectPossebon(): Promise<Me> {
  const bridge = new URL('../ada-assistant.php', new URL(`${BASE}/`, location.origin));
  const request = async (headers?: Record<string, string>) => {
    const response = await fetch(bridge, {
      method: headers ? 'POST' : 'GET', headers, credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000)
    });
    if (response.status === 401) throw new Error('Entre no POSSEBON Web para usar a Posso.');
    if (response.status === 403) throw new Error('O POSSEBON Web recusou o acesso da Posso para esta sessão ou unidade.');
    if (!response.ok) throw new Error('A integração com o POSSEBON Web está indisponível.');
    return response.json();
  };
  const identity = await request();
  if (identity.allowed !== true || !Number.isSafeInteger(identity.userId) ||
    !Number.isSafeInteger(identity.unitId) || !/^[a-f0-9]{64}$/.test(identity.csrf)) {
    throw new Error('O POSSEBON Web retornou uma sessão de integração inválida.');
  }
  const result = await request({ 'X-Possebon-CSRF': identity.csrf });
  if (result.action !== new URL(apiUrl('/session/exchange'), location.origin).href ||
    typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 4096) {
    throw new Error('O POSSEBON Web retornou uma autorização inválida.');
  }
  await api('/session/exchange', { body: { ticket: result.ticket } });
  const me = await api<Me>('/me');
  if (me.user.systemUserId !== identity.userId || me.activeUnit.id !== identity.unitId) {
    throw new Error('A sessão recebida não corresponde ao usuário e à unidade do POSSEBON Web.');
  }
  return me;
}
