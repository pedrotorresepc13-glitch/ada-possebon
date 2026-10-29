import type { AuthContext, IntegrationStatus } from '@ada/contracts';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { HttpError, invalid, notFound } from '../errors.ts';

/** Saúde, conectores, políticas, IA e auditoria — somente administração autorizada. */
export class AdminService {
  constructor(private readonly d: Deps) {}

  async health() {
    const t0 = Date.now();
    let dbOk = true;
    try {
      await this.d.db.query('SELECT 1');
    } catch {
      dbOk = false;
    }
    const dbLatencyMs = Date.now() - t0;
    if (!dbOk) return { ok: false, database: { ok: false } };
    const q = async <T>(sql: string) => (await this.d.db.query<T>(sql)).rows;
    const [workers, queues, ai, monitors] = await Promise.all([
      q<{ worker_id: string; last_beat_at: Date; started_at: Date; info: unknown }>(`SELECT worker_id, last_beat_at, started_at, info FROM ada.worker_heartbeat WHERE last_beat_at > now() - interval '10 minutes' ORDER BY last_beat_at DESC LIMIT 10`),
      q<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM ada.monitor_rule WHERE status IN ('active','degraded') AND deleted_at IS NULL AND next_run_at <= now()) AS monitores_vencidos,
                (SELECT count(*)::int FROM ada.knowledge_document WHERE status = 'aguardando') AS documentos_aguardando,
                (SELECT count(*)::int FROM ada.knowledge_document WHERE status = 'revisando') AS documentos_em_revisao,
                (SELECT count(*)::int FROM ada.knowledge_document WHERE status = 'erro') AS documentos_com_erro,
                (SELECT count(*)::int FROM ada.inbound_event WHERE processed_at IS NULL) AS eventos_pendentes`
      ),
      q<Record<string, number>>(
        `SELECT count(*)::int AS chamadas_24h, COALESCE(sum(input_tokens),0)::int AS tokens_entrada_24h, COALESCE(sum(output_tokens),0)::int AS tokens_saida_24h,
                count(*) FILTER (WHERE status <> 'ok')::int AS falhas_24h FROM ada.ai_usage WHERE created_at > now() - interval '1 day'`
      ),
      q<Record<string, number>>(
        `SELECT count(*) FILTER (WHERE status = 'active')::int AS ativos, count(*) FILTER (WHERE status = 'degraded')::int AS degradados,
                count(*) FILTER (WHERE status = 'paused')::int AS pausados FROM ada.monitor_rule WHERE deleted_at IS NULL`
      )
    ]);
    const now = this.d.now().getTime();
    const workerAlive = workers.some((w) => now - new Date(w.last_beat_at).getTime() < 120_000);
    return {
      ok: dbOk && workerAlive,
      database: { ok: dbOk, latencyMs: dbLatencyMs, driver: this.d.db.kind },
      worker: { alive: workerAlive, instances: workers },
      queues: queues[0],
      monitors: monitors[0],
      ai: { provider: this.d.ai.name, model: this.d.ai.model || null, configured: this.d.ai.configured, ...ai[0] },
      identity: { provider: this.d.identity.kind, status: this.d.identity.status() },
      environment: this.d.config.env,
      demoData: this.d.config.demoData
    };
  }

  async connectors() {
    const r = await this.d.db.query(`SELECT id, kind, label, status, config, allowed_operations, allowed_units, watermark, last_check_at, last_error, updated_at FROM ada.source_connector ORDER BY id`);
    return r.rows;
  }

  /** Admin pode desabilitar uma fonte ou restaurar seu status padrão. Nunca "ativa" sem implementação validada. */
  async setConnectorStatus(ctx: AuthContext, id: string, status: IntegrationStatus) {
    const cur = await this.d.db.query<{ status: IntegrationStatus }>(`SELECT status FROM ada.source_connector WHERE id = $1`, [id]);
    if (!cur.rows[0]) throw notFound('Conector');
    const def = this.d.catalog.catalog.sources[id];
    const allowed: IntegrationStatus[] = ['desabilitado', def ? def.defaultStatus : 'nao_configurado'];
    if (!allowed.includes(status)) throw invalid(`Transição não permitida. Valores aceitos: ${allowed.join(', ')}.`);
    await this.d.db.query(`UPDATE ada.source_connector SET status = $2, updated_by = $3, updated_at = now(), last_error = NULL WHERE id = $1`, [id, status, ctx.systemUserId]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conector.status_alterado', targetType: 'connector', targetId: id, outcome: 'ok', details: { from: cur.rows[0].status, to: status } });
  }

  async testConnector(ctx: AuthContext, id: string) {
    let ok = false;
    let message = 'Conector não configurado neste ambiente. Ver docs/ADA_INTEGRACAO_POSSEBON.md.';
    let status: IntegrationStatus = 'nao_configurado';

    if (id === 'possebon.identity' && this.d.identity.kind === 'possebon' && this.d.identity.status() !== 'nao_configurado') {
      status = 'erro';
      try {
        const r = await this.d.identity.resolve(ctx.systemUserId);
        ok = Boolean(r);
        message = ok ? 'Identidade real do POSSEBON validada para este usuário.' : 'Endpoint respondeu, mas não reconheceu o usuário.';
      } catch (err) {
        message = (err as Error).message;
      }
    } else if (id === 'possebon.brain' && this.d.brain.configured) {
      status = 'erro';
      try {
        // Somente consulta read-only sob identidade, unidade e programas da sessão.
        const hits = await this.d.brain.search(ctx, 'POSSEBON: informações institucionais e arquitetura', 3);
        ok = true; // HTTP 200 e contrato válido; uma busca vazia não significa falha de conexão.
        message = `Conexão Brain validada para a unidade ativa. Trechos encontrados: ${hits.length}. Isso não confirma existência de métricas operacionais.`;
      } catch (err) {
        message = (err as Error).message;
      }
    } else if (this.d.catalog.catalog.sources[id]) {
      status = 'erro';
      try {
        await this.d.catalog.adapterFor(id);
        ok = true;
        message = 'Fonte sintética de demonstração disponível.';
      } catch (err) {
        message = (err as Error).message;
      }
    }
    if (ok) status = 'ativo';
    await this.d.db.query(
      `UPDATE ada.source_connector SET status = $2, last_check_at = now(), last_error = $3 WHERE id = $1`,
      [id, status, ok ? null : message]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conector.teste', targetType: 'connector', targetId: id, outcome: ok ? 'ok' : 'erro' });
    return { ok, message };
  }

  policies(ctx: AuthContext) {
    return {
      authority: 'Grupos, programas e unidades do POSSEBON Web (system_group, system_user_group, system_group_program, system_user_program, system_user_unit).',
      mapping: {
        admin: `programa ${this.d.config.programs.admin}`,
        manager: `escopo gerencial calculado pelo POSSEBON (manager_unit_ids) ou programa ${this.d.config.programs.manager}`,
        crossUnit: `programa ${this.d.config.programs.crossUnit} (consolidação entre unidades)`,
        access: this.d.config.programs.access ? `programa ${this.d.config.programs.access}` : 'qualquer usuário ativo autenticado pelo POSSEBON'
      },
      permissionCacheTtlSeconds: this.d.config.permissionTtlSeconds,
      sharing: 'Dashboards privados por padrão; publicação somente por gestores/admin; quem recebe precisa de permissão em cada métrica.',
      privacy: 'Conversas e memórias são privadas do dono. A administração não acessa conteúdo de conversas pela ADA. Auditoria excepcional exige procedimento separado (não implementado).',
      monitoring: 'Regras declarativas; execução determinística sem IA; notificações somente ao dono; cooldown e deduplicação.',
      myEffectiveContext: { ...ctx, sessionId: undefined }
    };
  }

  async auditLog(limit = 200, action?: string) {
    const r = await this.d.db.query(
      `SELECT id, occurred_at, actor_user_id, unit_id, action, target_type, target_id, outcome, details FROM ada.audit_event
       WHERE ($1::text IS NULL OR action LIKE $1 || '%') ORDER BY id DESC LIMIT $2`,
      [action ?? null, Math.min(limit, 1000)]
    );
    return r.rows;
  }

  async usage() {
    const r = await this.d.db.query(
      `SELECT date_trunc('day', created_at) AS dia, provider, model, count(*)::int AS chamadas, sum(input_tokens)::int AS entrada, sum(output_tokens)::int AS saida,
              count(*) FILTER (WHERE status <> 'ok')::int AS falhas FROM ada.ai_usage WHERE created_at > now() - interval '30 days' GROUP BY 1,2,3 ORDER BY 1 DESC`
    );
    return r.rows;
  }

  async heartbeat(workerId: string, info: Record<string, unknown>) {
    await this.d.db.query(
      `INSERT INTO ada.worker_heartbeat (worker_id, started_at, last_beat_at, info) VALUES ($1, now(), now(), $2)
       ON CONFLICT (worker_id) DO UPDATE SET last_beat_at = now(), info = EXCLUDED.info`,
      [workerId, info]
    );
  }
}

export const ConnectorStatusInput = z.object({ status: z.enum(['desabilitado', 'demonstracao', 'nao_configurado']) }).strict();
export { HttpError };
