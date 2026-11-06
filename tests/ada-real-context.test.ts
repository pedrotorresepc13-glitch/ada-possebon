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
    if (input.input.at(-1)?.content === 'Investigue a cobertura de materiais.') {
      return { text: 'Resultado parcial: conferir o catálogo.', partial: true, usage: { input: 10, output: 5 }, toolCalls: [], steps: 1 };
    }
    if (input.input.at(-1)?.content.startsWith('Retome a investigação')) {
      expect(input.input.at(-1)?.content).toContain('Investigue a cobertura de materiais.');
      expect(input.tools.map(tool => tool.name)).toContain('ver_cobertura_cerebro');
      expect(input.tools.map(tool => tool.name)).not.toContain('criar_tela');
      await expect(input.execute('criar_tela', {})).rejects.toThrow('somente consultas');
      return { text: 'Investigação retomada.', usage: { input: 10, output: 5 }, toolCalls: [], steps: 1 };
    }
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
  it('retoma uma investigação persistida em modo de leitura na mesma conversa', async () => {
    const user = await h.login('admin.demo');
    const start = await user.post('/chat', { message: 'Investigue a cobertura de materiais.' });
    expect(start.json.message.metadata.investigation.questionId).toBe(start.json.userMessageId);
    const resume = await user.post('/chat', { conversationId: start.json.conversationId, message: 'Continuar investigação' });
    expect(resume.json.message.content).toBe('Investigação retomada.');
    expect(resume.json.message.metadata.investigation).toBeUndefined();
  });

  it('inclui nome/login do usuário autenticado sem deduzir cargo e não mostra dados de outra pessoa', async () => {
    const user = await h.login('admin.demo');
    const result = await user.post('/chat', { message: 'Quem sou eu?' });
    expect(result.status).toBe(200);
    expect(capturedInstructions).toContain('admin.demo');
    expect(capturedInstructions).toContain('Contexto: unidade ativa');
    expect(capturedInstructions.toLowerCase()).toContain('não deduza cargo');
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
