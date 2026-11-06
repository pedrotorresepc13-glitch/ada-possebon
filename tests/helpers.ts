import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../apps/api/src/config.ts';
import { createDeps, type Deps } from '../apps/api/src/core.ts';
import { buildApp } from '../apps/api/src/app.ts';
import { createPglite } from '../apps/api/src/db.ts';
import { DevIdentityProvider } from '../apps/api/src/identity.ts';
import { silentLogger } from '../apps/api/src/logger.ts';
import { migrateUp } from '../apps/api/src/migrate.ts';
import { seedDemo } from '../apps/api/src/seed-demo.ts';
import type { AiProvider } from '../apps/api/src/ai/provider.ts';

export const SSO_SECRET = 's'.repeat(48);
export const HMAC_SECRET = 'h'.repeat(48);
export const API = '/ada/api/ada';
export const T0 = new Date('2026-10-27T15:00:00Z');

export interface Harness {
  d: Deps;
  app: FastifyInstance;
  identity: DevIdentityProvider;
  clock: { t: Date };
  advance(ms: number): void;
  login(login: string, unitId?: number): Promise<Client>;
  close(): Promise<void>;
}

export class Client {
  constructor(private readonly app: FastifyInstance, public cookie: string, public csrf: string) {}
  private async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url: API + path,
      headers: { cookie: this.cookie, ...(method === 'GET' ? {} : { 'x-csrf-token': this.csrf }), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: payload !== undefined ? JSON.stringify(payload) : undefined
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- respostas dinâmicas inspecionadas nos testes
    let json: any = undefined;
    try {
      json = res.json();
    } catch {
      /* corpo vazio ou não-JSON */
    }
    return { status: res.statusCode, json, body: res.body, headers: res.headers };
  }
  get(p: string) {
    return this.req('GET', p);
  }
  post(p: string, b: unknown = {}, h?: Record<string, string>) {
    return this.req('POST', p, b, h);
  }
  put(p: string, b: unknown) {
    return this.req('PUT', p, b);
  }
  patch(p: string, b: unknown) {
    return this.req('PATCH', p, b);
  }
  del(p: string) {
    return this.req('DELETE', p);
  }
}

export function cookieFrom(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = arr.find((x) => x.startsWith('ada_sid='));
  return c ? c.split(';')[0]! : '';
}

export async function setup(opts: { ai?: AiProvider; env?: Record<string, string> } = {}): Promise<Harness> {
  const config = loadConfig({
    ADA_ENV: 'test',
    ADA_DEV_LOGIN: '1',
    ADA_DEMO_DATA: '1',
    ADA_SSO_HS256_SECRET: SSO_SECRET,
    ADA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    ADA_INTERNAL_HMAC_SECRET: HMAC_SECRET,
    ADA_FRAME_ANCESTORS: "'self' https://possebon.exemplo.com.br",
    ADA_ALLOWED_ORIGINS: 'https://possebon.exemplo.com.br http://localhost',
    ADA_CHAT_PER_MINUTE: '500',
    ...opts.env
  });
  const db = await createPglite();
  const identity = new DevIdentityProvider();
  const clock = { t: new Date(T0) };
  const d = await createDeps(config, { db, identity, now: () => clock.t, log: silentLogger, ai: opts.ai });
  await migrateUp(db);
  await seedDemo(db, { now: T0 });
  await d.catalog.syncToDb();
  const app = await buildApp(d);
  return {
    d,
    app,
    identity,
    clock,
    advance(ms) {
      clock.t = new Date(clock.t.getTime() + ms);
    },
    async login(login, unitId) {
      const res = await app.inject({ method: 'POST', url: `${API}/dev/login`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ login, unitId }) });
      if (res.statusCode !== 200) throw new Error(`login ${login} falhou: ${res.statusCode} ${res.body}`);
      return new Client(app, cookieFrom(res.headers['set-cookie']), (res.json() as { me: { csrfToken: string } }).me.csrfToken);
    },
    async close() {
      await app.close();
      await db.close();
    }
  };
}

export function signInternal(body: unknown, now: Date, secret = HMAC_SECRET) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(now.getTime() / 1000);
  return { raw, headers: { 'content-type': 'application/json', 'x-ada-timestamp': String(ts), 'x-ada-signature': 'sha256=' + createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex') } };
}
