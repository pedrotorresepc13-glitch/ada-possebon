import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAIResponsesProvider } from '../apps/api/src/ai/openai.ts';
import type { AiProvider, AiTurnInput } from '../apps/api/src/ai/provider.ts';
import { createPglite } from '../apps/api/src/db.ts';
import { migrateDown, migrateUp } from '../apps/api/src/migrate.ts';
import { setup, type Harness } from './helpers.ts';

describe('provedor OpenAI (Responses API) — contrato com fetch simulado', () => {
  it('laço de function calling, store:false, chave só no cabeçalho', async () => {
    const calls: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ body, headers: init.headers as Record<string, string> });
      const out =
        calls.length === 1
          ? { output: [{ type: 'function_call', call_id: 'c1', name: 'buscar_catalogo', arguments: '{"texto":"efetivo"}' }], usage: { input_tokens: 10, output_tokens: 5 } }
          : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta final.' }] }], usage: { input_tokens: 20, output_tokens: 7 } };
      return new Response(JSON.stringify(out), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAIResponsesProvider({ apiKey: 'sk-test-0123456789abcdef', model: 'modelo-configurado', baseUrl: 'https://api.openai.com/v1', timeoutMs: 5000, maxOutputTokens: 500 }, fakeFetch);
    const executed: string[] = [];
    const r = await p.run({ instructions: 'x', input: [{ role: 'user', content: 'oi' }], tools: [{ name: 'buscar_catalogo', description: 'd', parameters: { type: 'object' } }], execute: async (n) => (executed.push(n), { ok: true }) });
    expect(r.text).toBe('Resposta final.');
    expect(executed).toEqual(['buscar_catalogo']);
    expect(r.usage).toEqual({ input: 30, output: 12 });
    expect(calls[0]!.body).toMatchObject({ model: 'modelo-configurado', store: false, tool_choice: 'auto' });
    expect(JSON.stringify(calls[0]!.body)).not.toContain('sk-test');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-test-0123456789abcdef');
    expect(calls[1]!.body.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function_call_output', call_id: 'c1' })]));
  });

  it('recusa endpoint sem HTTPS', async () => {
    const p = new OpenAIResponsesProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://api.inseguro/v1', timeoutMs: 1000, maxOutputTokens: 10 });
    await expect(p.run({ instructions: '', input: [], tools: [], execute: async () => null })).rejects.toThrow(/HTTPS/);
  });
});

describe('chat com IA: ferramentas sempre passam pela autorização do servidor', () => {
  let h: Harness;
  const seen: unknown[] = [];
  // "Modelo" roteirizado que tenta consultar métrica gerencial e propor um monitor.
  const scripted: AiProvider = {
    name: 'roteiro',
    model: 'roteiro',
    configured: true,
    async run(args: AiTurnInput) {
      seen.push(await args.execute('consultar_metrica', { metric: 'demo.compras.valor', timeRange: { kind: 'last', amount: 3, unit: 'month' } }).catch((e: Error) => ({ erro: e.message })));
      seen.push(await args.execute('buscar_conhecimento', { consulta: 'qualquer' }));
      seen.push(await args.execute('propor_monitor', { version: 1, name: 'x', source: 'demo.os', filters: [{ field: 'os_id', op: 'eq', value: 123 }], triggers: [{ type: 'field_changed', field: 'status' }] }));
      await args.execute('executar_sql', { sql: 'DROP SCHEMA ada CASCADE' }).catch((e: Error) => seen.push({ erro: e.message }));
      return { text: 'ok', usage: { input: 1, output: 1 }, toolCalls: [], steps: 1 };
    }
  };
  beforeAll(async () => {
    h = await setup({ ai: scripted });
  });
  afterAll(async () => h.close());

  it('colaborador sem escopo: métrica restrita negada; ferramenta inexistente recusada; monitor só proposto', async () => {
    const c = await h.login('colab.a');
    const r = await c.post('/chat', { message: 'quanto gastamos em compras?' });
    expect(r.json.message.metadata.mode).toBe('openai');
    expect(JSON.stringify(seen[0])).toMatch(/permissão|escopo gerencial/);
    expect(seen[1]).toMatchObject({ trechos: [] });
    expect(seen[2]).toMatchObject({ valido: true });
    expect(seen[3]).toMatchObject({ erro: 'Ferramenta não permitida' });
    expect(r.json.message.metadata.monitorProposal.definition.enabled).toBe(false);
    expect(((await c.get('/monitors')).json as unknown as unknown[]).length).toBe(0);
    const usage = await h.d.db.query(`SELECT provider, status FROM ada.ai_usage`);
    expect(usage.rows).toEqual([{ provider: 'roteiro', status: 'ok' }]);
  });
});

describe('migrations', () => {
  it('up → down → up em banco limpo; checksum protege migration aplicada', async () => {
    const db = await createPglite();
    expect(await migrateUp(db)).toEqual(['0001_ada_init', '0002_ada_ai_settings', '0003_user_initial_study', '0004_brain_graph']);
    expect(await migrateUp(db)).toEqual([]);
    expect(await migrateDown(db, 4)).toEqual(['0004_brain_graph', '0003_user_initial_study', '0002_ada_ai_settings', '0001_ada_init']);
    const gone = await db.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ada'`);
    expect(gone.rowCount).toBe(0);
    expect(await migrateUp(db)).toEqual(['0001_ada_init', '0002_ada_ai_settings', '0003_user_initial_study', '0004_brain_graph']);
    await db.query(`UPDATE ada_migrations.applied SET checksum = 'adulterado'`);
    await expect(migrateUp(db)).rejects.toThrow(/checksum/);
    await db.close();
  });

  it('trilha de auditoria é imutável', async () => {
    const db = await createPglite();
    await migrateUp(db);
    await db.query(`INSERT INTO ada.audit_event (action, outcome) VALUES ('x', 'ok')`);
    await expect(db.query(`UPDATE ada.audit_event SET action = 'y'`)).rejects.toThrow(/somente inserção/);
    await expect(db.query(`DELETE FROM ada.audit_event`)).rejects.toThrow(/somente inserção/);
    await db.close();
  });
});
