import { createHash } from 'node:crypto';
import type { IntegrationStatus, RuleFilter } from '@ada/contracts';
import {
  buildMetricQuery,
  DEMO_CATALOG,
  REAL_CATALOG,
  type Catalog,
  type MetricDef,
  type SourceDef
} from '@ada/domain';
import type { Deps } from '../core.ts';
import type { Queryable } from '../db.ts';
import { ReadonlyPostgresConnector } from './readonly-postgres.ts';

export class SourceUnavailableError extends Error {
  constructor(readonly sourceId: string, message: string) {
    super(message);
  }
}

export interface MetricRow {
  dims: string[];
  v: number;
}

export interface MonitorFetchArgs {
  source: SourceDef;
  unitId: number;
  filters: RuleFilter[];
  changedSince?: string | null;
  /** Inclui registros abertos com prazo até este instante ou sem atualização desde este instante. */
  timeCandidates?: { deadlineField?: string; deadlineBefore?: Date; staleField?: string; staleBefore?: Date };
  limit: number;
}

export interface SourceAdapter {
  queryMetric(args: Parameters<typeof buildMetricQuery>[0]): Promise<MetricRow[]>;
  fetchMonitorRecords(args: MonitorFetchArgs): Promise<Record<string, unknown>[]>;
}

/** Adaptador do schema SINTÉTICO ada_demo. Usa somente SQL construído a partir do catálogo. */
export class SyntheticAdapter implements SourceAdapter {
  constructor(private readonly q: Queryable) {}

  async queryMetric(args: Parameters<typeof buildMetricQuery>[0]): Promise<MetricRow[]> {
    const built = buildMetricQuery(args);
    const r = await this.q.query<Record<string, unknown>>(built.sql, built.params);
    return r.rows.map((row) => ({ dims: built.dimensionKeys.map((_, i) => String(row[`d${i}`])), v: Number(row.v) }));
  }

  async fetchMonitorRecords(a: MonitorFetchArgs): Promise<Record<string, unknown>[]> {
    const mon = a.source.monitor;
    if (!mon) throw new Error('Fonte sem suporte a monitoramento');
    const allowed = new Set(mon.fields.map((f) => f.name));
    const cols = mon.fields.map((f) => `f.${f.name}`).join(', ');
    const params: unknown[] = [a.unitId];
    const where = ['f.unit_id = $1'];
    for (const f of a.filters) {
      if (!allowed.has(f.field)) throw new Error(`Campo não permitido: ${f.field}`);
      if (Array.isArray(f.value) || f.op === 'in') {
        params.push((Array.isArray(f.value) ? f.value : [f.value]).map(String));
        where.push(`f.${f.field}::text = ANY($${params.length}::text[])`);
      } else {
        params.push(String(f.value));
        where.push(`f.${f.field}::text ${f.op === 'neq' ? '<>' : '='} $${params.length}`);
      }
    }
    const alt: string[] = [];
    if (a.changedSince) {
      params.push(a.changedSince);
      alt.push(`f.${mon.updatedAtField} > $${params.length}::timestamptz`);
    }
    const tc = a.timeCandidates;
    if (tc?.deadlineField && tc.deadlineBefore && allowed.has(tc.deadlineField)) {
      params.push(tc.deadlineBefore);
      alt.push(`f.${tc.deadlineField} <= $${params.length}::timestamptz`);
    }
    if (tc?.staleField && tc.staleBefore && allowed.has(tc.staleField)) {
      params.push(tc.staleBefore);
      alt.push(`f.${tc.staleField} <= $${params.length}::timestamptz`);
    }
    if (alt.length) where.push(`(${alt.join(' OR ')})`);
    params.push(Math.min(a.limit, 1000));
    const sql = `SELECT ${cols} FROM ${mon.table} f WHERE ${where.join(' AND ')} ORDER BY f.${mon.updatedAtField} ASC LIMIT $${params.length}`;
    return (await this.q.query<Record<string, unknown>>(sql, params)).rows;
  }
}

