import type { AdaConfig } from './config.ts';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /** Executa várias instruções (sem parâmetros). Somente para migrations/seed. */
  exec(sql: string): Promise<void>;
  /** Transação. Dentro do callback use SEMPRE o Queryable recebido. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function createPg(url: string): Promise<Db> {
  const pg = await import('pg');
  const Pool = pg.default.Pool;
  // int8 (count) como número; numeric continua string e é convertido explicitamente.
  pg.default.types.setTypeParser(20, (v: string) => Number(v));
  const pool = new Pool({ connectionString: url, max: 10, application_name: 'ada-possebon' });
  return {
    kind: 'pg',
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q: Queryable = {
          async query<R>(sql: string, params: unknown[] = []) {
            const r = await client.query(sql, params);
            return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
          }
        };
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}

/** PGlite: PostgreSQL real em WASM, para desenvolvimento local e testes (sem servidor). */
export async function createPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  // PGlite informa affectedRows = 0 em SELECT; rowCount segue a semântica do node-postgres.
  const norm = (r: { rows: unknown[]; affectedRows?: number }) => ({ rows: r.rows, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) });
  return {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await db.query(sql, params);
      return norm(r) as { rows: T[]; rowCount: number };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return db.transaction(async (t) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const r = await t.query(sql, params);
            return norm(r) as { rows: R[]; rowCount: number };
          }
        })
      );
    },
    async close() {
      await db.close();
    }
  };
}

export async function createDb(config: AdaConfig): Promise<Db> {
  if (config.db.driver === 'pg') {
    if (!config.db.url) throw new Error('DATABASE_URL não configurada');
    return createPg(config.db.url);
  }
  const fs = await import('node:fs');
  fs.mkdirSync(config.db.pgliteDir, { recursive: true });
  return createPglite(config.db.pgliteDir);
}
