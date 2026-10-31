import { buildMetricQuery } from '@ada/domain';
import type { Queryable } from '../db.ts';
import type { SourceAdapter, MonitorFetchArgs, MetricRow } from './catalog.ts';
import { SourceUnavailableError } from './catalog.ts';

/**
 * Só executa fórmulas SQL fixas e revisadas no catálogo; nenhuma consulta SQL
 * enviada pelo usuário ou escrita por um modelo é executada neste conector.
 */
export class ReadonlyMetricAdapter implements SourceAdapter {
  constructor(private readonly q: Queryable) {}

  async queryMetric(args: Parameters<typeof buildMetricQuery>[0]): Promise<MetricRow[]> {
    if (args.metric.source !== 'possebon.pg_readonly' ||
        args.metric.table !== 'public.colaborador' ||
        args.metric.id !== 'possebon.colaborador.cadastros') {
      throw new SourceUnavailableError('possebon.pg_readonly', 'Métrica fora da lista de consultas reais permitidas.');
    }
    const built = buildMetricQuery(args);
    const result = await this.q.query<Record<string, unknown>>(built.sql,built.params);
    return result.rows.map((row) => ({
      dims: built.dimensionKeys.map((_,i) => String(row['d'+i] ?? '(sem valor)')),
      v: Number(row.v)
    }));
  }

  async fetchMonitorRecords(_args: MonitorFetchArgs): Promise<Record<string, unknown>[]> {
    throw new SourceUnavailableError('possebon.pg_readonly',
      'Monitoramento de registros ainda não autorizado para esta fonte; somente métricas agregadas.');
  }
}

/** Credencial técnica separada, com GRANT SELECT e transações READ ONLY. */
export class ReadonlyPostgresConnector implements SourceAdapter {
  private pool?: import('pg').Pool;
  private readonly adapter: ReadonlyMetricAdapter;

  constructor(private readonly connectionString: string) {
    const u = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('Conexão de leitura deve ser PostgreSQL');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (!loopback && !['require','verify-ca','verify-full'].includes(u.searchParams.get('sslmode') ?? '')) {
      throw new Error('Conexão remota ao PostgreSQL exige TLS (sslmode=require/verify-ca/verify-full)');
    }
    this.adapter = new ReadonlyMetricAdapter({
      query: (sql,params) => this.query(sql,params)
    });
  }

  private async getPool(): Promise<import('pg').Pool> {
    if (!this.pool) {
      const pg = (await import('pg')).default;
      this.pool = new pg.Pool({
        connectionString:this.connectionString,max:2,idleTimeoutMillis:10000,
        connectionTimeoutMillis:8000,
        application_name:'ia-possebon-readonly',
        options:'-c default_transaction_read_only=on -c statement_timeout=6000'
      });
    }
    return this.pool;
  }

  private async query<T=Record<string,unknown>>(sql:string,params:unknown[]=[]):Promise<{rows:T[];rowCount:number}> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const r = await client.query(sql,params);
      await client.query('COMMIT');
      return {rows:r.rows as T[],rowCount:r.rowCount??0};
    } catch(err) {
      await client.query('ROLLBACK').catch(()=>undefined);
      throw err;
    } finally {client.release();}
  }

  /** Interface interna: somente compiladores declarativos podem enviar SQL ao executor. */
  executeRead<T=Record<string,unknown>>(sql:string,params:unknown[]=[]):Promise<{rows:T[];rowCount:number}> {
    if (!/^SELECT\s/i.test(sql.trimStart())) throw new Error('Somente SELECT é permitido');
    return this.query<T>(sql,params);
  }

  async check(unitId:number):Promise<void> {
    const fields = await this.query<{table_name:string;column_name:string}>(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema='public' AND
         ((table_name='colaborador' AND column_name = ANY($1::text[]))
         OR (table_name='equipe' AND column_name = ANY($2::text[])))`,
      [['unit_id','criado_em','deletado_em','equipe_id'],['id','unit_id','nome']]
    );
    const actual = new Set(fields.rows.map(r=>r.table_name+'.'+r.column_name));
    const expected = ['colaborador.unit_id','colaborador.criado_em','colaborador.deletado_em','colaborador.equipe_id',
      'equipe.id','equipe.unit_id','equipe.nome'];
    const missing = expected.filter(x=>!actual.has(x));
    if (missing.length) throw new Error('Estrutura PostgreSQL incompatível: '+missing.join(', '));
    // Leitura real delimitada por unidade: testa permissões SELECT, sem retornar registros.
    await this.query('SELECT 1 FROM public.colaborador WHERE unit_id=$1 AND deletado_em IS NULL LIMIT 1',[unitId]);
    await this.query('SELECT 1 FROM public.equipe WHERE unit_id=$1 LIMIT 1',[unitId]);
  }

  queryMetric(args: Parameters<typeof buildMetricQuery>[0]):Promise<MetricRow[]> {
    return this.adapter.queryMetric(args);
  }
  fetchMonitorRecords(args:MonitorFetchArgs):Promise<Record<string,unknown>[]> {
    return this.adapter.fetchMonitorRecords(args);
  }
}
