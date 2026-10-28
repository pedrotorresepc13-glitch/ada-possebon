import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT } from './config.ts';
import type { Db } from './db.ts';

const DIR = path.join(REPO_ROOT, 'db/migrations');

interface Migration {
  version: string;
  up: string;
  down: string;
  checksum: string;
}

export function listMigrations(): Migration[] {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.up.sql')).sort();
  return files.map((f) => {
    const version = f.replace('.up.sql', '');
    const up = readFileSync(path.join(DIR, f), 'utf8');
    const down = readFileSync(path.join(DIR, `${version}.down.sql`), 'utf8');
    return { version, up, down, checksum: createHash('sha256').update(up).digest('hex') };
  });
}

/** Controle de versão fora do schema ada para sobreviver a um rollback completo. */
async function ensureTable(db: Db) {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ada_migrations;
    CREATE TABLE IF NOT EXISTS ada_migrations.applied (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`);
}

export async function migrateUp(db: Db): Promise<string[]> {
  await ensureTable(db);
  const applied = new Map((await db.query<{ version: string; checksum: string }>(`SELECT version, checksum FROM ada_migrations.applied`)).rows.map((r) => [r.version, r.checksum]));
  const done: string[] = [];
  for (const m of listMigrations()) {
    const prev = applied.get(m.version);
    if (prev) {
      if (prev !== m.checksum) throw new Error(`Migration ${m.version} foi alterada após aplicada (checksum divergente). Crie uma nova migration.`);
      continue;
    }
    await db.tx(async (q) => {
      // Executa instrução a instrução dentro da transação (compatível com pg e PGlite).
      for (const stmt of splitSql(m.up)) await q.query(stmt);
      await q.query(`INSERT INTO ada_migrations.applied (version, checksum) VALUES ($1, $2)`, [m.version, m.checksum]);
    });
    done.push(m.version);
  }
  return done;
}

export async function migrateDown(db: Db, steps = 1): Promise<string[]> {
  await ensureTable(db);
  const applied = (await db.query<{ version: string }>(`SELECT version FROM ada_migrations.applied ORDER BY version DESC LIMIT $1`, [steps])).rows;
  const all = new Map(listMigrations().map((m) => [m.version, m]));
  const done: string[] = [];
  for (const { version } of applied) {
    const m = all.get(version);
    if (!m) throw new Error(`Arquivo de rollback ausente para ${version}`);
    await db.tx(async (q) => {
      for (const stmt of splitSql(m.down)) await q.query(stmt);
      await q.query(`DELETE FROM ada_migrations.applied WHERE version = $1`, [version]);
    });
    done.push(version);
  }
  return done;
}

/** Divide SQL em instruções, respeitando strings, comentários e blocos $$. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inStr = false;
  let dollar: string | null = null;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (!inStr && !dollar && ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (!inStr && ch === '$') {
      const m = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (m) {
        if (dollar === m[0]) dollar = null;
        else if (!dollar) dollar = m[0];
        cur += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (!dollar && ch === "'") inStr = !inStr;
    if (!inStr && !dollar && ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
