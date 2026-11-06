import { RuleDefinition, type AuthContext } from '@ada/contracts';
import {
  canUseSource,
  describeRule,
  evaluateRecord,
  nextRunAt,
  normalizeRecord,
  validateRule,
  type Occurrence,
  type RecordSnapshot,
  type RecordValues,
  type SourceDef
} from '@ada/domain';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import type { Queryable } from '../db.ts';
import { audit } from '../audit.ts';
import { sha256 } from '../crypto.ts';
import { HttpError, invalid, notFound } from '../errors.ts';
import { IdentityUnavailableError, InactiveUserError, UnitNotAllowedError } from '../identity.ts';
import { SourceUnavailableError } from './catalog.ts';

const MAX_ACTIVE_PER_USER = 50;
const DEGRADE_AFTER_FAILURES = 3;

export interface MonitorRow {
  id: string;
  owner_user_id: number;
  unit_id: number;
  name: string;
  source_id: string;
  status: 'draft' | 'active' | 'paused' | 'degraded' | 'deleted';
  current_revision: number;
  definition: RuleDefinition;
  check_every_minutes: number;
  dashboard_id: string | null;
  watermark: string | null;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_success_at: Date | null;
  consecutive_failures: number;
  health: 'ok' | 'degradado' | 'erro';
  last_error: string | null;
  activated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Preview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: string[];
  checkEveryMinutes?: number;
  simulation?: { recordsMatched: number; wouldTriggerNow: { recordKey: string; title: string }[]; note: string };
}

export class MonitorService {
  constructor(private readonly d: Deps) {}

  /** RuleValidator + RulePreview/Simulator. Não grava nada. */
  async preview(ctx: AuthContext, input: unknown): Promise<Preview> {
    const v = validateRule(input, this.d.catalog.catalog, ctx, await this.d.catalog.enabledSourceIds());
    if (!v.definition || !v.source) return { valid: false, errors: v.errors, warnings: v.warnings, summary: [] };
    const summary = describeRule(v.definition, v.source, v.checkEveryMinutes!);
    const out: Preview = { valid: v.ok, errors: v.errors, warnings: v.warnings, summary, checkEveryMinutes: v.checkEveryMinutes };
    if (!v.ok) return out;
    try {
      const adapter = await this.d.catalog.adapterFor(v.source.id);
      const records = await adapter.fetchMonitorRecords({ source: v.source, unitId: ctx.activeUnitId, filters: v.definition.filters, limit: 50 });
      const now = this.d.now();
      const would: { recordKey: string; title: string }[] = [];
      for (const rec of records) {
        const values = normalizeRecord(rec, v.source.monitor!.fields);
        const key = String(values[v.source.monitor!.keyField]);
        const r = evaluateRecord({ definition: v.definition, source: v.source, recordKey: key, current: values, previous: null, now, activatedAt: now });
        for (const o of r.occurrences) would.push({ recordKey: key, title: o.title });
      }
      out.simulation = {
        recordsMatched: records.length,
        wouldTriggerNow: would.slice(0, 20),
        note:
          records.length === 0
            ? 'Nenhum registro encontrado hoje com esses filtros na sua unidade. A regra ficará aguardando.'
            : 'Alterações de campo/status são comparadas a partir da ativação (a primeira leitura vira linha de base). Gatilhos de prazo e inatividade são avaliados imediatamente.'
      };
      if (records.length === 0) out.warnings.push('Nenhum registro corresponde aos filtros neste momento.');
    } catch (err) {
      if (err instanceof SourceUnavailableError) {
        out.valid = false;
        out.errors.push(err.message);
      } else throw err;
    }
    return out;
  }

