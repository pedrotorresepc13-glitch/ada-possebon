import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Client, type Harness } from './helpers.ts';

let h: Harness;
let gA: Client;
let admin: Client;
beforeAll(async () => {
  h = await setup();
  gA = await h.login('gerente.a');
  admin = await h.login('admin.demo');
});
afterAll(async () => h.close());

const sumSeries = (data: { points: { values: Record<string, number> }[] }, key: string) => data.points.reduce((s, p) => s + (p.values[key] ?? 0), 0);

describe('dashboards conversacionais ponta a ponta (sem IA)', () => {
  let conversationId = '';
  let dashboardId = '';

  it('cria → refina → compara → filtro → salva', async () => {
    const r1 = await gA.post('/chat', { message: 'cria efetivo por equipe nos últimos seis meses' });
    expect(r1.status).toBe(200);
    conversationId = r1.json.conversationId;
    const meta1 = r1.json.message.metadata;
    expect(meta1.mode).toBe('deterministico');
    expect(meta1.dashboardDraft.widgets[0]).toMatchObject({ metrics: ['demo.efetivo.presentes'], groupBy: ['equipe'], type: 'bar' });
    expect(r1.json.message.content).toMatch(/SINTÉTICOS/);

    const r2 = await gA.post('/chat', { conversationId, message: 'muda para linhas' });
    expect(r2.json.message.metadata.dashboardDraft.widgets[0].type).toBe('line');
    const r3 = await gA.post('/chat', { conversationId, message: 'compara com o previsto' });
    expect(r3.json.message.metadata.dashboardDraft.widgets[0].compareMetric).toBe('demo.efetivo.previsto');
    const r4 = await gA.post('/chat', { conversationId, message: 'coloca filtro por gerência' });
    expect(r4.json.message.metadata.dashboardDraft.filterControls).toEqual(['gerencia']);
    // o patch preserva o restante (não reconstrói do zero)
    expect(r4.json.message.metadata.dashboardDraft.widgets[0]).toMatchObject({ type: 'line', compareMetric: 'demo.efetivo.previsto', groupBy: ['equipe'] });

    const r5 = await gA.post('/chat', { conversationId, message: 'salva como Efetivo EPC13' });
    dashboardId = r5.json.message.metadata.savedDashboardId;
    expect(dashboardId).toMatch(/[0-9a-f-]{36}/);
    const saved = await gA.get(`/dashboards/${dashboardId}`);
    expect(saved.json).toMatchObject({ title: 'Efetivo EPC13', access: 'owner', current_revision: 1 });
    // a spec persistida não contém números
    expect(JSON.stringify(saved.json.spec)).not.toMatch(/"values"|"points"/);
  });

  it('desfazer volta ao estado anterior do rascunho', async () => {
    const r = await gA.post(`/conversations/${conversationId}/undo`);
    expect(r.status).toBe(200);
    expect(r.json.draft.spec.filterControls).toEqual([]);
  });

  it('reabrir consulta valores atuais; mudança na fonte aparece com "Atualizar"', async () => {
    const d1 = await gA.get(`/dashboards/${dashboardId}/data`);
    expect(d1.status).toBe(200);
    const w = d1.json.data[0];
    expect(w.status).toBe('ok');
    expect(w.series.map((s: { key: string }) => s.key)).toEqual(['demo.efetivo.presentes', 'demo.efetivo.previsto']);
    // A série "presentes" pode vir do cache curto criado pelo rascunho do chat (mesmos parâmetros, mesmo usuário).
    expect(w.provenance).toMatchObject({ unitIds: [1], synthetic: true });
    const base = await gA.get(`/dashboards/${dashboardId}/data?refresh=1`);
    expect(base.json.data[0].provenance.fromCache).toBe(false);
    const before = sumSeries(base.json.data[0], 'demo.efetivo.presentes');

    await h.d.db.query(`UPDATE ada_demo.efetivo_diario SET presentes = presentes + 10 WHERE unit_id = 1 AND data >= '2026-10-01'`);
    const cached = await gA.get(`/dashboards/${dashboardId}/data`);
    expect(cached.json.data[0].provenance.fromCache).toBe(true);
    expect(sumSeries(cached.json.data[0], 'demo.efetivo.presentes')).toBe(before);

    const fresh = await gA.get(`/dashboards/${dashboardId}/data?refresh=1`);
    expect(fresh.json.data[0].provenance.fromCache).toBe(false);
    expect(sumSeries(fresh.json.data[0], 'demo.efetivo.presentes')).toBeGreaterThan(before);
  });

  it('filtro interativo só por controles declarados', async () => {
    await gA.put(`/dashboards/${dashboardId}`, { ops: [{ op: 'add_filter_control', dimension: 'gerencia' }] });
    const values = await gA.get(`/dashboards/${dashboardId}/filter-values?dimension=gerencia`);
    expect(values.json).toEqual(['Gerência de Montagem', 'Gerência de Obras']);
    const filtered = await gA.get(`/dashboards/${dashboardId}/data?filters=${encodeURIComponent(JSON.stringify([{ dimension: 'gerencia', op: 'eq', values: ['Gerência de Obras'] }]))}`);
    expect(filtered.json.data[0].points.map((p: { label: string }) => p.label).sort()).toEqual(['Andaimes', 'Civil']);
    const bad = await gA.get(`/dashboards/${dashboardId}/data?filters=${encodeURIComponent(JSON.stringify([{ dimension: 'status', op: 'eq', values: ['x'] }]))}`);
    expect(bad.status).toBe(400);
  });

  it('fonte indisponível: aviso explícito de dado desatualizado, nunca cache como atual', async () => {
    await admin.post('/admin/connectors/demo.efetivo/status', { status: 'desabilitado' });
    const stale = await gA.get(`/dashboards/${dashboardId}/data?refresh=1`);
    const w = stale.json.data[0];
    expect(w.provenance.fromCache).toBe(true);
    expect(w.provenance.limitations.join(' ')).toMatch(/DADOS DESATUALIZADOS/);
    const noCache = await gA.post('/dashboards/preview', {
      spec: { specVersion: 1, title: 'x', widgets: [{ id: 'w1', type: 'kpi', title: 'x', metrics: ['demo.efetivo.previsto'], timeRange: { kind: 'last', amount: 2, unit: 'day' } }] }
    });
    expect(noCache.json.data[0]).toMatchObject({ status: 'source_unavailable' });
    await admin.post('/admin/connectors/demo.efetivo/status', { status: 'demonstracao' });
  });

  it('permissão é reaplicada ao abrir: programa revogado ⇒ widget proibido', async () => {
    h.identity.update(9002, { programs: { DemoOsList: ['view'], AdaGestor: ['view'] } });
    await h.d.db.query(`DELETE FROM ada.permission_cache WHERE system_user_id = 9002`);
    const r = await gA.get(`/dashboards/${dashboardId}/data`);
    expect(r.json.data[0]).toMatchObject({ status: 'forbidden', points: [] });
    h.identity.update(9002, { programs: { DemoEfetivoList: ['view'], DemoTreinamentoList: ['view'], DemoOsList: ['view'], DemoCompraList: ['view'], AdaGestor: ['view'] } });
    await h.d.db.query(`DELETE FROM ada.permission_cache WHERE system_user_id = 9002`);
  });

  it('histórico de revisões e reversão', async () => {
    const revs = await gA.get(`/dashboards/${dashboardId}/revisions`);
    expect(revs.json.length).toBeGreaterThanOrEqual(2);
    const rv = await gA.post(`/dashboards/${dashboardId}/revert`, { revision: 1 });
    expect(rv.json.spec.filterControls).toEqual(['gerencia']);
  });

  it('exportação CSV com proveniência e neutralização de fórmulas', async () => {
    await gA.put(`/dashboards/${dashboardId}`, { ops: [{ op: 'rename', title: '=HYPERLINK("http://x")' }] });
    const csv = await gA.get(`/dashboards/${dashboardId}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain(`'=HYPERLINK`);
    expect(csv.body).toMatch(/DADOS SINTÉTICOS/);
  });

  it('exemplos obrigatórios: treinamentos, OS por status e solicitações de compra (sintéticos)', async () => {
    for (const msg of ['cria treinamentos por equipe nos últimos três meses', 'mostra os por status nos últimos seis meses', 'cria solicitações de compra por categoria nos últimos seis meses']) {
      const r = await gA.post('/chat', { message: msg });
      const draft = r.json.message.metadata.dashboardDraft;
      expect(draft, msg).toBeTruthy();
      const prev = await gA.post('/dashboards/preview', { spec: draft });
      expect(prev.json.data[0].status, msg).toBe('ok');
      expect(prev.json.data[0].points.length, msg).toBeGreaterThan(0);
    }
  });

  it('spec com métrica não catalogada é rejeitada (sem alucinação de fórmula)', async () => {
    const r = await gA.post('/dashboards', { spec: { specVersion: 1, title: 'x', widgets: [{ id: 'w1', type: 'bar', title: 'x', metrics: ['possebon.lucro_inventado'], timeRange: { kind: 'last', amount: 1, unit: 'month' } }] } });
    expect(r.status).toBe(400);
  });
});
