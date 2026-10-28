import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signTicketHs256 } from '../apps/api/src/crypto.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { API, Client, cookieFrom, setup, signInternal, SSO_SECRET, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => h.close());

function ticket(over: Record<string, unknown> = {}, secret = SSO_SECRET) {
  const now = Math.floor(h.clock.t.getTime() / 1000);
  return signTicketHs256({ iss: 'possebon-web', aud: 'ada-possebon', sub: '9002', unit_id: 1, jti: randomUUID(), iat: now, exp: now + 60, ...over } as never, secret);
}

async function exchange(t: string, form = false) {
  return h.app.inject({
    method: 'POST',
    url: `${API}/session/exchange`,
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', origin: 'https://possebon.exemplo.com.br' },
    payload: form ? `ticket=${encodeURIComponent(t)}` : JSON.stringify({ ticket: t })
  });
}

describe('SSO por ticket de troca', () => {
  it('ticket válido cria sessão com cookie HttpOnly e contexto resolvido no servidor', async () => {
    const res = await exchange(ticket());
    expect(res.statusCode).toBe(200);
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/ada_sid=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\/ada/);
    const me = await h.app.inject({ method: 'GET', url: `${API}/me`, headers: { cookie: cookieFrom(res.headers['set-cookie']) } });
    expect(me.json()).toMatchObject({ user: { systemUserId: 9002 }, activeUnit: { id: 1 }, isAdmin: false });
  });

  it('POST de formulário (iframe) redireciona para a aplicação', async () => {
    const res = await exchange(ticket(), true);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/ada/');
  });

  it('rejeita replay do mesmo ticket', async () => {
    const t = ticket();
    expect((await exchange(t)).statusCode).toBe(200);
    expect((await exchange(t)).statusCode).toBe(401);
  });

  it('rejeita expirado, validade longa, audiência/emissor errados e assinatura inválida', async () => {
    const now = Math.floor(h.clock.t.getTime() / 1000);
    expect((await exchange(ticket({ iat: now - 120, exp: now - 60 }))).statusCode).toBe(401);
    expect((await exchange(ticket({ exp: now + 3600 }))).statusCode).toBe(401);
    expect((await exchange(ticket({ aud: 'outro-sistema' }))).statusCode).toBe(401);
    expect((await exchange(ticket({ iss: 'atacante' }))).statusCode).toBe(401);
    expect((await exchange(ticket({}, 'x'.repeat(48)))).statusCode).toBe(401);
    expect((await exchange('a.b.c'.repeat(10))).statusCode).toBe(401);
  });

  it('rejeita unidade não autorizada para o usuário (troca de unidade no ticket)', async () => {
    const res = await exchange(ticket({ unit_id: 2 }));
    expect(res.statusCode).toBe(403);
  });

  it('auditoria registra rejeições sem segredos', async () => {
    const r = await h.d.db.query<{ details: Record<string, unknown> }>(`SELECT details FROM ada.audit_event WHERE action = 'sso.ticket_rejeitado'`);
    expect(r.rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(r.rows)).not.toContain(SSO_SECRET);
  });
});