  async create(ctx: AuthContext, input: unknown, opts: { dashboardId?: string } = {}): Promise<{ monitor: MonitorRow; preview: Preview }> {
    const p = await this.preview(ctx, input);
    if (!p.valid) throw invalid('Regra inválida: ' + p.errors.join(' '), p);
    const def = RuleDefinition.parse(input);
    def.enabled = false; // ativação só por confirmação explícita
    const r = await this.d.db.tx(async (q) => {
      const ins = await q.query<MonitorRow>(
        `INSERT INTO ada.monitor_rule (owner_user_id, unit_id, name, source_id, status, definition, check_every_minutes, dashboard_id)
         VALUES ($1,$2,$3,$4,'draft',$5,$6,$7) RETURNING *`,
        [ctx.systemUserId, ctx.activeUnitId, def.name, def.source, def, p.checkEveryMinutes, opts.dashboardId ?? null]
      );
      const m = ins.rows[0]!;
      await q.query(`INSERT INTO ada.monitor_revision (monitor_id, revision, definition, change_summary, created_by) VALUES ($1, 1, $2, 'Criação', $3)`, [m.id, def, ctx.systemUserId]);
      await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'monitor.criado', targetType: 'monitor', targetId: m.id, outcome: 'ok', details: { source: def.source } });
      return m;
    });
    return { monitor: r, preview: p };
  }

  async get(ctx: AuthContext, id: string): Promise<MonitorRow> {
    if (!z.uuid().safeParse(id).success) throw notFound('Acompanhamento');
    const r = await this.d.db.query<MonitorRow>(
      `SELECT * FROM ada.monitor_rule WHERE id = $1 AND owner_user_id = $2 AND unit_id = $3 AND deleted_at IS NULL`,
      [id, ctx.systemUserId, ctx.activeUnitId]
    );
    if (!r.rows[0]) throw notFound('Acompanhamento');
    return r.rows[0];
  }

  async list(ctx: AuthContext) {
    const r = await this.d.db.query(
      `SELECT id, name, source_id, status, health, last_error, check_every_minutes, last_run_at, last_success_at, next_run_at, activated_at, definition, current_revision, created_at
       FROM ada.monitor_rule WHERE owner_user_id = $1 AND unit_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [ctx.systemUserId, ctx.activeUnitId]
    );
    return r.rows;
  }

  async activate(ctx: AuthContext, id: string): Promise<MonitorRow> {
    const m = await this.get(ctx, id);
    if (m.status === 'active') return m;
    const p = await this.preview(ctx, m.definition);
    if (!p.valid) throw invalid('A regra não pode ser ativada: ' + p.errors.join(' '), p);
    const count = await this.d.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ada.monitor_rule WHERE owner_user_id = $1 AND status IN ('active','degraded') AND deleted_at IS NULL`, [ctx.systemUserId]);
    if ((count.rows[0]?.n ?? 0) >= MAX_ACTIVE_PER_USER) throw new HttpError(429, 'RATE_LIMITED', `Limite de ${MAX_ACTIVE_PER_USER} acompanhamentos ativos atingido.`);
    const now = this.d.now();
    const r = await this.d.db.query<MonitorRow>(
      `UPDATE ada.monitor_rule SET status = 'active', activated_at = COALESCE(activated_at, $2), next_run_at = $2, health = 'ok', last_error = NULL,
         consecutive_failures = 0, definition = jsonb_set(definition, '{enabled}', 'true'), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, now]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'monitor.ativado', targetType: 'monitor', targetId: id, outcome: 'ok' });
    return r.rows[0]!;
  }

  async pause(ctx: AuthContext, id: string): Promise<MonitorRow> {
    await this.get(ctx, id);
    const r = await this.d.db.query<MonitorRow>(
      `UPDATE ada.monitor_rule SET status = 'paused', definition = jsonb_set(definition, '{enabled}', 'false'), lease_until = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'monitor.pausado', targetType: 'monitor', targetId: id, outcome: 'ok' });
    return r.rows[0]!;
  }

  /** Edição gera nova revisão; histórico de execuções e eventos é preservado. */
  async update(ctx: AuthContext, id: string, input: unknown): Promise<MonitorRow> {
    const m = await this.get(ctx, id);
    const p = await this.preview(ctx, input);
    if (!p.valid) throw invalid('Regra inválida: ' + p.errors.join(' '), p);
    const def = RuleDefinition.parse(input);
    if (def.source !== m.source_id) throw invalid('Não é possível trocar a fonte de um acompanhamento; crie outro.');
    def.enabled = m.status === 'active';
    return this.d.db.tx(async (q) => {
      const rev = m.current_revision + 1;
      const r = await q.query<MonitorRow>(
        `UPDATE ada.monitor_rule SET definition = $2, name = $3, check_every_minutes = $4, current_revision = $5, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, def, def.name, p.checkEveryMinutes, rev]
      );
      await q.query(`INSERT INTO ada.monitor_revision (monitor_id, revision, definition, change_summary, created_by) VALUES ($1,$2,$3,'Edição',$4)`, [id, rev, def, ctx.systemUserId]);
      await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'monitor.editado', targetType: 'monitor', targetId: id, outcome: 'ok', details: { revision: rev } });
      return r.rows[0]!;
    });
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    await this.get(ctx, id);
    await this.d.db.query(`UPDATE ada.monitor_rule SET status = 'deleted', deleted_at = now(), lease_until = NULL WHERE id = $1`, [id]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'monitor.excluido', targetType: 'monitor', targetId: id, outcome: 'ok' });
  }

  async history(ctx: AuthContext, id: string) {
    await this.get(ctx, id);
    const runs = await this.d.db.query(
      `SELECT id, trigger_kind, started_at, finished_at, status, records_checked, events_created, ai_calls, error FROM ada.monitor_run WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [id]
    );
    const events = await this.d.db.query(
      `SELECT id, record_key, trigger_type, status, severity, title, body, evidence, occurred_at FROM ada.monitor_event WHERE monitor_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
      [id]
    );
    const revisions = await this.d.db.query(
      `SELECT revision, change_summary, created_at FROM ada.monitor_revision WHERE monitor_id = $1 ORDER BY revision DESC`,
      [id]
    );
    return { runs: runs.rows, events: events.rows, revisions: revisions.rows };
  }
}

/* ======================================================================== */
/* RuleScheduler/Observer + RuleEvaluator + NotificationDispatcher           */
/* Determinístico: nenhuma chamada de IA no ciclo normal.                    */
/* ======================================================================== */

export interface RunOutcome {
  monitorId: string;
  status: 'ok' | 'sem_mudancas' | 'fonte_indisponivel' | 'erro';
  recordsChecked: number;
  eventsCreated: number;
  notificationsCreated: number;
  aiCalls: 0;
}

function matchesFilters(def: RuleDefinition, values: RecordValues): boolean {
  return def.filters.every((f) => {
    const v = values[f.field];
    const vals = (Array.isArray(f.value) ? f.value : [f.value]).map(String);
    if (f.op === 'neq') return !vals.includes(String(v));
    return vals.includes(String(v));
  });
}

export class MonitorRunner {
  constructor(private readonly d: Deps) {}

  /** Reivindica regras vencidas (lease + SKIP LOCKED) e executa. Seguro com vários workers. */
  async runDue(workerId: string, limit = 20): Promise<RunOutcome[]> {
    const now = this.d.now();
    const claimed = await this.d.db.query<{ id: string }>(
      `UPDATE ada.monitor_rule SET lease_owner = $1, lease_until = $2::timestamptz + interval '5 minutes'
       WHERE id IN (
         SELECT id FROM ada.monitor_rule
         WHERE status IN ('active','degraded') AND deleted_at IS NULL AND next_run_at <= $2
           AND (lease_until IS NULL OR lease_until < $2)
         ORDER BY next_run_at LIMIT $3 FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [workerId, now, limit]
    );
    const out: RunOutcome[] = [];
    for (const { id } of claimed.rows) out.push(await this.runOne(id, 'agendado'));
    return out;
  }

  private async ownerContext(m: MonitorRow): Promise<AuthContext> {
    return this.d.sessions.resolveContext(m.owner_user_id, m.unit_id, 'worker');
  }

  private async persistOccurrences(q: Queryable, m: MonitorRow, source: SourceDef, recordKey: string, occ: Occurrence[], snapshot: RecordSnapshot) {
    let events = 0;
    let notes = 0;
    for (const o of occ) {
      const ev = await q.query<{ id: string }>(
        `INSERT INTO ada.monitor_event (monitor_id, record_key, dedupe_key, trigger_type, status, severity, title, body, evidence, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (monitor_id, dedupe_key) DO NOTHING RETURNING id`,
        [m.id, recordKey, o.dedupeKey, o.triggerType, o.suppressed ? 'suprimido' : 'notificado', o.severity, o.title, o.body, o.evidence, o.evidence.observedAt]
      );
      if (!ev.rows[0]) continue; // fato já registrado: idempotência após reinício/reprocessamento
      events++;
      if (o.suppressed) continue;
      const n = await q.query<{ id: string }>(
        `INSERT INTO ada.notification (recipient_user_id, unit_id, severity, title, body, source_id, monitor_id, monitor_event_id, dashboard_id, evidence, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING RETURNING id`,
        [m.owner_user_id, m.unit_id, o.severity, o.title, o.body, source.id, m.id, ev.rows[0].id, m.dashboard_id, { ...o.evidence, synthetic: source.synthetic }, sha256(`monitor:${m.id}:${o.dedupeKey}`)]
      );
      if (n.rows[0]) {
        notes++;
        await q.query(`INSERT INTO ada.notification_delivery (notification_id, channel, status, attempts, delivered_at) VALUES ($1,'in_app','entregue',1,now())`, [n.rows[0].id]);
      }
    }
    await q.query(
      `INSERT INTO ada.monitor_watermark (monitor_id, record_key, snapshot, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (monitor_id, record_key) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()`,
      [m.id, recordKey, snapshot]
    );
    return { events, notes };
  }

  private async evaluateAndPersist(m: MonitorRow, def: RuleDefinition, source: SourceDef, records: Record<string, unknown>[], now: Date) {
    const mon = source.monitor!;
    let events = 0;
    let notes = 0;
    let watermark = m.watermark;
    for (const rec of records) {
      const values = normalizeRecord(rec, mon.fields);
      if (!matchesFilters(def, values)) continue;
      const recordKey = String(values[mon.keyField]);
      const updated = values[mon.updatedAtField];
      if (typeof updated === 'string' && (!watermark || updated > watermark)) watermark = updated;
      await this.d.db.tx(async (q) => {
        const snap = await q.query<{ snapshot: RecordSnapshot }>(`SELECT snapshot FROM ada.monitor_watermark WHERE monitor_id = $1 AND record_key = $2 FOR UPDATE`, [m.id, recordKey]);
        const res = evaluateRecord({ definition: def, source, recordKey, current: values, previous: snap.rows[0]?.snapshot ?? null, now, activatedAt: m.activated_at ?? now });
        const r = await this.persistOccurrences(q, m, source, recordKey, res.occurrences, res.snapshot);
        events += r.events;
        notes += r.notes;
      });
    }
    return { events, notes, watermark };
  }

  private async fail(m: MonitorRow, runId: string, status: 'fonte_indisponivel' | 'erro', message: string, now: Date, permanent = false) {
    const failures = m.consecutive_failures + 1;
    const degrade = permanent || failures >= DEGRADE_AFTER_FAILURES;
    await this.d.db.query(`UPDATE ada.monitor_run SET status = $2, finished_at = now(), error = $3 WHERE id = $1`, [runId, status, message.slice(0, 500)]);
    await this.d.db.query(
      `UPDATE ada.monitor_rule SET last_run_at = $2, consecutive_failures = $3, health = $4, last_error = $5,
         status = CASE WHEN $6 AND status = 'active' THEN 'degraded' ELSE status END, next_run_at = $7, lease_until = NULL WHERE id = $1`,
      [m.id, now, failures, permanent ? 'erro' : 'degradado', message.slice(0, 500), degrade, nextRunAt(now, m.check_every_minutes, failures)]
    );
    if (degrade) {
      const day = now.toISOString().slice(0, 10);
      await this.d.db.query(
        `INSERT INTO ada.notification (recipient_user_id, unit_id, severity, title, body, source_id, monitor_id, evidence, dedupe_key)
         VALUES ($1,$2,'aviso',$3,$4,$5,$6,$7,$8) ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,
        [
          m.owner_user_id, m.unit_id, `Acompanhamento "${m.name}" degradado`,
          `As verificações não puderam ser concluídas: ${message} Nenhuma verificação foi considerada bem-sucedida enquanto a falha persistir.`,
          m.source_id, m.id, { failures, status }, sha256(`degraded:${m.id}:${day}`)
        ]
      );
    }
  }

  /** Executa uma regra. Em caso de erro, registra a falha real (nunca falso sucesso). */
  async runOne(id: string, kind: 'agendado' | 'evento' | 'teste', injected?: Record<string, unknown>[]): Promise<RunOutcome> {
    const now = this.d.now();
    const res = await this.d.db.query<MonitorRow>(`SELECT * FROM ada.monitor_rule WHERE id = $1`, [id]);
    const m = res.rows[0];
    const base: RunOutcome = { monitorId: id, status: 'erro', recordsChecked: 0, eventsCreated: 0, notificationsCreated: 0, aiCalls: 0 };
    if (!m || m.deleted_at || !['active', 'degraded'].includes(m.status)) return base;
    const run = await this.d.db.query<{ id: string }>(`INSERT INTO ada.monitor_run (monitor_id, trigger_kind, status) VALUES ($1,$2,'executando') RETURNING id`, [id, kind]);
    const runId = run.rows[0]!.id;
    const def = RuleDefinition.safeParse(m.definition);
    const source = def.success ? this.d.catalog.catalog.sources[def.data.source] : undefined;
    if (!def.success || !source?.monitor) {
      await this.fail(m, runId, 'erro', 'Definição ou fonte não suportada neste ambiente.', now, true);
      return base;
    }
    let ctx: AuthContext;
    try {
      ctx = await this.ownerContext(m);
    } catch (err) {
      if (err instanceof InactiveUserError || err instanceof UnitNotAllowedError) {
        await this.fail(m, runId, 'erro', 'O dono do acompanhamento perdeu acesso à unidade no POSSEBON.', now, true);
      } else if (err instanceof IdentityUnavailableError) {
        await this.fail(m, runId, 'fonte_indisponivel', 'Não foi possível revalidar permissões no POSSEBON.', now);
      } else throw err;
      return { ...base, status: 'erro' };
    }
    const access = canUseSource(ctx, source);
    if (!access.allowed) {
      await this.fail(m, runId, 'erro', access.reason ?? 'Permissão revogada.', now, true);
      return base;
    }
    try {
      let records = injected;
      if (!records) {
        const adapter = await this.d.catalog.adapterFor(source.id);
        const mon = source.monitor;
        const keyScoped = def.data.filters.some((f) => f.field === mon.keyField && f.op !== 'neq');
        const near = def.data.triggers.flatMap((t) => (t.type === 'deadline_near' ? [t.within_hours] : t.type === 'deadline_passed' ? [0] : []));
        const stale = def.data.triggers.flatMap((t) => (t.type === 'no_update_for' ? [t.duration_hours] : []));
        const deadlineField = def.data.triggers.find((t) => t.type === 'deadline_near' || t.type === 'deadline_passed') as { field: string } | undefined;
        const staleField = def.data.triggers.find((t) => t.type === 'no_update_for') as { field: string } | undefined;
        records = await adapter.fetchMonitorRecords({
          source,
          unitId: m.unit_id,
          filters: def.data.filters,
          // Regra de registro único: lê só o registro. Caso contrário: somente o que mudou desde o watermark
          // e candidatos temporais limitados — nunca varre a tabela inteira.
          changedSince: keyScoped ? null : m.watermark ?? new Date(0).toISOString(),
          timeCandidates: keyScoped
            ? undefined
            : {
                deadlineField: deadlineField?.field,
                deadlineBefore: near.length ? new Date(now.getTime() + Math.max(...near) * 3_600_000) : undefined,
                staleField: staleField?.field,
                staleBefore: stale.length ? new Date(now.getTime() - Math.min(...stale) * 3_600_000) : undefined
              },
          limit: 500
        });
        if (keyScoped && records.length === 0) {
          await this.d.db.query(`UPDATE ada.monitor_rule SET health = 'degradado', last_error = $2 WHERE id = $1`, [id, 'Registro acompanhado não encontrado na fonte para esta unidade.']);
        }
      }
      const r = await this.evaluateAndPersist(m, def.data, source, records, now);
      const status = r.events > 0 ? 'ok' : 'sem_mudancas';
      await this.d.db.query(
        `UPDATE ada.monitor_run SET status = $2, finished_at = now(), records_checked = $3, events_created = $4, ai_calls = 0 WHERE id = $1`,
        [runId, status, records.length, r.events]
      );
      await this.d.db.query(
        `UPDATE ada.monitor_rule SET last_run_at = $2, last_success_at = $2, consecutive_failures = 0, watermark = $3,
           health = CASE WHEN health = 'erro' OR (health = 'degradado' AND $5) THEN 'ok' ELSE health END,
           last_error = CASE WHEN $5 THEN NULL ELSE last_error END,
           status = CASE WHEN status = 'degraded' THEN 'active' ELSE status END,
           next_run_at = $4, lease_until = NULL WHERE id = $1`,
        [id, now, r.watermark, nextRunAt(now, m.check_every_minutes, 0), records.length > 0]
      );
      return { monitorId: id, status, recordsChecked: records.length, eventsCreated: r.events, notificationsCreated: r.notes, aiCalls: 0 };
    } catch (err) {
      if (err instanceof SourceUnavailableError) {
        await this.fail(m, runId, 'fonte_indisponivel', err.message, now);
        return { ...base, status: 'fonte_indisponivel' };
      }
      this.d.log.error({ err, monitor: id }, 'falha no monitor');
      await this.fail(m, runId, 'erro', 'Falha interna na verificação.', now);
      return base;
    }
  }

  /** Processa eventos recebidos (webhook/outbox), idempotentes por (fonte, event_id). */
  async processInbound(limit = 100): Promise<number> {
    const pending = await this.d.db.query<{ id: string; source_id: string; unit_id: number; payload: Record<string, unknown> }>(
      `UPDATE ada.inbound_event SET processed_at = now() WHERE id IN (
         SELECT id FROM ada.inbound_event WHERE processed_at IS NULL ORDER BY received_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, source_id, unit_id, payload`,
      [limit]
    );
    for (const ev of pending.rows) {
      const rules = await this.d.db.query<{ id: string }>(
        `SELECT id FROM ada.monitor_rule WHERE source_id = $1 AND unit_id = $2 AND status IN ('active','degraded') AND deleted_at IS NULL`,
        [ev.source_id, ev.unit_id]
      );
      for (const r of rules.rows) await this.runOne(r.id, 'evento', [ev.payload]);
    }
    return pending.rows.length;
  }
}
