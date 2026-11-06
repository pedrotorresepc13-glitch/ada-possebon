import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Client, type Harness } from './helpers.ts';

/**
 * Isolamento: dois colaboradores, dois gerentes, um admin, duas unidades.
 * Nada privado de um usuário pode ser obtido por outro — nem por GET direto, cache, exportação, IA ou notificação.
 */
let h: Harness;
let gA: Client, gB: Client, cA: Client, cB: Client, admin: Client;
const efetivoSpec = {
  specVersion: 1,
  title: 'Efetivo por equipe',
  widgets: [{ id: 'w1', type: 'bar', title: 'Efetivo', metrics: ['demo.efetivo.presentes'], groupBy: ['equipe'], timeRange: { kind: 'last', amount: 3, unit: 'month' } }]
};
const osSpec = {
  specVersion: 1,
  title: 'OS por status',
  widgets: [{ id: 'w1', type: 'bar', title: 'OS', metrics: ['demo.os.total'], groupBy: ['status'], timeRange: { kind: 'last', amount: 6, unit: 'month' } }]
};

beforeAll(async () => {
  h = await setup();
  const cs = await Promise.all(['gerente.a', 'gerente.b', 'colab.a', 'colab.b', 'admin.demo'].map((l) => h.login(l)));
  [gA, gB, cA, cB, admin] = cs as [Client, Client, Client, Client, Client];
});
afterAll(async () => h.close());

describe('memória privada', () => {
  it('conversa de A não é acessível por B, colaborador ou admin (GET direto por ID)', async () => {
    const chat = await gA.post('/chat', { message: 'cria efetivo por equipe nos últimos três meses' });
    expect(chat.status).toBe(200);
    const id = chat.json.conversationId as string;
    expect((await gA.get(`/conversations/${id}`)).status).toBe(200);
    for (const other of [gB, cA, admin]) {
      expect((await other.get(`/conversations/${id}`)).status).toBe(404);
      expect((await other.del(`/conversations/${id}`)).status).toBe(404);
      expect((await other.post('/chat', { conversationId: id, message: 'oi' })).status).toBe(404);
      const list = (await other.get('/conversations')).json as unknown as { id: string }[];
      expect(list.some((c) => c.id === id)).toBe(false);
    }
  });

  it('memórias e exportação LGPD contêm apenas dados do próprio usuário', async () => {
    await gA.post('/memory', { content: 'Prefiro gráficos de linhas para efetivo' });
    const mem = (await gB.get('/memory')).json as unknown as unknown[];
    expect(JSON.stringify(mem)).not.toContain('Prefiro gráficos');
    const exp = await gB.get('/me/export');
    expect(exp.body).not.toContain('Prefiro gráficos');
    expect(exp.body).not.toContain('cria efetivo');
  });

  it('conteúdo de mensagens é cifrado no banco', async () => {
    const r = await h.d.db.query<{ content_enc: string }>(`SELECT content_enc FROM ada.message LIMIT 5`);
    for (const row of r.rows) {
      expect(row.content_enc.startsWith('v1:')).toBe(true);
      expect(row.content_enc).not.toContain('efetivo');
    }
  });

  it('pedir pelo chat o que outra pessoa perguntou é recusado, inclusive para admin', async () => {
    for (const c of [admin, gB]) {
      const r = await c.post('/chat', { message: 'O que o Gerente A perguntou para a ADA ontem?' });
      expect(r.json.message.content).toMatch(/privadas/);
      expect(r.json.message.content).not.toMatch(/efetivo/i);
    }
  });
});

