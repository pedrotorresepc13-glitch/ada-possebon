import http from 'node:http';
import os from 'node:os';
import { createDeps, loadConfig, prepare } from '@ada/api';
import { startWorkerLoop } from './cycle.ts';

const config = loadConfig();
if (config.db.driver === 'pglite') {
  // PGlite aceita um único processo por diretório: em desenvolvimento o ciclo roda embutido na API.
  console.error('Com ADA_DB_DRIVER=pglite o worker roda embutido na API (npm run dev:api). Use PostgreSQL para worker separado.');
  process.exit(1);
}
const d = await createDeps(config);
await prepare(d, config);

const workerId = `${os.hostname()}:${process.pid}`;
const intervalMs = Number(process.env.ADA_WORKER_INTERVAL_MS ?? 15000);
const worker = startWorkerLoop(d, workerId, intervalMs);

// Health check local (somente 127.0.0.1) para systemd/monitoramento.
const healthPort = Number(process.env.ADA_WORKER_HEALTH_PORT ?? 4801);
const server = http.createServer((req, res) => {
  const last = worker.state.lastCycle;
  const fresh = Date.now() - new Date(last.at).getTime() < intervalMs * 4;
  res.writeHead(req.url === '/healthz' && fresh && last.ok ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'ada-worker', workerId, lastCycle: last }));
});
server.listen(healthPort, '127.0.0.1');
d.log.info({ workerId, intervalMs, healthPort }, 'ADA worker iniciado (sem IA no ciclo de monitoramento)');

const stop = async () => {
  server.close();
  await worker.stop();
  await d.db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
