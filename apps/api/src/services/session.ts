import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { randomToken, sha256, verifyTicketSignature } from '../crypto.ts';
import { buildAuthContext, IdentityUnavailableError, InactiveUserError, UnitNotAllowedError, type ResolvedIdentity } from '../identity.ts';

export class AuthError extends Error {
  constructor(message: string, readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' = 'UNAUTHENTICATED') {
    super(message);
  }
}

interface SessionRow {
  id: string;
  csrf_token: string;
  system_user_id: number;
  active_unit_id: number;
  identity_source: AuthContext['identitySource'];
  last_seen_at: Date;
  idle_expires_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export class SessionService {
  constructor(private readonly d: Deps) {}

  /** Resolve (com cache curto e invalidável) o contexto autoritativo do usuário em uma unidade. */
  async resolveContext(systemUserId: number, unitId: number, sessionId: string, opts: { force?: boolean } = {}): Promise<AuthContext> {
    const now = this.d.now();
    if (!opts.force) {
      const cached = await this.d.db.query<{ context: AuthContext }>(
        `SELECT context FROM ada.permission_cache WHERE system_user_id = $1 AND unit_id = $2 AND expires_at > $3`,
        [systemUserId, unitId, now]
      );
      if (cached.rows[0]) return { ...cached.rows[0].context, sessionId };
    }
    const identity = await this.d.identity.resolve(systemUserId);
    if (!identity) throw new InactiveUserError('Usuário não encontrado no POSSEBON');
    const ctx = buildAuthContext(identity, unitId, sessionId, this.d.config.programs, this.d.identity.kind);
    await this.d.db.query(
      `INSERT INTO ada.permission_cache (system_user_id, unit_id, context, permissions_version, resolved_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (system_user_id, unit_id) DO UPDATE SET context = EXCLUDED.context,
         permissions_version = EXCLUDED.permissions_version, resolved_at = EXCLUDED.resolved_at, expires_at = EXCLUDED.expires_at`,
      [systemUserId, unitId, { ...ctx, sessionId: '' }, ctx.permissionsVersion, now, new Date(now.getTime() + this.d.config.permissionTtlSeconds * 1000)]
    );
    return ctx;
  }

  private async upsertIdentity(identity: ResolvedIdentity): Promise<void> {
    await this.d.db.query(
      `INSERT INTO ada.user_identity_map (system_user_id, login, display_name, identity_source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (system_user_id) DO UPDATE SET login = EXCLUDED.login, display_name = EXCLUDED.display_name, last_seen_at = now()`,
      [identity.systemUserId, identity.login, identity.displayName, this.d.identity.kind]
    );
  }

  /** Cria sessão própria da ADA após identidade comprovada (ticket SSO ou login de desenvolvimento). */
  async establish(systemUserId: number, unitId: number, userAgent: string | undefined): Promise<{ token: string; csrfToken: string; ctx: AuthContext }> {
    const identity = await this.d.identity.resolve(systemUserId);
    if (!identity) throw new AuthError('Usuário não encontrado no POSSEBON');
    let ctx: AuthContext;
    try {
      ctx = buildAuthContext(identity, unitId, 'pending', this.d.config.programs, this.d.identity.kind);
    } catch (err) {
      if (err instanceof UnitNotAllowedError || err instanceof InactiveUserError) throw new AuthError(err.message, 'FORBIDDEN');
      throw err;
    }
    await this.upsertIdentity(identity);
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const now = this.d.now();
    const { session } = this.d.config;
    const r = await this.d.db.query<{ id: string }>(
      `INSERT INTO ada.user_session (token_hash, csrf_token, system_user_id, active_unit_id, identity_source, created_at, last_seen_at, idle_expires_at, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9) RETURNING id`,
      [
        sha256(token), csrfToken, systemUserId, unitId, this.d.identity.kind, now,
        new Date(now.getTime() + session.idleMinutes * 60_000),
        new Date(now.getTime() + session.ttlHours * 3_600_000),
        (userAgent ?? '').slice(0, 300)
      ]
    );
    const sessionId = r.rows[0]!.id;
    // Permissões sempre recalculadas no login.
    const fresh = await this.resolveContext(systemUserId, unitId, sessionId, { force: true });
    await audit(this.d.db, { actor: systemUserId, unit: unitId, action: 'sessao.criada', targetType: 'session', targetId: sessionId, outcome: 'ok', details: { source: this.d.identity.kind } });
    return { token, csrfToken, ctx: fresh ?? ctx };
  }

  /** Autentica uma requisição pelo cookie. Revalida permissões quando o cache expira. */
  async authenticate(token: string | undefined): Promise<{ ctx: AuthContext; csrfToken: string } | null> {
    if (!token || token.length > 200) return null;
    const now = this.d.now();
    const r = await this.d.db.query<SessionRow>(
      `SELECT id, csrf_token, system_user_id, active_unit_id, identity_source, last_seen_at, idle_expires_at, expires_at, revoked_at
       FROM ada.user_session WHERE token_hash = $1`,
      [sha256(token)]
    );
    const s = r.rows[0];
    if (!s || s.revoked_at || s.expires_at <= now || s.idle_expires_at <= now) return null;
    let ctx: AuthContext;
    try {
      ctx = await this.resolveContext(s.system_user_id, s.active_unit_id, s.id);
    } catch (err) {
      if (err instanceof InactiveUserError || err instanceof UnitNotAllowedError) {
        await this.revokeUser(s.system_user_id, 'permissao_revogada_no_possebon');
        return null;
      }
      if (err instanceof IdentityUnavailableError) throw err;
      throw err;
    }
    if (now.getTime() - new Date(s.last_seen_at).getTime() > 60_000) {
      await this.d.db.query(`UPDATE ada.user_session SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1`, [
        s.id, now, new Date(Math.min(now.getTime() + this.d.config.session.idleMinutes * 60_000, new Date(s.expires_at).getTime()))
      ]);
    }
    return { ctx, csrfToken: s.csrf_token };
  }

  async switchUnit(ctx: AuthContext, unitId: number): Promise<AuthContext> {
    const fresh = await this.resolveContext(ctx.systemUserId, unitId, ctx.sessionId, { force: true }).catch((err) => {
      if (err instanceof UnitNotAllowedError) throw new AuthError('Unidade não autorizada', 'FORBIDDEN');
      throw err;
    });
    await this.d.db.query(`UPDATE ada.user_session SET active_unit_id = $2 WHERE id = $1`, [ctx.sessionId, unitId]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: unitId, action: 'sessao.troca_unidade', outcome: 'ok', details: { from: ctx.activeUnitId } });
    return fresh;
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.d.db.query(`UPDATE ada.user_session SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, reason]);
  }

  /** Revoga todas as sessões e o cache de permissões do usuário (logout global, mudança de grupo, desativação). */
  async revokeUser(systemUserId: number, reason: string): Promise<number> {
    const r = await this.d.db.query(`UPDATE ada.user_session SET revoked_at = now(), revoked_reason = $2 WHERE system_user_id = $1 AND revoked_at IS NULL`, [systemUserId, reason]);
    await this.d.db.query(`DELETE FROM ada.permission_cache WHERE system_user_id = $1`, [systemUserId]);
    await audit(this.d.db, { actor: null, action: 'sessao.revogacao_usuario', targetType: 'user', targetId: String(systemUserId), outcome: 'ok', details: { reason, sessions: r.rowCount } });
    return r.rowCount;
  }

  /**
   * Troca um ticket SSO de curta duração, uso único, por sessão da ADA.
   * Valida assinatura, emissor, audiência, expiração, idade máxima e replay.
   */
  async exchangeTicket(ticket: string, userAgent: string | undefined) {
    const { sso } = this.d.config;
    if (!sso.hs256Secret && !sso.ed25519PublicKey) throw new AuthError('SSO não configurado neste ambiente', 'FORBIDDEN');
    let claims: Record<string, unknown>;
    try {
      claims = verifyTicketSignature(ticket, sso);
    } catch (err) {
      await audit(this.d.db, { action: 'sso.ticket_rejeitado', outcome: 'negado', details: { motivo: (err as Error).message } });
      throw new AuthError('Ticket inválido');
    }
    const nowS = Math.floor(this.d.now().getTime() / 1000);
    const reject = async (motivo: string) => {
      await audit(this.d.db, { action: 'sso.ticket_rejeitado', outcome: 'negado', details: { motivo, sub: claims.sub } });
      throw new AuthError('Ticket inválido ou expirado');
    };
    const iat = Number(claims.iat);
    const exp = Number(claims.exp);
    const sub = Number(claims.sub);
    const unitId = Number(claims.unit_id);
    const jti = typeof claims.jti === 'string' ? claims.jti : '';
    if (claims.iss !== sso.issuer) await reject('emissor');
    if (claims.aud !== sso.audience) await reject('audiencia');
    if (!Number.isInteger(sub) || sub <= 0 || !Number.isInteger(unitId) || unitId <= 0) await reject('claims');
    if (!jti || jti.length < 16 || jti.length > 128) await reject('jti');
    if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= nowS || iat > nowS + 30) await reject('expirado');
    if (exp - iat > sso.maxAgeSeconds) await reject('validade_excessiva');
    const used = await this.d.db.query(
      `INSERT INTO ada.sso_ticket_use (jti, system_user_id, expires_at) VALUES ($1, $2, to_timestamp($3)) ON CONFLICT (jti) DO NOTHING`,
      [jti, sub, exp]
    );
    if (used.rowCount === 0) await reject('replay');
    return this.establish(sub, unitId, userAgent);
  }
}
