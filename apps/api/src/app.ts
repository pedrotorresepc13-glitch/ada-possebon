import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { NormalizedEvent, ShareInput, type AuthContext, type MeResponse } from '@ada/contracts';
import { assertAdmin, AuthorizationError, formatMetricValue } from '@ada/domain';
import type { Deps } from './core.ts';
import { audit } from './audit.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';
import { HttpError, invalid } from './errors.ts';
import { DevIdentityProvider, IdentityUnavailableError } from './identity.ts';
import { AuthError } from './services/session.ts';
import { ConnectorStatusInput } from './services/admin.ts';

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: AuthContext;
    csrf?: string;
    rawBody?: string;
  }
}

const COOKIE = 'ada_sid';

type Guard = 'none' | 'user' | 'admin' | 'internal';

export async function buildApp(d: Deps): Promise<FastifyInstance> {
  const { config } = d;
  const base = config.basePath;
  const api = `${base}/api/ada`;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: '127.0.0.1' });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: config.uploadMaxBytes, files: 20, fields: 10 } });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'VALIDATION', 'JSON inválido.'), undefined);
    }
  });

  /* ------------------------------------------------------------- cabeçalhos de segurança */
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${config.frameAncestors}`
  ].join('; ');
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    // Sem X-Frame-Options: a política de incorporação é exclusivamente CSP frame-ancestors (allowlist).
    if (req.url.startsWith(api)) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  /* ------------------------------------------------------------- erros */
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof AuthError) return reply.code(err.code === 'FORBIDDEN' ? 403 : 401).send({ error: { code: err.code, message: err.message } });
    if (err instanceof AuthorizationError) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: err.message } });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'Dados inválidos.', details: err.issues } });
    if (err instanceof IdentityUnavailableError) return reply.code(503).send({ error: { code: 'SOURCE_UNAVAILABLE', message: 'Não foi possível validar permissões no POSSEBON agora. Tente novamente.' } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 413 || e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: { code: 'VALIDATION', message: 'Arquivo ou requisição grande demais.' } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'VALIDATION', message: e.message ?? 'Requisição inválida.' } });
    d.log.error({ err, url: req.url.split('?')[0] }, 'erro não tratado');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Erro interno. A ocorrência foi registrada.' } });
  });

  /* ------------------------------------------------------------- autenticação e proteções */
  const originAllowed = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (!origin) return true; // navegadores sempre enviam Origin em POST cross-site; ausência = mesma origem/cliente servidor
    return config.allowedOrigins.has(origin);
  };

  async function guard(req: FastifyRequest, kind: Guard) {
    if (kind === 'none') return;
    if (kind === 'internal') {
      const secret = config.internalHmacSecret;
      if (!secret) throw new HttpError(503, 'NOT_CONFIGURED', 'Canal servidor-servidor não configurado.');
      const ts = Number(req.headers['x-ada-timestamp']);
      const sig = String(req.headers['x-ada-signature'] ?? '');
      if (!Number.isFinite(ts) || Math.abs(d.now().getTime() / 1000 - ts) > 300) throw new HttpError(401, 'UNAUTHENTICATED', 'Assinatura expirada.');
      const expected = 'sha256=' + hmacSha256Hex(secret, `${ts}.${req.rawBody ?? ''}`);
      if (!safeEqual(sig, expected)) throw new HttpError(401, 'UNAUTHENTICATED', 'Assinatura inválida.');
      return;
    }
    const auth = await d.sessions.authenticate(req.cookies[COOKIE]);
    if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada. Abra a ADA pelo POSSEBON Web.');
    req.ctx = auth.ctx;
    req.csrf = auth.csrfToken;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!originAllowed(req)) throw new HttpError(403, 'CSRF', 'Origem não autorizada.');
      const token = String(req.headers['x-csrf-token'] ?? '');
      if (!token || !safeEqual(token, auth.csrfToken)) throw new HttpError(403, 'CSRF', 'Token CSRF inválido.');
    }
    if (kind === 'admin') {
      try {
        assertAdmin(auth.ctx);
      } catch (err) {
        await audit(d.db, { actor: auth.ctx.systemUserId, unit: auth.ctx.activeUnitId, action: 'admin.acesso_negado', outcome: 'negado', details: { path: req.url.split('?')[0] } });
        throw err;
      }
    }
  }

  type Handler = (req: FastifyRequest, reply: FastifyReply, ctx: AuthContext) => unknown;
  const route = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, kind: Guard, handler: Handler) => {
    app.route({
      method,
      url: api + url,
      handler: async (req, reply) => {
        await guard(req, kind);
        const out = await handler(req, reply, req.ctx as AuthContext);
        if (reply.sent) return;
        return out === undefined ? reply.code(204).send() : out;
      }
    });
  };
  const params = (req: FastifyRequest) => req.params as Record<string, string>;
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const query = (req: FastifyRequest) => (req.query ?? {}) as Record<string, string | undefined>;

  const cookieOpts = () => ({
    path: base || '/',
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.sameSite.toLowerCase() as 'lax' | 'strict' | 'none',
    maxAge: config.session.ttlHours * 3600
  });

  const me = (ctx: AuthContext, csrf: string): MeResponse => ({
    user: { systemUserId: ctx.systemUserId, login: ctx.login, displayName: ctx.displayName },
    activeUnit: ctx.units.find((u) => u.id === ctx.activeUnitId) ?? { id: ctx.activeUnitId, name: `Unidade ${ctx.activeUnitId}` },
    units: ctx.units,
    roles: ctx.roles,
    isAdmin: ctx.roles.includes('admin'),
    identitySource: ctx.identitySource,
    csrfToken: csrf,
    ai: { configured: d.ai.configured, provider: d.ai.name, mode: d.ai.configured ? 'openai' : 'deterministico' },
    demoData: config.demoData
  });

  /* ------------------------------------------------------------- saúde (sem dados) */
  app.get(`${base}/healthz`, async () => {
    await d.db.query('SELECT 1');
    return { ok: true, service: 'ada-api' };
  });

  /* ------------------------------------------------------------- sessão / SSO */
  route('POST', '/session/exchange', 'none', async (req, reply) => {
    const ticket = z.object({ ticket: z.string().min(20).max(4096) }).parse(body(req)).ticket;
    const s = await d.sessions.exchangeTicket(ticket, req.headers['user-agent']);
    reply.setCookie(COOKIE, s.token, cookieOpts());
    d.study.schedule(s.ctx);
    if (String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return reply.code(303).redirect(`${base}/`);
    return { ok: true };
  });

  route('POST', '/dev/login', 'none', async (req, reply) => {
    if (!config.devLogin || config.isProduction || !(d.identity instanceof DevIdentityProvider)) {
      throw new HttpError(404, 'NOT_FOUND', 'Recurso não encontrado.');
    }
    const b = z.object({ login: z.string().max(60), unitId: z.number().int().positive().optional() }).parse(body(req));
    const u = d.identity.findByLogin(b.login);
    if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Usuário sintético inexistente.');
    const s = await d.sessions.establish(u.systemUserId, b.unitId ?? u.units[0]!.id, req.headers['user-agent']);
    reply.setCookie(COOKIE, s.token, cookieOpts());
    return { ok: true, me: me(s.ctx, s.csrfToken), synthetic: true };
  });

  app.get(`${api}/session`, async (req) => {
    const auth = await d.sessions.authenticate(req.cookies[COOKIE]);
    if (auth) await d.aiSettings.reload();
    return auth
      ? { authenticated: true, me: me(auth.ctx, auth.csrfToken) }
      : { authenticated: false, devLogin: config.devLogin, ssoConfigured: Boolean(config.sso.hs256Secret || config.sso.ed25519PublicKey) };
  });
  route('GET', '/me', 'user', async (req, _r, ctx) => {
    await d.aiSettings.reload();
    return me(ctx, req.csrf!);
  });
  route('POST', '/session/unit', 'user', async (req, _r, ctx) => {
    const unitId = z.object({ unitId: z.number().int().positive() }).parse(body(req)).unitId;
    const fresh = await d.sessions.switchUnit(ctx, unitId);
    d.study.schedule(fresh);
    return me(fresh, req.csrf!);
  });
  route('POST', '/session/logout', 'user', async (_req, reply, ctx) => {
    await d.sessions.revokeSession(ctx.sessionId, 'logout');
    reply.clearCookie(COOKIE, { path: base || '/' });
    return { ok: true };
  });

  /* ------------------------------------------------------------- canal servidor-servidor (HMAC) */
  route('POST', '/internal/revoke', 'internal', async (req) => {
    const b = z.object({ system_user_id: z.number().int().positive(), reason: z.string().max(120).default('revogado_pelo_possebon') }).parse(body(req));
    return { revokedSessions: await d.sessions.revokeUser(b.system_user_id, b.reason) };
  });
  route('POST', '/internal/events', 'internal', async (req) => {
    const ev = NormalizedEvent.parse(body(req));
    if (!d.catalog.catalog.sources[ev.source]?.monitor) throw invalid('Fonte de evento não catalogada para monitoramento.');
    const r = await d.db.query(
      `INSERT INTO ada.inbound_event (source_id, event_id, record_key, unit_id, occurred_at, payload) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_id, event_id) DO NOTHING`,
      [ev.source, ev.eventId, ev.recordKey, ev.unitId, ev.occurredAt, ev.record]
    );
    return { accepted: true, duplicate: r.rowCount === 0 };
  });

  /* ------------------------------------------------------------- conversas e chat */
  route('GET', '/conversations', 'user', (req, _r, ctx) => d.conversations.list(ctx, query(req).q));
  route('POST', '/conversations', 'user', (req, _r, ctx) => d.conversations.create(ctx, String(body(req).title ?? 'Nova conversa')));
  route('GET', '/conversations/:id', 'user', async (req, _r, ctx) => {
    const c = await d.conversations.get(ctx, params(req).id!);
    return { conversation: { id: c.id, title: c.title, createdAt: c.created_at, updatedAt: c.updated_at, dashboardId: c.dashboard_id }, draft: c.draft_dashboard, messages: await d.conversations.messages(ctx, c.id) };
  });
  route('PATCH', '/conversations/:id', 'user', async (req, _r, ctx) => {
    await d.conversations.rename(ctx, params(req).id!, z.object({ title: z.string().trim().min(1).max(120) }).parse(body(req)).title);
  });
  route('DELETE', '/conversations/:id', 'user', (req, _r, ctx) => d.conversations.remove(ctx, params(req).id!));
  route('POST', '/conversations/:id/undo', 'user', async (req, _r, ctx) => {
    const c = await d.conversations.get(ctx, params(req).id!);
    const draft = c.draft_dashboard;
    if (!draft || draft.history.length === 0) throw invalid('Nada para desfazer.');
    const prev = draft.history[draft.history.length - 1]!;
    const next = { ...draft, spec: prev, history: draft.history.slice(0, -1) };
    await d.conversations.setDraft(ctx, c.id, next);
    return { draft: next };
  });
  route('POST', '/chat', 'user', (req, _r, ctx) => d.chat.handle(ctx, body(req)));

  /* ------------------------------------------------------------- memória, preferências, LGPD */
  route('GET', '/memory', 'user', (_req, _r, ctx) => d.conversations.listMemories(ctx));
  route('POST', '/memory', 'user', (req, _r, ctx) => d.conversations.addMemory(ctx, body(req)));
  route('DELETE', '/memory/:id', 'user', (req, _r, ctx) => d.conversations.deleteMemory(ctx, params(req).id!));
  route('GET', '/preferences', 'user', (_req, _r, ctx) => d.conversations.preferences(ctx));
  route('PUT', '/preferences', 'user', (req, _r, ctx) => d.conversations.setPreferences(ctx, body(req)));
  route('GET', '/me/export', 'user', async (_req, reply, ctx) => {
    reply.header('Content-Disposition', 'attachment; filename="ada-meus-dados.json"');
    return d.conversations.exportAll(ctx);
  });

  /* ------------------------------------------------------------- conhecimento e catálogo */
  route('GET', '/knowledge/search', 'user', (req, _r, ctx) => d.knowledge.search(ctx, String(query(req).q ?? ''), 10));
  route('GET', '/study/status', 'user', (_req, _r, ctx) => d.study.status(ctx));
  route('POST', '/study/refresh', 'user', (_req, _r, ctx) => d.study.refresh(ctx));
    route('GET', '/brain/status', 'user', (_req, _r, ctx) => ({ configured: d.brain.configured, allowed: Boolean(ctx.programs.AdaConhecimentoTecnico || ctx.programs.AdaAdministracao), activeUnitId: ctx.activeUnitId }));
  route('GET', '/brain/context', 'user', (req, _r, ctx) => d.brain.search(ctx, String(query(req).q ?? '')));
  route('GET', '/metrics', 'user', async (_req, _r, ctx) => {
    const enabled = await d.catalog.enabledSourceIds();
    const { canUseMetric, queryUnitScope } = await import('@ada/domain');
    return Object.values(d.catalog.catalog.metrics)
      .filter((m) => enabled.has(m.source) && canUseMetric(ctx, d.catalog.catalog, m, queryUnitScope(ctx)).allowed)
      .map((m) => ({ id: m.id, label: m.label, description: m.description, formula: m.formula, unit: m.unit, dimensions: Object.keys(m.dimensions), comparableWith: m.comparableWith, status: m.status, refresh: m.refresh }));
  });
  route('GET', '/dimensions', 'user', () => Object.values(d.catalog.catalog.dimensions));

  /* ------------------------------------------------------------- dashboards */
  route('GET', '/dashboards', 'user', (_req, _r, ctx) => d.dashboards.list(ctx));
  route('POST', '/dashboards', 'user', async (req, reply, ctx) => {
    const b = z.object({ spec: z.unknown(), title: z.string().trim().min(1).max(120).optional() }).strict().parse(body(req));
    reply.code(201);
    return d.dashboards.create(ctx, b.spec, b.title);
  });
  route('POST', '/dashboards/preview', 'user', async (req, _r, ctx) => {
    const b = z.object({ spec: z.unknown(), filters: z.unknown().optional(), refresh: z.boolean().optional() }).strict().parse(body(req));
    const spec = d.dashboards.validateSpec(ctx, b.spec);
    return { spec, data: await d.dashboards.data(ctx, spec, { filters: b.filters, refresh: b.refresh }) };
  });
  route('GET', '/dashboards/:id', 'user', async (req, _r, ctx) => {
    const { row, access } = await d.dashboards.get(ctx, params(req).id!);
    return { ...row, access };
  });
  route('PUT', '/dashboards/:id', 'user', (req, _r, ctx) => {
    const b = z.object({ spec: z.unknown().optional(), ops: z.array(z.unknown()).optional(), summary: z.string().max(300).optional() }).parse(body(req));
    return d.dashboards.update(ctx, params(req).id!, b as never);
  });
  route('DELETE', '/dashboards/:id', 'user', (req, _r, ctx) => d.dashboards.remove(ctx, params(req).id!));
  route('GET', '/dashboards/:id/data', 'user', async (req, _r, ctx) => {
    const { row } = await d.dashboards.get(ctx, params(req).id!);
    const q = query(req);
    let filters: unknown = [];
    if (q.filters) {
      try {
        filters = JSON.parse(q.filters);
      } catch {
        throw invalid('Filtros inválidos.');
      }
    }
    const data = await d.dashboards.data(ctx, row.spec, { refresh: q.refresh === '1', filters });
    await d.dashboards.markRefreshed(row.id);
    return { dashboardId: row.id, revision: row.current_revision, generatedAt: d.now().toISOString(), data };
  });
  route('GET', '/dashboards/:id/filter-values', 'user', async (req, _r, ctx) => {
    const { row } = await d.dashboards.get(ctx, params(req).id!);
    return d.dashboards.filterValues(ctx, row.spec, String(query(req).dimension ?? ''));
  });
  route('GET', '/dashboards/:id/revisions', 'user', (req, _r, ctx) => d.dashboards.revisions(ctx, params(req).id!));
  route('POST', '/dashboards/:id/revert', 'user', (req, _r, ctx) =>
    d.dashboards.revert(ctx, params(req).id!, z.object({ revision: z.number().int().positive() }).parse(body(req)).revision)
  );
  route('POST', '/dashboards/:id/share', 'user', (req, _r, ctx) => d.dashboards.share(ctx, params(req).id!, ShareInput.parse(body(req))));
  route('DELETE', '/dashboards/:id/share', 'user', (req, _r, ctx) => d.dashboards.unshareAll(ctx, params(req).id!));
  route('GET', '/dashboards/:id/export.csv', 'user', async (req, reply, ctx) => {
    const { row } = await d.dashboards.get(ctx, params(req).id!);
    const data = await d.dashboards.data(ctx, row.spec);
    const cell = (v: string) => {
      const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // neutraliza injeção de fórmulas
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [`# ${cell(row.title)}`, `# Exportado em ${new Date(d.now()).toISOString()} (UTC) por ${cell(ctx.login)}`];
    for (const w of data) {
      const ws = row.spec.widgets.find((x) => x.id === w.widgetId)!;
      lines.push('', `# ${cell(ws.title)} — status: ${w.status}${w.message ? ' — ' + cell(w.message) : ''}`);
      lines.push(`# Fontes: ${w.provenance.sources.join(', ')}; consultado em ${w.provenance.queriedAt}${w.provenance.synthetic ? '; DADOS SINTÉTICOS' : ''}`);
      if (w.status !== 'ok') continue;
      lines.push(['Rótulo', ...w.series.map((s) => cell(s.label))].join(';'));
      for (const p of w.points) lines.push([cell(p.label), ...w.series.map((s) => formatMetricValue(p.values[s.key] ?? null, s.unit === 'BRL' ? 'quantidade' : s.unit))].join(';'));
    }
    await audit(d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'dashboard.exportado', targetType: 'dashboard', targetId: row.id, outcome: 'ok' });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="dashboard-${row.id}.csv"`);
    return '﻿' + lines.join('\r\n');
  });

  /* ------------------------------------------------------------- acompanhamentos (monitores) */
  route('GET', '/monitors', 'user', (_req, _r, ctx) => d.monitors.list(ctx));
  route('POST', '/monitors/preview', 'user', (req, _r, ctx) => d.monitors.preview(ctx, body(req).definition));
  route('POST', '/monitors', 'user', async (req, reply, ctx) => {
    const b = z.object({ definition: z.unknown(), activate: z.boolean().default(false), dashboardId: z.uuid().optional() }).strict().parse(body(req));
    if (b.dashboardId) await d.dashboards.get(ctx, b.dashboardId);
    const created = await d.monitors.create(ctx, b.definition, { dashboardId: b.dashboardId });
    const monitor = b.activate ? await d.monitors.activate(ctx, created.monitor.id) : created.monitor;
    reply.code(201);
    return { monitor, preview: created.preview };
  });
  route('GET', '/monitors/:id', 'user', (req, _r, ctx) => d.monitors.get(ctx, params(req).id!));
  route('PUT', '/monitors/:id', 'user', (req, _r, ctx) => d.monitors.update(ctx, params(req).id!, body(req).definition));
  route('POST', '/monitors/:id/activate', 'user', (req, _r, ctx) => d.monitors.activate(ctx, params(req).id!));
  route('POST', '/monitors/:id/resume', 'user', (req, _r, ctx) => d.monitors.activate(ctx, params(req).id!));
  route('POST', '/monitors/:id/pause', 'user', (req, _r, ctx) => d.monitors.pause(ctx, params(req).id!));
  route('POST', '/monitors/:id/test', 'user', async (req, _r, ctx) => {
    const m = await d.monitors.get(ctx, params(req).id!);
    return d.monitors.preview(ctx, m.definition);
  });
  route('GET', '/monitors/:id/preview', 'user', async (req, _r, ctx) => {
    const m = await d.monitors.get(ctx, params(req).id!);
    return d.monitors.preview(ctx, m.definition);
  });
  route('GET', '/monitors/:id/history', 'user', (req, _r, ctx) => d.monitors.history(ctx, params(req).id!));
  route('DELETE', '/monitors/:id', 'user', (req, _r, ctx) => d.monitors.remove(ctx, params(req).id!));

  /* ------------------------------------------------------------- notificações */
  route('GET', '/notifications', 'user', (req, _r, ctx) =>
    d.notifications.list(ctx, { unreadOnly: query(req).unread === '1', severity: query(req).severity, limit: Number(query(req).limit ?? 50) })
  );
  route('GET', '/notifications/count', 'user', async (_req, _r, ctx) => ({ unread: await d.notifications.unreadCount(ctx) }));
  route('POST', '/notifications/read-all', 'user', (_req, _r, ctx) => d.notifications.markAllRead(ctx));
  route('POST', '/notifications/:id/read', 'user', (req, _r, ctx) => d.notifications.mark(ctx, params(req).id!, 'read'));
  route('POST', '/notifications/:id/ack', 'user', (req, _r, ctx) => d.notifications.mark(ctx, params(req).id!, 'ack'));
  route('GET', '/notifications/stream', 'user', async (req, reply, ctx) => {
    // SSE: a fonte da verdade é o banco; o stream só sinaliza contagem/novidades. Revalida a sessão a cada ciclo.
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let last = -1;
    const tick = async () => {
      const auth = await d.sessions.authenticate(req.cookies[COOKIE]).catch(() => null);
      if (!auth) {
        reply.raw.write('event: sessao\ndata: {"autenticado":false}\n\n');
        reply.raw.end();
        clearInterval(timer);
        return;
      }
      const n = await d.notifications.unreadCount(auth.ctx);
      if (n !== last) reply.raw.write(`event: notificacoes\ndata: ${JSON.stringify({ unread: n })}\n\n`);
      else reply.raw.write(': ping\n\n');
      last = n;
    };
    const timer = setInterval(() => void tick().catch(() => undefined), 10_000);
    req.raw.on('close', () => clearInterval(timer));
    void ctx;
    await tick();
  });

  /* ------------------------------------------------------------- administração */
  route('GET', '/admin/health', 'admin', () => d.admin.health());
  route('GET', '/admin/connectors', 'admin', () => d.admin.connectors());
  route('POST', '/admin/connectors/:id/status', 'admin', (req, _r, ctx) => d.admin.setConnectorStatus(ctx, params(req).id!, ConnectorStatusInput.parse(body(req)).status));
  route('POST', '/admin/connectors/:id/test', 'admin', (req, _r, ctx) => d.admin.testConnector(ctx, params(req).id!));
  route('GET', '/admin/knowledge/sources', 'admin', () => d.knowledge.listSources());
  route('POST', '/admin/knowledge/sources', 'admin', (req, reply, ctx) => {
    reply.code(201);
    return d.knowledge.createSource(ctx, body(req));
  });
  route('POST', '/admin/knowledge/sources/:id/upload', 'admin', async (req, _r, ctx) => {
    const results = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const data = await part.toBuffer();
      results.push({ file: part.filename, ...(await d.knowledge.upload(ctx, params(req).id!, { filename: part.filename, mimetype: part.mimetype, data }, {})) });
    }
    if (!results.length) throw invalid('Nenhum arquivo enviado.');
    return { results };
  });
  route('POST', '/admin/knowledge/sources/:id/url', 'admin', (req, _r, ctx) =>
    d.knowledge.importUrl(ctx, params(req).id!, z.object({ url: z.string().max(2000) }).parse(body(req)).url)
  );
  route('GET', '/admin/knowledge/documents', 'admin', (req) => d.knowledge.listDocuments(query(req).status));
  route('GET', '/admin/knowledge/documents/:id', 'admin', (req) => d.knowledge.getDocument(params(req).id!));
  route('POST', '/admin/knowledge/documents/:id/review', 'admin', async (req, _r, ctx) => {
    const b = z.object({ decision: z.enum(['aprovar', 'rejeitar']), note: z.string().max(300).optional() }).parse(body(req));
    await d.knowledge.review(ctx, params(req).id!, b.decision, b.note);
  });
  route('POST', '/admin/knowledge/documents/:id/reprocess', 'admin', (req, _r, ctx) => d.knowledge.reprocess(ctx, params(req).id!));
  route('GET', '/admin/knowledge/coverage', 'admin', () => d.knowledge.coverage());
  route('GET', '/admin/email/accounts', 'admin', () => d.email.list());
  route('POST', '/admin/email/accounts', 'admin', (req, reply, ctx) => {
    reply.code(201);
    return d.email.create(ctx, body(req));
  });
  route('POST', '/admin/email/accounts/:id/test', 'admin', (req, _r, ctx) => d.email.test(ctx, params(req).id!));
  route('DELETE', '/admin/email/accounts/:id', 'admin', (req, _r, ctx) => d.email.remove(ctx, params(req).id!));
  route('GET', '/admin/ai', 'admin', () => d.aiSettings.read());
  route('PUT', '/admin/ai/settings', 'admin', (req, _r, ctx) => d.aiSettings.save(ctx, body(req)));
  route('DELETE', '/admin/ai/settings', 'admin', (_req, _r, ctx) => d.aiSettings.clear(ctx));
  route('POST', '/admin/ai/test', 'admin', (_req, _r, ctx) => d.aiSettings.test(ctx));
  route('GET', '/admin/ai/usage', 'admin', () => d.admin.usage());
  route('GET', '/admin/policies', 'admin', (_req, _r, ctx) => d.admin.policies(ctx));
  route('GET', '/admin/audit', 'admin', (req) => d.admin.auditLog(Number(query(req).limit ?? 200), query(req).action));

  /* ------------------------------------------------------------- frontend (SPA) */
  const dist = config.webDist;
  const indexPath = path.join(dist, 'index.html');
  if (existsSync(indexPath)) {
    await app.register(fastifyStatic, { root: dist, prefix: `${base}/`, index: false, wildcard: true, cacheControl: true, maxAge: '1h' });
    const indexHtml = readFileSync(indexPath, 'utf8');
    const sendIndex = (_req: FastifyRequest, reply: FastifyReply) => reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(indexHtml);
    if (base) app.get(base, (_req, reply) => reply.redirect(`${base}/`));
    app.get(`${base}/`, sendIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && req.url.startsWith(`${base}/`) && !req.url.startsWith(api)) {
        return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(indexHtml);
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota inexistente.' } });
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith(api)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota inexistente.' } });
      return reply
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><title>ADA</title><p>Frontend não compilado. Execute <code>npm run build -w @ada/web</code> ou use <code>npm run dev:web</code>.</p>');
    });
  }

  return app;
}
