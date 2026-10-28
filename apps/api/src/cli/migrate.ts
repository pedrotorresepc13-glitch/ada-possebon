import path from 'node:path';
import { REPO_ROOT } from '../config.ts';
import { createDb } from '../db.ts';
import { migrateDown, migrateUp } from '../migrate.ts';
import type { AdaConfig } from '../config.ts';

// Migrations precisam apenas da conexão do dono do schema (ada_owner), não da configuração completa da API.
const url = process.env.DATABASE_URL;
const driver = (process.env.ADA_DB_DRIVER as 'pg' | 'pglite' | undefined) ?? (url ? 'pg' : 'pglite');
const production = process.env.ADA_ENV === 'production';
if (production && driver !== 'pg') throw new Error('Produção exige DATABASE_URL (PostgreSQL).');
const db = await createDb({ db: { driver, url, pgliteDir: path.resolve(REPO_ROOT, process.env.ADA_PGLITE_DIR ?? '.data/pglite') } } as AdaConfig);
const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') {
    const done = await migrateUp(db);
    console.log(done.length ? `Migrations aplicadas: ${done.join(', ')}` : 'Nenhuma migration pendente.');
  } else if (cmd === 'down') {
    if (production && process.env.ADA_CONFIRM_ROLLBACK !== 'sim') {
      throw new Error('Rollback em produção exige backup verificado e ADA_CONFIRM_ROLLBACK=sim.');
    }
    const done = await migrateDown(db, Number(process.argv[3] ?? 1));
    console.log(done.length ? `Revertidas: ${done.join(', ')}` : 'Nada a reverter.');
  } else throw new Error('Uso: migrate.ts up|down [passos]');
} finally {
  await db.close();
}
