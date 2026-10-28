import { loadConfig } from '../config.ts';
import { createDb } from '../db.ts';
import { migrateUp } from '../migrate.ts';
import { seedDemo } from '../seed-demo.ts';

const config = loadConfig();
if (config.isProduction) {
  console.error('Seed sintético é proibido em produção.');
  process.exit(1);
}
const db = await createDb(config);
try {
  await migrateUp(db);
  await seedDemo(db);
  console.log('Dados SINTÉTICOS recriados no schema ada_demo (somente desenvolvimento/demonstração).');
} finally {
  await db.close();
}
