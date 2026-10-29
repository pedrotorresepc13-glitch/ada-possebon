import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiProvider, AiTurnInput } from '../apps/api/src/ai/provider.ts';
import { PossebonBrainClient } from '../apps/api/src/services/brain.ts';
import { setup, type Harness } from './helpers.ts';

let h: Harness;
let capturedInstructions = '';
const ai: AiProvider = {
  name: 'fake',
  model: 'fake',
  configured: true,
  async run(input: AiTurnInput) {
    capturedInstructions = input.instructions;
    return { text: 'Pronto.', usage: { input: 10, output: 5 }, toolCalls: [], steps: 1 };
  }
};

beforeAll(async () => {
  h = await setup({
    ai,
    env: {
      POSSEBON_BRAIN_CONTEXT_URL: 'https://app.possebon.com.br:19302/api/ada/v1/brain/context',
      POSSEBON_SERVICE_TOKEN: 'test-only-token'
    }
  });
});
afterAll(async () => h.close());

describe('Contexto de identidade e diagnóstico real do Brain', () => {
  it('inclui nome/login do usuário autenticado sem deduzir cargo e não mostra dados de outra pessoa', async () => {
    const user = await h.login('admin.demo');
    const result = await user.post('/chat', { message: 'Quem sou eu?' });
    expect(result.status).toBe(200);
    expect(capturedInstructions).toContain('admin.demo');
    expect(capturedInstructions).toContain('Contexto: unidade ativa');
    expect(capturedInstructions).toContain('não deduza cargo');
    expect(capturedInstructions).not.toContain('Gerente B (sintético)');
  });

  it('registra configurado não validado, valida a leitura real e mantém status após nova sincronização', async () => {
    const getStatus = async () => {
      const r = await (await h.login('admin.demo')).get('/admin/connectors');
      expect(r.status).toBe(200);
      return (r.json as { id: string; status: string }[]).find((c) => c.id === 'possebon.brain')?.status;
    };
    expect(await getStatus()).toBe('configurado_nao_validado');
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'success', data: { unit_id: 1, items: [] } }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    );
    h.d.brain = new PossebonBrainClient(h.d.config.brain, h.d.config.possebon.serviceToken, fakeFetch as typeof fetch);
    const admin = await h.login('admin.demo');
    const test = await admin.post('/admin/connectors/possebon.brain/test');
    expect(test.status).toBe(200);
    expect(test.json.ok).toBe(true);
    expect(test.json.message).toMatch(/Conexão Brain validada/);
    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(await getStatus()).toBe('ativo');
    await h.d.catalog.syncToDb();
    expect(await getStatus()).toBe('ativo');
  });

  it('não permite teste administrativo a usuário comum', async () => {
    const user = await h.login('colab.a');
    expect((await user.post('/admin/connectors/possebon.brain/test')).status).toBe(403);
  });
});
