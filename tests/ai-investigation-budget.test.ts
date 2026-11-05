import { describe, expect, it } from 'vitest';
import { OpenAIResponsesProvider } from '../apps/api/src/ai/openai.ts';

const providerConfig = {
  apiKey: 'sk-test-not-real',
  model: 'test-model',
  baseUrl: 'https://example.test/v1',
  timeoutMs: 5000,
  maxOutputTokens: 400
};
const response = (output: unknown[], inputTokens = 10, outputTokens = 5) =>
  new Response(JSON.stringify({ output, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });

describe('Investigação da Ada com limite de etapas', () => {
  it.each(['leitura', 'escrita', 'duplicata'])('restringe a continuação a leituras inéditas: %s', async (action) => {
    const requests: Record<string, unknown>[] = [];
    const executed: string[] = [];
    const provider = new OpenAIResponsesProvider(providerConfig, async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      const step = requests.length;
      if (step > 2) return response([{ type: 'message', content: [{ type: 'output_text', text: 'Síntese.' }] }]);
      return response([{
        type: 'function_call', call_id: 'c' + step,
        name: step === 2 && action === 'escrita' ? 'salvar' : 'consultar',
        arguments: JSON.stringify({ pagina: action === 'duplicata' ? 1 : step })
      }]);
    });
    const result = await provider.run({
      instructions: 'Investigue.', input: [{ role: 'user', content: 'Confira os dados.' }],
      tools: ['consultar', 'salvar'].map(name => ({ name, description: name, parameters: { type: 'object' } })),
      execute: async (name) => { executed.push(name); return { ok: true }; },
      maxSteps: 1, continuation: { steps: 2, readTools: ['consultar'] }
    });
    expect(requests[1]?.tools).toEqual([expect.objectContaining({ name: 'consultar' })]);
    expect(requests[1]?.input).toContainEqual({ type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' });
    expect(executed).toEqual(action === 'leitura' ? ['consultar', 'consultar'] : ['consultar']);
    expect(result.partial).toBe(action === 'leitura' ? undefined : true);
    expect(requests[2]?.tool_choice).toBe(action === 'leitura' ? 'auto' : 'none');
  });

  it('preserva resultados, pede síntese sem novas ferramentas e registra todo o consumo', async () => {
    const requests: Record<string, unknown>[] = [];
    const executed: string[] = [];
    const provider = new OpenAIResponsesProvider(providerConfig, async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length < 3) return response([{
        type: 'function_call', name: 'consultar_banco', call_id: 'call-' + requests.length,
        arguments: JSON.stringify({ tabela: 'efetivo' })
      }]);
      return response([{ type: 'message', content: [{ type: 'output_text', text: 'Conferi dois conjuntos de dados; falta validar a data.' }] }]);
    });
    const result = await provider.run({
      instructions: 'Responda usando somente os resultados autorizados.',
      input: [{ role: 'user', content: 'Como está o efetivo?' }],
      maxSteps: 2,
      tools: [{ name: 'consultar_banco', description: 'Consulta permitida', parameters: { type: 'object' } }],
      execute: async (name) => { executed.push(name); return { consulta: 'ok', origem: 'PostgreSQL' }; }
    });
    expect(requests).toHaveLength(3);
    expect(executed).toEqual(['consultar_banco', 'consultar_banco']);
    expect(requests[2]?.tools).toEqual([]);
    expect(requests[2]?.tool_choice).toBe('none');
    expect(result).toMatchObject({
      partial: true, steps: 3, usage: { input: 30, output: 15 },
      toolCalls: [{ name: 'consultar_banco', ok: true }, { name: 'consultar_banco', ok: true }]
    });
    expect(result.text).toContain('Resultado parcial:');
    expect(result.text).toContain('falta validar a data');
  });

  it('se a síntese falhar, informa progresso sem fabricar uma conclusão', async () => {
    let calls = 0;
    const provider = new OpenAIResponsesProvider(providerConfig, async () => {
      calls++;
      if (calls === 1) return response([{ type: 'function_call', name: 'explorar_tabelas', call_id: 'c1', arguments: '{}' }]);
      return new Response('erro temporário', { status: 503 });
    });
    const result = await provider.run({
      instructions: 'Use o banco.', input: [{ role: 'user', content: 'Verifique as tabelas.' }],
      maxSteps: 1,
      tools: [{ name: 'explorar_tabelas', description: 'Explorar', parameters: { type: 'object' } }],
      execute: async () => ({ nome: 'acesso' })
    });
    expect(calls).toBe(2);
    expect(result.partial).toBe(true);
    expect(result.steps).toBe(1);
    expect(result.text).toContain('Resultado parcial:');
    expect(result.text).toContain('explorar_tabelas');
    expect(result.text).toContain('não foi confirmada');
  });

  it('não cobra síntese adicional quando a resposta já está pronta', async () => {
    let calls = 0;
    const provider = new OpenAIResponsesProvider(providerConfig, async () => {
      calls++;
      return response([{ type: 'message', content: [{ type: 'output_text', text: 'Consulta concluída com dados autorizados.' }] }]);
    });
    const result = await provider.run({
      instructions: 'Responda.', input: [{ role: 'user', content: 'Pergunta.' }],
      tools: [], execute: async () => null, maxSteps: 3
    });
    expect(calls).toBe(1);
    expect(result.partial).toBeUndefined();
    expect(result.text).toContain('Consulta concluída');
  });
});
