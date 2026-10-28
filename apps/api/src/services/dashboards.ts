import {
  DashboardFilter,
  DashboardSpec,
  type AuthContext,
  type DashboardPatchOp,
  type Provenance,
  type WidgetData,
  type WidgetSpec
} from '@ada/contracts';
import {
  applyDashboardPatch,
  canUseMetric,
  permissionCacheKey,
  queryUnitScope,
  resolveTimeRange,
  validateSpecAgainstCatalog,
  type MetricDef
} from '@ada/domain';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { sha256 } from '../crypto.ts';
import { forbidden, invalid, notFound } from '../errors.ts';
import { SourceUnavailableError, type MetricRow } from './catalog.ts';

export interface DashboardRow {
  id: string;
  owner_user_id: number;
  unit_id: number;
  title: string;
  description: string;
  spec: DashboardSpec;
  current_revision: number;
  share_policy: 'privado' | 'compartilhado';
  created_at: Date;
  updated_at: Date;
  last_refreshed_at: Date | null;
}

export type Access = 'owner' | 'shared';

export class DashboardService {
  constructor(private readonly d: Deps) {}

  /** Valida schema, catálogo e permissões do usuário sobre cada métrica. */
  validateSpec(ctx: AuthContext, input: unknown): DashboardSpec {
    const parsed = DashboardSpec.safeParse(input);
    if (!parsed.success) throw invalid('Especificação de dashboard inválida.', parsed.error.issues);
    const issues = validateSpecAgainstCatalog(parsed.data, this.d.catalog.catalog);
    if (issues.length) throw invalid('Especificação incompatível com o catálogo semântico.', issues);
    const units = queryUnitScope(ctx);
    for (const w of parsed.data.widgets) {
      for (const m of [...w.metrics, ...(w.compareMetric ? [w.compareMetric] : [])]) {
        const dec = canUseMetric(ctx, this.d.catalog.catalog, this.d.catalog.metric(m), units);
        if (!dec.allowed) throw forbidden(dec.reason);
      }
    }
    return parsed.data;
  }

  /** Carrega um dashboard visível ao usuário NA UNIDADE ATIVA. Inexistente e proibido respondem igual (404). */
  async get(ctx: AuthContext, id: string): Promise<{ row: DashboardRow; access: Access }> {
    if (!z.uuid().safeParse(id).success) throw notFound('Dashboard');
    const groupIds = ctx.groups.map((g) => g.id);
    const r = await this.d.db.query<DashboardRow & { access: Access }>(
      `SELECT d.*, CASE WHEN d.owner_user_id = $2 THEN 'owner' ELSE 'shared' END AS access
       FROM ada.dashboard d
       WHERE d.id = $1 AND d.deleted_at IS NULL AND d.unit_id = $3
         AND (d.owner_user_id = $2 OR (d.share_policy = 'compartilhado' AND EXISTS (
               SELECT 1 FROM ada.dashboard_share s WHERE s.dashboard_id = d.id AND s.unit_id = $3 AND (
                 (s.target_type = 'unit' AND s.target_id = $3) OR
                 (s.target_type = 'user' AND s.target_id = $2) OR
                 (s.target_type = 'group' AND s.target_id = ANY($4::int[]))))))`,
      [id, ctx.systemUserId, ctx.activeUnitId, groupIds]
    );
    const row = r.rows[0];
    if (!row) throw notFound('Dashboard');
    return { row, access: row.access };
  }

  async list(ctx: AuthContext) {
    const groupIds = ctx.groups.map((g) => g.id);
    const r = await this.d.db.query(
      `SELECT d.id, d.title, d.description, d.updated_at, d.share_policy, d.metrics,
              CASE WHEN d.owner_user_id = $1 THEN 'owner' ELSE 'shared' END AS access
       FROM ada.dashboard d
       WHERE d.deleted_at IS NULL AND d.unit_id = $2
         AND (d.owner_user_id = $1 OR (d.share_policy = 'compartilhado' AND EXISTS (
               SELECT 1 FROM ada.dashboard_share s WHERE s.dashboard_id = d.id AND s.unit_id = $2 AND (
                 (s.target_type = 'unit' AND s.target_id = $2) OR (s.target_type = 'user' AND s.target_id = $1) OR
                 (s.target_type = 'group' AND s.target_id = ANY($3::int[]))))))
       ORDER BY d.updated_at DESC LIMIT 200`,
      [ctx.systemUserId, ctx.activeUnitId, groupIds]
    );
    return r.rows;
  }