/** Conectores conhecidos. Somente "ativo"/"demonstracao" podem fornecer dados. */
const KNOWN_CONNECTORS: { id: string; kind: string; label: string; operations: string[] }[] = [
  { id: 'possebon.identity', kind: 'possebon_rest', label: 'POSSEBON Web — identidade e permissões (SSO)', operations: ['identity.resolve'] },
  { id: 'possebon.rest', kind: 'possebon_rest', label: 'POSSEBON Web — API REST de dados', operations: [] },
  { id: 'possebon.brain', kind: 'possebon_brain', label: 'POSSEBON Brain — contexto técnico/normativo', operations: ['brain.status', 'brain.context'] },
  { id: 'possebon.pg_readonly', kind: 'postgres_readonly', label: 'PostgreSQL POSSEBON — leitura restrita (consultas predefinidas)', operations: [] }
];

const DATA_STATUSES: IntegrationStatus[] = ['ativo', 'demonstracao'];

export class CatalogService {
  readonly catalog: Catalog;
  private readonly synthetic: SyntheticAdapter;
  private readonly readonlyPg?: ReadonlyPostgresConnector;

  constructor(private readonly d: Deps) {
    this.catalog = d.config.demoData ? DEMO_CATALOG : REAL_CATALOG;
    if (d.config.possebon.readonlyUrl) this.readonlyPg = new ReadonlyPostgresConnector(d.config.possebon.readonlyUrl);
    this.synthetic = new SyntheticAdapter(d.db);
  }