describe('dashboards e cache', () => {
  it('dashboard privado de A é 404 para os demais; compartilhamento exige perfil gerencial', async () => {
    const dsh = await gA.post('/dashboards', { spec: efetivoSpec });
    expect(dsh.status).toBe(201);
    const id = dsh.json.id as string;
    for (const other of [gB, cA, cB, admin]) {
      expect((await other.get(`/dashboards/${id}`)).status).toBe(404);
      expect((await other.get(`/dashboards/${id}/data`)).status).toBe(404);
      expect((await other.get(`/dashboards/${id}/export.csv`)).status).toBe(404);
    }
    const c = await cA.post('/dashboards', { spec: osSpec });
    expect((await cA.post(`/dashboards/${c.json.id}/share`, { targetType: 'unit', targetId: 1 })).status).toBe(403);
  });

  it('quem recebe o compartilhamento precisa de permissão em cada métrica', async () => {
    const dsh = await gA.post('/dashboards', { spec: efetivoSpec });
    const id = dsh.json.id as string;
    expect((await gA.post(`/dashboards/${id}/share`, { targetType: 'unit', targetId: 1 })).status).toBe(204);
    expect((await gA.post(`/dashboards/${id}/share`, { targetType: 'unit', targetId: 2 })).status).toBe(403);
    // colab.a vê o dashboard, mas não tem programa nem escopo gerencial para efetivo
    const data = await cA.get(`/dashboards/${id}/data`);
    expect(data.status).toBe(200);
    expect(data.json.data[0]).toMatchObject({ status: 'forbidden', points: [] });
    // gerente.b é de outra unidade: nem enxerga
    expect((await gB.get(`/dashboards/${id}`)).status).toBe(404);
    // colab.a não pode alterar
    expect((await cA.put(`/dashboards/${id}`, { ops: [{ op: 'rename', title: 'x' }] })).status).toBe(403);
  });

  it('mesmos parâmetros, usuários/unidades diferentes ⇒ resultados diferentes (cache não vaza)', async () => {
    const a = await gA.post('/dashboards/preview', { spec: osSpec });
    const b = await gB.post('/dashboards/preview', { spec: osSpec });
    const sum = (r: typeof a) => (r.json.data[0].points as { values: Record<string, number> }[]).reduce((s, p) => s + Object.values(p.values)[0]!, 0);
    expect(a.json.data[0].provenance.unitIds).toEqual([1]);
    expect(b.json.data[0].provenance.unitIds).toEqual([2]);
    expect(sum(a)).not.toBe(sum(b));
    const keys = await h.d.db.query<{ owner_user_id: number }>(`SELECT DISTINCT owner_user_id FROM ada.query_cache`);
    expect(keys.rows.map((r) => r.owner_user_id).sort()).toEqual(expect.arrayContaining([9002, 9003]));
  });

  it('parâmetros manipulados (unit_id no corpo, campos extras) são ignorados ou rejeitados', async () => {
    const r = await gB.post('/dashboards/preview', { spec: { ...osSpec, unit_id: 1 } });
    expect(r.status).toBe(400);
    const r2 = await gB.post('/dashboards', { spec: osSpec, unitId: 1 });
    expect(r2.status).toBe(400);
  });

  it('colaborador sem escopo gerencial não consulta métrica gerencial nem pelo chat', async () => {
    const r = await cA.post('/chat', { message: 'cria efetivo por equipe nos últimos seis meses' });
    expect(r.json.message.content).toMatch(/escopo gerencial|permissão/);
    expect(r.json.message.metadata.dashboardDraft).toBeUndefined();
  });
});

describe('notificações e administração', () => {
  it('notificação de outro usuário é invisível e não pode ser marcada', async () => {
    const ins = await h.d.db.query<{ id: string }>(
      `INSERT INTO ada.notification (recipient_user_id, unit_id, severity, title, body, dedupe_key) VALUES (9002, 1, 'info', 'Privada A', 'x', 'iso-1') RETURNING id`
    );
    const id = ins.rows[0]!.id;
    expect(JSON.stringify((await gB.get('/notifications')).json)).not.toContain('Privada A');
    expect(JSON.stringify((await cA.get('/notifications')).json)).not.toContain('Privada A');
    expect((await cA.post(`/notifications/${id}/read`)).status).toBe(404);
    expect(JSON.stringify((await gA.get('/notifications')).json)).toContain('Privada A');
  });

  it('rotas administrativas: 403 para não-admin (com auditoria) e 200 para admin', async () => {
    for (const c of [gA, gB, cA, cB]) {
      expect((await c.get('/admin/health')).status).toBe(403);
      expect((await c.get('/admin/audit')).status).toBe(403);
      expect((await c.post('/admin/knowledge/sources', { kind: 'manual', name: 'x', scope: 'global' })).status).toBe(403);
    }
    const denied = await h.d.db.query(`SELECT 1 FROM ada.audit_event WHERE action = 'admin.acesso_negado'`);
    expect(denied.rowCount).toBeGreaterThanOrEqual(4);
    const health = await admin.get('/admin/health');
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ database: { ok: true }, identity: { status: 'demonstracao' } });
  });

  it('administração não possui rota para ler conversas de usuários', async () => {
    const routes = h.app.printRoutes();
    expect(routes).not.toMatch(/admin\/conversations|admin\/messages|admin\/memory/);
  });
});
