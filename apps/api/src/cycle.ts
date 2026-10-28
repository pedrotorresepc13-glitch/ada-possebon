import type { Deps } from './core.ts';

export interface CycleResult {
  inbound: number;
  monitors: { id: string; status: string; events: number }[];
  documents: number;
}

/**
 * Um ciclo do worker. Idempotente e seguro com várias instâncias (lease + SKIP LOCKED).
 * Ordem: eventos recebidos → regras vencidas → fila de documentos.
 * Nenhuma chamada de IA acontece aqui.
 */
export async function runCycle(d: Deps, workerId: string): Promise<CycleResult> {
  const inbound = await d.runner.processInbound(100);
  const runs = await d.runner.runDue(workerId, 25);
  const documents = await d.knowledge.processPending(5);
  return { inbound, monitors: runs.map((r) => ({ id: r.monitorId, status: r.status, events: r.eventsCreated })), documents };
}

/** Manutenção: sessões/tickets/cache expirados e retenção de conversas. */
export async function runMaintenance(d: Deps): Promise<Record<string, number>> {
  const sessions = await d.db.query(`DELETE FROM ada.user_session WHERE expires_at < now() - interval '7 days'`);
  const tickets = await d.db.query(`DELETE FROM ada.sso_ticket_use WHERE expires_at < now() - interval '1 day'`);
  const cache = await d.db.query(`DELETE FROM ada.query_cache WHERE expires_at < now() - interval '1 day'`);
  const perms = await d.db.query(`DELETE FROM ada.permission_cache WHERE expires_at < now() - interval '1 day'`);
  await d.db.query(`DELETE FROM ada.worker_heartbeat WHERE last_beat_at < now() - interval '1 day'`);
  const retention = await d.conversations.applyRetention();
  return { sessions: sessions.rowCount, tickets: tickets.rowCount, cache: cache.rowCount, permissionCache: perms.rowCount, conversationsExpired: retention };
}

/** Laço contínuo do worker com heartbeat. Usado pelo serviço apps/worker e, com PGlite, embutido na API. */
export function startWorkerLoop(d: Deps, workerId: string, intervalMs: number) {
  let stopping = false;
  let lastMaintenance = 0;
  const state = { lastCycle: { at: new Date().toISOString(), ok: true, error: undefined as string | undefined } };
  const loop = async () => {
    while (!stopping) {
      try {
        const r = await runCycle(d, workerId);
        if (Date.now() - lastMaintenance > 3_600_000) {
          d.log.info(await runMaintenance(d), 'manutenção concluída');
          lastMaintenance = Date.now();
        }
        state.lastCycle = { at: new Date().toISOString(), ok: true, error: undefined };
        await d.admin.heartbeat(workerId, { lastCycle: state.lastCycle, monitorsRun: r.monitors.length, inbound: r.inbound, documents: r.documents, pid: process.pid });
        if (r.monitors.length || r.inbound || r.documents) d.log.info({ ...r, monitors: r.monitors.length }, 'ciclo');
      } catch (err) {
        state.lastCycle = { at: new Date().toISOString(), ok: false, error: (err as Error).message };
        d.log.error({ err }, 'falha no ciclo do worker; nova tentativa no próximo intervalo');
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  const done = loop();
  return {
    state,
    async stop() {
      stopping = true;
      await done.catch(() => undefined);
    }
  };
}