  /** Registra catálogo e conectores no banco (idempotente). Não sobrescreve status definido pelo admin. */
  async syncToDb(): Promise<void> {
    const q = this.d.db;
    for (const dim of Object.values(this.catalog.dimensions)) {
      await q.query(
        `INSERT INTO ada.semantic_dimension (id, label, kind) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, updated_at = now()`,
        [dim.id, dim.label, dim.kind]
      );
    }
    for (const m of Object.values(this.catalog.metrics)) {
      const hash = createHash('sha256').update(JSON.stringify(m)).digest('hex');
      await q.query(
        `INSERT INTO ada.semantic_metric (id, label, description, formula, source_id, unit, status, sensitivity, required_programs, dimensions, definition_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, formula = EXCLUDED.formula,
           source_id = EXCLUDED.source_id, unit = EXCLUDED.unit, status = EXCLUDED.status, sensitivity = EXCLUDED.sensitivity,
           required_programs = EXCLUDED.required_programs, dimensions = EXCLUDED.dimensions, definition_hash = EXCLUDED.definition_hash, updated_at = now()`,
        [m.id, m.label, m.description, m.formula, m.source, m.unit, m.status, m.sensitivity, m.requiredPrograms, Object.keys(m.dimensions), hash]
      );
    }
    for (const s of Object.values(this.catalog.sources)) {
      await q.query(
        `INSERT INTO ada.semantic_entity (id, label, source_id, description, status) VALUES ($1,$2,$1,$3,$4)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, status = EXCLUDED.status, updated_at = now()`,
        [s.id, s.label, s.synthetic ? 'Fonte sintética de demonstração' : '', s.defaultStatus]
      );
      await q.query(
        `INSERT INTO ada.source_connector (id, kind, label, status, allowed_operations) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.kind, s.label, s.defaultStatus, ['metric.query', ...(s.monitor ? ['monitor.fetch'] : [])]]
      );
    }
    for (const c of KNOWN_CONNECTORS) {
      // Configurado não é sinônimo de validado. Preservar "ativo" apenas se
      // um teste anterior confirmou a conexão; invalidar se a configuração sumiu.
      const status = c.id === 'possebon.identity'
        ? this.d.identity.status()
        : c.id === 'possebon.brain'
          ? (this.d.brain.configured ? 'configurado_nao_validado' : 'nao_configurado')
          : c.id === 'possebon.pg_readonly'
            ? (this.readonlyPg ? 'configurado_nao_validado' : 'nao_configurado')
            : 'nao_configurado';
      await q.query(
        `INSERT INTO ada.source_connector (id, kind, label, status, allowed_operations) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET status = CASE
           WHEN ada.source_connector.id IN ('possebon.identity', 'possebon.brain', 'possebon.pg_readonly') THEN
             CASE
               WHEN EXCLUDED.status = 'nao_configurado' THEN 'nao_configurado'
               WHEN ada.source_connector.status = 'ativo' THEN 'ativo'
               ELSE EXCLUDED.status
             END
           ELSE ada.source_connector.status
         END`,
        [c.id, c.kind, c.label, status, c.operations]
      );
    }
    if (!this.d.config.demoData) {
      // Fora do modo demonstração, fontes sintéticas eventualmente registradas ficam desabilitadas.
      await q.query(`UPDATE ada.source_connector SET status = 'desabilitado' WHERE status = 'demonstracao'`);
    }
  }

  async sourceStatus(sourceId: string): Promise<{ status: IntegrationStatus; lastError: string | null }> {
    const r = await this.d.db.query<{ status: IntegrationStatus; last_error: string | null }>(
      `SELECT status, last_error FROM ada.source_connector WHERE id = $1`,
      [sourceId]
    );
    return r.rows[0] ? { status: r.rows[0].status, lastError: r.rows[0].last_error } : { status: 'nao_configurado', lastError: null };
  }

  async enabledSourceIds(): Promise<Set<string>> {
    const r = await this.d.db.query<{ id: string }>(`SELECT id FROM ada.source_connector WHERE status = ANY($1::text[])`, [DATA_STATUSES]);
    return new Set(r.rows.map((x) => x.id).filter((id) => this.catalog.sources[id]));
  }

  /** Adaptador para a fonte, se disponível. Lança SourceUnavailableError com explicação honesta. */
  async adapterFor(sourceId: string): Promise<SourceAdapter> {
    const src = this.catalog.sources[sourceId];
    if (!src) throw new SourceUnavailableError(sourceId, 'Fonte não catalogada neste ambiente.');
    const st = await this.sourceStatus(sourceId);
    if (!DATA_STATUSES.includes(st.status)) {
      throw new SourceUnavailableError(sourceId, `Fonte "${src.label}" indisponível (status: ${st.status}${st.lastError ? ` — ${st.lastError}` : ''}).`);
    }
    if (src.kind === 'synthetic') return this.synthetic;
    if (src.kind === 'postgres_readonly' && sourceId === 'possebon.pg_readonly' && this.readonlyPg) return this.readonlyPg;
    throw new SourceUnavailableError(sourceId, `Adaptador para "${src.label}" ainda não implementado.`);
  }

  async checkReadonly(unitId: number): Promise<void> {
    if (!this.readonlyPg) throw new SourceUnavailableError('possebon.pg_readonly', 'Configure POSSEBON_READONLY_DATABASE_URL com credencial SELECT exclusiva.');
    await this.readonlyPg.check(unitId);
  }

  private lastOperationalCheck=0;
  /** Teste automático, somente leitura, na primeira consulta operacional. */
  async operationalSource(unitId:number):Promise<ReadonlyPostgresConnector> {
    if (!this.readonlyPg) throw new SourceUnavailableError('possebon.pg_readonly', 'Conexão PostgreSQL de leitura não configurada no ambiente da IA.');
    if (Date.now()-this.lastOperationalCheck>120_000) {
      await this.readonlyPg.check(unitId);
      this.lastOperationalCheck=Date.now();
      await this.d.db.query(`UPDATE ada.source_connector SET status='ativo',last_error=NULL WHERE id='possebon.pg_readonly'`);
    }
    return this.readonlyPg;
  }

  metric(id: string): MetricDef | undefined {
    return this.catalog.metrics[id];
  }
}
