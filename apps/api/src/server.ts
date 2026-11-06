import os from 'node:os';
import { loadConfig } from './config.ts';
import { createDeps } from './core.ts';
import { buildApp } from './app.ts';
import { prepare } from './boot.ts';
import { startWorkerLoop } from './cycle.ts';

const config = loadConfig();
const d = await createDeps(config);
await prepare(d, config);
const app = await buildApp(d);
await app.listen({ host: config.host, port: config.port });

// PGlite (desenvolvimento) só admite um processo: o ciclo do worker roda embutido. Em produção, apps/worker separado.
const embedded = config.db.driver === 'pglite' && process.env.ADA_EMBEDDED_WORKER !== '0' ? startWorkerLoop(d, `${os.hostname()}:${process.pid}:embutido`, Number(process.env.ADA_WORKER_INTERVAL_MS ?? 15000)) : null;

d.log.info(
  {
    url: `http://${config.host}:${config.port}${config.basePath}/`,
    env: config.env,
    ai: d.ai.configured ? d.ai.model : 'deterministico',
    identity: d.identity.kind,
    demoData: config.demoData,
    embeddedWorker: Boolean(embedded)
  },
  'ADA API iniciada'
);

const shutdown = async (sig: string) => {
  d.log.info({ sig }, 'encerrando');
  await app.close();
  await embedded?.stop();
  await d.db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
