import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeps } from '../apps/api/src/core.ts';
import { silentLogger } from '../apps/api/src/logger.ts';
import type { AiProvider } from '../apps/api/src/ai/provider.ts';
import { runCycle } from '../apps/worker/src/cycle.ts';
import { API, setup, signInternal, type Harness } from './helpers.ts';

/** Provedor espião: qualquer chamada de IA no ciclo de monitoramento falha o teste. */
const spyAi: AiProvider & { calls: number } = {
  name: 'espiao',
  model: 'espiao',
  configured: false,
  calls: 0,
  async run() {
    spyAi.calls++;
    throw new Error('IA não deveria ser chamada');
  }
};

let h: Harness;
let monitorId = '';
const H = 3_600_000;

beforeAll(async () => {
  h = await setup({ ai: spyAi });
});
afterAll(async () => h.close());

// Saltos de relógio expiram a sessão por inatividade (comportamento correto): cada consulta usa login novo.
const as = (login: string) => h.login(login);
const notes = async (login = 'gerente.a') => (await (await as(login)).get('/notifications')).json as unknown as { title: string; body: string; monitorId: string | null }[];

describe('IA cria a regra; motor determinístico monitora', () => {
  it('interpretação → preview → proposta INATIVA (nada é ativado sem confirmação)', async () => {
    const r = await (await as('gerente.a')).post('/chat', { message: 'ADA, monitore a OS 123 e me avise quando mudarem o prazo ou quando ficar 48h sem avanço.' });
    const prop = r.json.message.metadata.monitorProposal;
    expect(prop.definition).toMatchObject({ source: 'demo.os', enabled: false, filters: [{ field: 'os_id', op: 'eq', value: 123 }] });
    expect(prop.preview.valid).toBe(true);
    expect(prop.preview.summary.join(' ')).toMatch(/não usa IA/);
    expect(prop.preview.simulation.recordsMatched).toBe(1);
    expect(r.json.message.content).toMatch(/INATIVA/);
    const list = (await (await as('gerente.a')).get('/monitors')).json as unknown as unknown[];
    expect(list).toHaveLength(0);

    const created = await (await as('gerente.a')).post('/monitors', { definition: prop.definition, activate: true });
    expect(created.status).toBe(201);
    monitorId = created.json.monitor.id;
    expect(created.json.monitor.status).toBe('active');
  });

  it('primeira execução é linha de base: sem alertas e sem IA', async () => {
    const r = await runCycle(h.d, 'teste-1');
    expect(r.monitors).toEqual([{ id: monitorId, status: 'sem_mudancas', events: 0 }]);
    expect(await notes()).toHaveLength(0);
    expect(spyAi.calls).toBe(0);
  });

  it('mudança de prazo gera exatamente 1 notificação com antes/agora', async () => {
    h.advance(20 * 60_000);
    await h.d.db.query(`UPDATE ada_demo.os SET prazo_previsto = prazo_previsto + interval '5 days', updated_at = $1 WHERE os_id = 123`, [h.clock.t]);
    const r = await runCycle(h.d, 'teste-1');
    expect(r.monitors[0]).toMatchObject({ status: 'ok', events: 1 });
    const n = await notes();
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toMatch(/OS 123/);
    expect(n[0]!.body).toMatch(/Prazo previsto alterado em 27\/10\/2026 12:20; antes 30\/10\/2026 12:00, agora 04\/11\/2026 12:00\./);
    expect(spyAi.calls).toBe(0);
  });

  it('repetição e polling sem mudanças não duplicam nem chamam IA', async () => {
    for (let i = 0; i < 3; i++) {
      h.advance(20 * 60_000);
      await runCycle(h.d, 'teste-1');
    }
    expect(await notes()).toHaveLength(1);
    const runs = await h.d.db.query<{ ai_calls: number }>(`SELECT ai_calls FROM ada.monitor_run WHERE monitor_id = $1`, [monitorId]);
    expect(runs.rows.length).toBeGreaterThanOrEqual(4);
    expect(runs.rows.every((x) => x.ai_calls === 0)).toBe(true);
    expect(spyAi.calls).toBe(0);
  });

  it('reinício do processo recupera regras e watermark sem duplicar', async () => {
    const d2 = await createDeps(h.d.config, { db: h.d.db, identity: h.identity, now: () => h.clock.t, log: silentLogger, ai: spyAi });
    h.advance(20 * 60_000);
    await runCycle(d2, 'teste-2-reiniciado');
    expect(await notes()).toHaveLength(1);
    // reprocessar o mesmo fato manualmente também é idempotente
    await h.d.db.query(`UPDATE ada.monitor_watermark SET snapshot = jsonb_set(snapshot, '{values,prazo_previsto}', '"2026-10-30T15:00:00.000Z"') WHERE monitor_id = $1`, [monitorId]);
    await h.d.runner.runOne(monitorId, 'agendado');
    expect(await notes()).toHaveLength(1);
  });

  it('48h sem atualização dispara uma vez', async () => {
    h.advance(49 * H);
    await runCycle(h.d, 'teste-1');
    const n = await notes();
    expect(n.filter((x) => /sem atualização/.test(x.title))).toHaveLength(1);
    h.advance(2 * H);
    await runCycle(h.d, 'teste-1');
    expect((await notes()).filter((x) => /sem atualização/.test(x.title))).toHaveLength(1);
  });

  it('regra pausada não dispara; retomada volta a verificar', async () => {
    await (await as('gerente.a')).post(`/monitors/${monitorId}/pause`);
    h.advance(H);
    await h.d.db.query(`UPDATE ada_demo.os SET prazo_previsto = prazo_previsto + interval '1 day', updated_at = $1 WHERE os_id = 123`, [h.clock.t]);
    const r = await runCycle(h.d, 'teste-1');
    expect(r.monitors).toHaveLength(0);
    const before = (await notes()).length;
    await (await as('gerente.a')).post(`/monitors/${monitorId}/resume`);
    await runCycle(h.d, 'teste-1');
    expect((await notes()).length).toBe(before + 1);
  });

  it('fonte indisponível: estado de erro real, degradação após falhas e aviso — nunca falso sucesso', async () => {
    const admin = await h.login('admin.demo');
    await admin.post('/admin/connectors/demo.os/status', { status: 'desabilitado' });
    for (let i = 0; i < 3; i++) {
      h.advance(7 * H);
      const r = await runCycle(h.d, 'teste-1');
      expect(r.monitors[0]!.status).toBe('fonte_indisponivel');
    }
    const m = await (await as('gerente.a')).get(`/monitors/${monitorId}`);
    expect(m.json).toMatchObject({ status: 'degraded', health: 'degradado' });
    expect((await notes()).some((n) => /degradado/.test(n.title))).toBe(true);
    const hist = await (await as('gerente.a')).get(`/monitors/${monitorId}/history`);
    expect(hist.json.runs.filter((x: { status: string }) => x.status === 'fonte_indisponivel').length).toBe(3);
    const restored = await (await as('admin.demo')).post('/admin/connectors/demo.os/status', { status: 'demonstracao' });
    expect(restored.status).toBe(204);
    h.advance(7 * H);
    await runCycle(h.d, 'teste-1');
    expect((await (await as('gerente.a')).get(`/monitors/${monitorId}`)).json.status).toBe('active');
  });

  it('edição gera nova revisão e preserva histórico de execuções', async () => {
    const m = await (await as('gerente.a')).get(`/monitors/${monitorId}`);
    const runsBefore = (await (await as('gerente.a')).get(`/monitors/${monitorId}/history`)).json.runs.length;
    const def = { ...m.json.definition, cooldown_minutes: 30, triggers: [...m.json.definition.triggers, { type: 'status_changed', field: 'status' }] };
    const up = await (await as('gerente.a')).put(`/monitors/${monitorId}`, { definition: def });
    expect(up.json.current_revision).toBe(2);
    const hist = (await (await as('gerente.a')).get(`/monitors/${monitorId}/history`)).json;
    expect(hist.revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);
    expect(hist.runs.length).toBe(runsBefore);
  });

  it('evento por webhook (HMAC) dispara e é idempotente por event_id', async () => {
    const before = (await notes()).length;
    const ev = {
      source: 'demo.os', recordKey: '123', unitId: 1, occurredAt: new Date(h.clock.t.getTime() + 60_000).toISOString(), eventId: 'evt-' + randomUUID(),
      record: { os_id: 123, titulo: 'Substituição de painel elétrico — área de utilidades', status: 'aguardando_material', prazo_previsto: '2026-11-20T15:00:00Z', responsavel: 'x', percentual_concluido: 50, updated_at: new Date(h.clock.t.getTime() + 60_000).toISOString(), created_at: '2026-10-07T15:00:00Z' }
    };
    for (let i = 0; i < 2; i++) {
      const s = signInternal(ev, h.clock.t);
      const r = await h.app.inject({ method: 'POST', url: `${API}/internal/events`, headers: s.headers, payload: s.raw });
      expect(r.json()).toMatchObject({ accepted: true, duplicate: i === 1 });
    }
    await runCycle(h.d, 'teste-1');
    const after = await notes();
    expect(after.length).toBe(before + 2); // prazo alterado + status alterado
    expect(spyAi.calls).toBe(0);
  });

  it('isolamento: gerente B não vê o monitor de A e não acompanha OS de outra unidade', async () => {
    expect((await (await as('gerente.b')).get(`/monitors/${monitorId}`)).status).toBe(404);
    expect((await (await as('gerente.b')).post(`/monitors/${monitorId}/pause`)).status).toBe(404);
    const p = await (await as('gerente.b')).post('/monitors/preview', { definition: { version: 1, name: 'x', source: 'demo.os', filters: [{ field: 'os_id', op: 'eq', value: 123 }], triggers: [{ type: 'field_changed', field: 'prazo_previsto' }] } });
    expect(p.json.simulation.recordsMatched).toBe(0);
    expect((await notes('gerente.b')).some((n) => /OS 123/.test(n.title))).toBe(false);
  });

  it('validação recusa campos inexistentes, tipos incompatíveis e código', async () => {
    const bad = await (await as('gerente.a')).post('/monitors/preview', { definition: { version: 1, name: 'x', source: 'demo.os', triggers: [{ type: 'deadline_near', field: 'titulo', within_hours: 24 }, { type: 'field_changed', field: 'senha' }] } });
    expect(bad.json.valid).toBe(false);
    expect(bad.json.errors.join(' ')).toMatch(/exige campo de data/);
    expect(bad.json.errors.join(' ')).toMatch(/Campo inexistente/);
    const code = await (await as('gerente.a')).post('/monitors/preview', { definition: { version: 1, name: 'x', source: 'demo.os', triggers: [{ type: 'javascript', code: 'process.exit()' }] } });
    expect(code.json.valid).toBe(false);
  });

  it('exclusão encerra verificações', async () => {
    expect((await (await as('gerente.a')).del(`/monitors/${monitorId}`)).status).toBe(204);
    h.advance(H);
    const r = await runCycle(h.d, 'teste-1');
    expect(r.monitors.find((x) => x.id === monitorId)).toBeUndefined();
  });
});