  async create(ctx: AuthContext, specInput: unknown, title?: string): Promise<DashboardRow> {
    const spec = this.validateSpec(ctx, title ? { ...(specInput as object), title } : specInput);
    const metrics = [...new Set(spec.widgets.flatMap((w) => [...w.metrics, ...(w.compareMetric ? [w.compareMetric] : [])]))];
    const sources = [...new Set(metrics.map((m) => this.d.catalog.metric(m)!.source))];
    return this.d.db.tx(async (q) => {
      const r = await q.query<DashboardRow>(
        `INSERT INTO ada.dashboard (owner_user_id, unit_id, title, description, spec, sources, metrics)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [ctx.systemUserId, ctx.activeUnitId, spec.title, spec.description, spec, sources, metrics]
      );
      const row = r.rows[0]!;
      await q.query(`INSERT INTO ada.dashboard_revision (dashboard_id, revision, spec, change_summary, created_by) VALUES ($1, 1, $2, 'Criação', $3)`, [
        row.id, spec, ctx.systemUserId
      ]);
      return row;
    });
  }

  /** Nova revisão (spec completa ou patch). Somente o dono altera. */
  async update(ctx: AuthContext, id: string, change: { spec?: unknown; ops?: DashboardPatchOp[]; summary?: string }): Promise<DashboardRow> {
    const { row, access } = await this.get(ctx, id);
    if (access !== 'owner') throw forbidden('Somente o dono pode alterar este dashboard.');
    let next: unknown = change.spec;
    if (change.ops) {
      try {
        next = applyDashboardPatch(row.spec, change.ops);
      } catch (err) {
        throw invalid((err as Error).message);
      }
    }
    const spec = this.validateSpec(ctx, next);
    const metrics = [...new Set(spec.widgets.flatMap((w) => [...w.metrics, ...(w.compareMetric ? [w.compareMetric] : [])]))];
    const sources = [...new Set(metrics.map((m) => this.d.catalog.metric(m)!.source))];
    return this.d.db.tx(async (q) => {
      const rev = row.current_revision + 1;
      const r = await q.query<DashboardRow>(
        `UPDATE ada.dashboard SET spec = $2, title = $3, description = $4, current_revision = $5, metrics = $6, sources = $7, updated_at = now()
         WHERE id = $1 AND current_revision = $8 RETURNING *`,
        [id, spec, spec.title, spec.description, rev, metrics, sources, row.current_revision]
      );
      if (!r.rows[0]) throw invalid('O dashboard foi alterado em paralelo; recarregue e tente novamente.');
      await q.query(`INSERT INTO ada.dashboard_revision (dashboard_id, revision, spec, change_summary, created_by) VALUES ($1,$2,$3,$4,$5)`, [
        id, rev, spec, (change.summary ?? (change.ops ? change.ops.map((o) => o.op).join(', ') : 'Edição')).slice(0, 300), ctx.systemUserId
      ]);
      if (row.share_policy === 'compartilhado') {
        await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'dashboard_compartilhado.alterado', targetType: 'dashboard', targetId: id, outcome: 'ok', details: { revision: rev } });
      }
      return r.rows[0];
    });
  }

  async revisions(ctx: AuthContext, id: string) {
    await this.get(ctx, id);
    const r = await this.d.db.query(
      `SELECT revision, change_summary, created_at, created_by FROM ada.dashboard_revision WHERE dashboard_id = $1 ORDER BY revision DESC LIMIT 100`,
      [id]
    );
    return r.rows;
  }

  async revert(ctx: AuthContext, id: string, revision: number) {
    await this.get(ctx, id);
    const r = await this.d.db.query<{ spec: DashboardSpec }>(`SELECT spec FROM ada.dashboard_revision WHERE dashboard_id = $1 AND revision = $2`, [id, revision]);
    if (!r.rows[0]) throw notFound('Revisão');
    return this.update(ctx, id, { spec: r.rows[0].spec, summary: `Reverter para revisão ${revision}` });
  }

  async remove(ctx: AuthContext, id: string) {
    const { access } = await this.get(ctx, id);
    if (access !== 'owner') throw forbidden('Somente o dono pode excluir este dashboard.');
    await this.d.db.query(`UPDATE ada.dashboard SET deleted_at = now() WHERE id = $1`, [id]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'dashboard.excluido', targetType: 'dashboard', targetId: id, outcome: 'ok' });
  }

  /**
   * Publicação para unidade/grupo/usuário. Exige escopo gerencial ou admin na unidade.
   * Quem recebe continua precisando de permissão em cada métrica para ver dados.
   */
  async share(ctx: AuthContext, id: string, target: { targetType: 'unit' | 'group' | 'user'; targetId: number }) {
    const { row, access } = await this.get(ctx, id);
    if (access !== 'owner') throw forbidden('Somente o dono pode compartilhar.');
    if (!ctx.roles.includes('manager') && !ctx.roles.includes('admin')) {
      await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'dashboard.compartilhamento', targetType: 'dashboard', targetId: id, outcome: 'negado' });
      throw forbidden('Seu perfil no POSSEBON não permite publicar dashboards.');
    }
    if (target.targetType === 'unit' && target.targetId !== row.unit_id) throw forbidden('Só é possível publicar na unidade do próprio dashboard.');
    if (target.targetType === 'group' && !ctx.groups.some((g) => g.id === target.targetId)) throw forbidden('Você só pode publicar para grupos dos quais participa.');
    await this.d.db.tx(async (q) => {
      await q.query(
        `INSERT INTO ada.dashboard_share (dashboard_id, target_type, target_id, unit_id, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [id, target.targetType, target.targetId, row.unit_id, ctx.systemUserId]
      );
      await q.query(`UPDATE ada.dashboard SET share_policy = 'compartilhado' WHERE id = $1`, [id]);
      await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'dashboard.compartilhado', targetType: 'dashboard', targetId: id, outcome: 'ok', details: target });
    });
  }

  async unshareAll(ctx: AuthContext, id: string) {
    const { access } = await this.get(ctx, id);
    if (access !== 'owner') throw forbidden('Somente o dono pode alterar o compartilhamento.');
    await this.d.db.query(`DELETE FROM ada.dashboard_share WHERE dashboard_id = $1`, [id]);
    await this.d.db.query(`UPDATE ada.dashboard SET share_policy = 'privado' WHERE id = $1`, [id]);
  }

  /* ---------------------------------------------------------------- dados */

  private async runMetric(
    ctx: AuthContext,
    metric: MetricDef,
    w: WidgetSpec,
    filters: DashboardFilter[],
    units: number[],
    refresh: boolean
  ): Promise<{ rows: MetricRow[]; queriedAt: string; fromCache: boolean; stale: boolean; staleReason?: string }> {
    const range = resolveTimeRange(w.timeRange, this.d.now());
    const grain = w.timeGrain ?? 'month';
    const applicable = filters.filter((f) => metric.dimensions[f.dimension]);
    const params = { metric: metric.id, groupBy: w.groupBy, grain, range, filters: applicable, limit: w.limit };
    const key = sha256(permissionCacheKey(ctx, units, params));
    const now = this.d.now();
    const cached = await this.d.db.query<{ payload: { rows: MetricRow[]; queriedAt: string }; expires_at: Date }>(
      `SELECT payload, expires_at FROM ada.query_cache WHERE cache_key = $1 AND owner_user_id = $2`,
      [key, ctx.systemUserId]
    );
    const hit = cached.rows[0];
    if (hit && !refresh && hit.expires_at > now) return { ...hit.payload, fromCache: true, stale: false };
    try {
      const adapter = await this.d.catalog.adapterFor(metric.source);
      const rows = await adapter.queryMetric({ metric, groupBy: w.groupBy, timeGrain: grain, range, filters: applicable, unitIds: units, limit: w.limit });
      const payload = { rows, queriedAt: now.toISOString() };
      if (this.d.config.cacheTtlSeconds > 0) {
        await this.d.db.query(
          `INSERT INTO ada.query_cache (cache_key, owner_user_id, payload, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
          [key, ctx.systemUserId, payload, now, new Date(now.getTime() + this.d.config.cacheTtlSeconds * 1000)]
        );
      }
      return { ...payload, fromCache: false, stale: false };
    } catch (err) {
      if (err instanceof SourceUnavailableError && hit) {
        return { ...hit.payload, fromCache: true, stale: true, staleReason: err.message };
      }
      throw err;
    }
  }

  /** Executa todos os widgets com permissões reaplicadas agora. Nunca retorna números persistidos no dashboard. */
  async data(ctx: AuthContext, spec: DashboardSpec, opts: { refresh?: boolean; filters?: unknown } = {}): Promise<WidgetData[]> {
    const extra = z.array(DashboardFilter).max(10).safeParse(opts.filters ?? []);
    if (!extra.success) throw invalid('Filtros inválidos.', extra.error.issues);
    for (const f of extra.data) if (!spec.filterControls.includes(f.dimension)) throw invalid(`Filtro "${f.dimension}" não é um controle deste dashboard.`);
    const units = queryUnitScope(ctx);
    const out: WidgetData[] = [];
    for (const w of spec.widgets) {
      const metricIds = [...w.metrics, ...(w.compareMetric ? [w.compareMetric] : [])];
      const base: Provenance = { sources: [], unitIds: units, filters: [], queriedAt: this.d.now().toISOString(), fromCache: false, cacheAgeSeconds: 0, synthetic: false, limitations: [] };
      const result: WidgetData = { widgetId: w.id, status: 'ok', series: [], points: [], provenance: base };
      const denied = metricIds.map((m) => canUseMetric(ctx, this.d.catalog.catalog, this.d.catalog.metric(m), units)).find((x) => !x.allowed);
      if (denied) {
        out.push({ ...result, status: 'forbidden', message: denied.reason });
        await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'metrica.acesso_negado', outcome: 'negado', details: { widget: w.id, metrics: metricIds } });
        continue;
      }
      try {
        const pointMap = new Map<string, Record<string, number | null>>();
        const filters = [...spec.defaultFilters, ...w.filters, ...extra.data];
        for (const mid of metricIds) {
          const metric = this.d.catalog.metric(mid)!;
          const r = await this.runMetric(ctx, metric, w, filters, units, Boolean(opts.refresh));
          base.sources.push(metric.source);
          base.synthetic ||= metric.status === 'sintetico';
          base.fromCache ||= r.fromCache;
          base.queriedAt = r.queriedAt < base.queriedAt ? r.queriedAt : base.queriedAt;
          base.filters = filters;
          if (r.stale) base.limitations.push(`DADOS DESATUALIZADOS: ${r.staleReason} Exibindo resultado consultado em ${r.queriedAt}.`);
          const isCmp = mid === w.compareMetric;
          const seriesKeys = new Set<string>();
          for (const row of r.rows) {
            const label = w.groupBy.length ? row.dims[0]! : 'Total';
            const key = w.groupBy.length > 1 ? `${mid}|${row.dims[1]}` : mid;
            seriesKeys.add(key);
            const p = pointMap.get(label) ?? {};
            p[key] = row.v;
            pointMap.set(label, p);
          }
          if (seriesKeys.size === 0) seriesKeys.add(mid);
          for (const k of seriesKeys) {
            const sub = k.includes('|') ? k.split('|')[1] : '';
            result.series.push({ key: k, label: sub ? `${metric.label} — ${sub}` : metric.label, unit: metric.unit, isComparison: isCmp });
          }
        }
        result.points = [...pointMap.entries()].map(([label, values]) => ({ label, values }));
        if (w.sort) {
          const k = result.series[0]?.key ?? '';
          result.points.sort((a, b) => {
            const cmp = w.sort!.by === 'label' ? a.label.localeCompare(b.label, 'pt-BR') : (a.values[k] ?? 0) - (b.values[k] ?? 0);
            return w.sort!.dir === 'asc' ? cmp : -cmp;
          });
        }
        base.sources = [...new Set(base.sources)];
        base.cacheAgeSeconds = Math.max(0, Math.round((this.d.now().getTime() - new Date(base.queriedAt).getTime()) / 1000));
        if (base.synthetic) base.limitations.push('Dados SINTÉTICOS de demonstração — não representam a POSSEBON.');
        if (result.points.length === 0) base.limitations.push('Nenhum registro encontrado para os filtros e o período.');
        out.push(result);
      } catch (err) {
        if (err instanceof SourceUnavailableError) out.push({ ...result, status: 'source_unavailable', message: err.message });
        else {
          this.d.log.error({ err }, 'falha ao consultar métrica');
          out.push({ ...result, status: 'error', message: 'Falha ao consultar a fonte. A equipe técnica pode verificar os logs.' });
        }
      }
    }
    return out;
  }

  async filterValues(ctx: AuthContext, spec: DashboardSpec, dimension: string): Promise<string[]> {
    if (!spec.filterControls.includes(dimension)) throw invalid('Dimensão não é controle de filtro deste dashboard.');
    const w = spec.widgets.find((x) => x.metrics.some((m) => this.d.catalog.metric(m)?.dimensions[dimension]));
    if (!w) return [];
    const metric = this.d.catalog.metric(w.metrics.find((m) => this.d.catalog.metric(m)?.dimensions[dimension])!)!;
    const units = queryUnitScope(ctx);
    const dec = canUseMetric(ctx, this.d.catalog.catalog, metric, units);
    if (!dec.allowed) throw forbidden(dec.reason);
    const r = await this.runMetric(ctx, metric, { ...w, groupBy: [dimension] }, [], units, false);
    return [...new Set(r.rows.map((x) => x.dims[0]!))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async markRefreshed(id: string) {
    await this.d.db.query(`UPDATE ada.dashboard SET last_refreshed_at = now() WHERE id = $1`, [id]);
  }
}
