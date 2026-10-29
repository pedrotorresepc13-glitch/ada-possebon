import type { AdaConfig } from './config.ts';
import type { Deps } from './core.ts';
import { listMigrations, migrateUp } from './migrate.ts';
import { seedDemo } from './seed-demo.ts';

/**
 * Preparação comum da API e do worker.
 * Produção: NÃO aplica migrations automaticamente; recusa iniciar com migrations pendentes.
 */
export async function prepare(d: Deps, config: AdaConfig): Promise<void> {
  if (config.isProduction) {
    const applied = await d.db
      .query<{ version: string }>(`SELECT version FROM ada_migrations.applied`)
      .then((r) => new Set(r.rows.map((x) => x.version)))
      .catch(() => new Set<string>());
    const pending = listMigrations().filter((m) => !applied.has(m.version));
    if (pending.length) throw new Error(`Migrations pendentes: ${pending.map((m) => m.version).join(', ')}. Execute scripts/deploy/update.sh.`);
    const demo = await d.db.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ada_demo'`);
    if (demo.rowCount) d.log.warn({}, 'schema sintético ada_demo presente no banco de produção — remova-o (DROP SCHEMA ada_demo CASCADE)');
  } else {
    const done = await migrateUp(d.db);
    if (done.length) d.log.info({ migrations: done }, 'migrations aplicadas (desenvolvimento)');
    if (config.demoData) {
      const has = await d.db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'ada_demo' AND table_name = 'os'`);
      if (!has.rowCount) {
        await seedDemo(d.db);
        d.log.info({}, 'dados SINTÉTICOS de demonstração criados (ada_demo)');
      }
    }
  }
  await d.catalog.syncToDb();
  await d.aiSettings.reload();
}