describe('sessão, CSRF, origem e revogação', () => {
  it('mutação sem CSRF ou de origem não autorizada é recusada', async () => {
    const c = await h.login('gerente.a');
    const noCsrf = await h.app.inject({ method: 'POST', url: `${API}/conversations`, headers: { cookie: c.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(noCsrf.statusCode).toBe(403);
    const badOrigin = await c.post('/conversations', {}, { origin: 'https://atacante.exemplo' });
    expect(badOrigin.status).toBe(403);
    expect((await c.post('/conversations', {})).status).toBe(200);
  });

  it('sem sessão: 401', async () => {
    const r = await h.app.inject({ method: 'GET', url: `${API}/me` });
    expect(r.statusCode).toBe(401);
  });

  it('logout invalida o cookie', async () => {
    const c = await h.login('colab.a');
    expect((await c.post('/session/logout')).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('troca de unidade só para unidades permitidas', async () => {
    const admin = await h.login('admin.demo');
    expect((await admin.post('/session/unit', { unitId: 2 })).json).toMatchObject({ activeUnit: { id: 2 } });
    const ga = await h.login('gerente.a');
    expect((await ga.post('/session/unit', { unitId: 2 })).status).toBe(403);
    expect((await ga.get('/me')).json).toMatchObject({ activeUnit: { id: 1 } });
  });

  it('revogação pelo POSSEBON (HMAC) encerra todas as sessões do usuário', async () => {
    const c = await h.login('colab.b');
    const body = { system_user_id: 9005, reason: 'logout_no_possebon' };
    const bad = await h.app.inject({ method: 'POST', url: `${API}/internal/revoke`, headers: { 'content-type': 'application/json', 'x-ada-timestamp': '1', 'x-ada-signature': 'sha256=00' }, payload: JSON.stringify(body) });
    expect(bad.statusCode).toBe(401);
    const s = signInternal(body, h.clock.t);
    const ok = await h.app.inject({ method: 'POST', url: `${API}/internal/revoke`, headers: s.headers, payload: s.raw });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('mudança de grupo no POSSEBON é aplicada quando o cache de permissões expira', async () => {
    const c = await h.login('gerente.a');
    expect((await c.get('/me')).json).toMatchObject({ roles: ['user', 'manager'] });
    h.identity.update(9002, { units: [{ id: 2, name: 'Unidade Sintética Sul' }] }); // perdeu a unidade 1
    h.advance(10 * 60_000); // > ADA_PERMISSION_TTL_SECONDS
    expect((await c.get('/me')).status).toBe(401);
    h.identity.update(9002, { units: [{ id: 1, name: 'Unidade Sintética Norte' }] });
  });

  it('usuário desativado no POSSEBON perde a sessão', async () => {
    const c = await h.login('colab.a');
    h.identity.update(9004, { active: false });
    h.advance(10 * 60_000);
    expect((await c.get('/me')).status).toBe(401);
    h.identity.update(9004, { active: true });
  });
});

describe('incorporação (iframe) e cabeçalhos', () => {
  it('CSP frame-ancestors restringe à origem oficial e não envia X-Frame-Options', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/ada/healthz' });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'self' https://possebon.exemplo.com.br");
    expect(r.headers['x-frame-options']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('respostas da API não são cacheáveis', async () => {
    const c = await h.login('gerente.a');
    expect((await c.get('/me')).headers['cache-control']).toBe('no-store');
  });

  it('login de desenvolvimento não existe quando desabilitado', async () => {
    const h2 = await setup({ env: { ADA_DEV_LOGIN: '0' } });
    const r = await h2.app.inject({ method: 'POST', url: `${API}/dev/login`, headers: { 'content-type': 'application/json' }, payload: '{"login":"admin.demo"}' });
    expect(r.statusCode).toBe(404);
    await h2.close();
    void Client;
  });

  it('configuração de produção recusa login de dev, dados sintéticos, curinga e falta de chaves', () => {
    const prod = { ADA_ENV: 'production', DATABASE_URL: 'postgres://x', ADA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), ADA_SSO_HS256_SECRET: 'k'.repeat(40) };
    expect(() => loadConfig(prod)).not.toThrow();
    expect(() => loadConfig({ ...prod, ADA_DEV_LOGIN: '1' })).toThrow(/ADA_DEV_LOGIN/);
    expect(() => loadConfig({ ...prod, ADA_DEMO_DATA: '1' })).toThrow(/sintéticos/);
    expect(() => loadConfig({ ...prod, ADA_FRAME_ANCESTORS: '*' })).toThrow(/curinga/);
    expect(() => loadConfig({ ...prod, ADA_ENCRYPTION_KEY: '' })).toThrow(/ENCRYPTION/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: '' })).toThrow(/PostgreSQL/);
    expect(loadConfig(prod).session.cookieSecure).toBe(true);
    // .env remove aspas simples: palavras-chave CSP são normalizadas
    expect(loadConfig({ ...prod, ADA_FRAME_ANCESTORS: 'self https://possebon.exemplo.com.br' }).frameAncestors).toBe("'self' https://possebon.exemplo.com.br");
  });
});
