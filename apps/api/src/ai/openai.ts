import { redactSecrets } from '@ada/domain';
import type { AiProvider, AiRunResult, AiTurnInput } from './provider.ts';

type FetchLike = typeof fetch;

interface ResponseItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string }[];
  [k: string]: unknown;
}

/**
 * Provedor OpenAI usando a Responses API (function calling).
 * - Chave apenas no servidor (variável de ambiente/cofre).
 * - store:false — o provedor não precisa reter o estado da conversa.
 * - Modelo configurável (ADA_OPENAI_MODEL); sem modelo, o provedor não é habilitado.
 */
export class OpenAIResponsesProvider implements AiProvider {
  readonly name = 'openai';
  readonly configured = true;

  constructor(
    private readonly cfg: { apiKey: string; model: string; baseUrl: string; timeoutMs: number; maxOutputTokens: number },
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  get model() {
    return this.cfg.model;
  }

  private async call(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ output: ResponseItem[]; usage?: { input_tokens?: number; output_tokens?: number } }> {
    const url = new URL('responses', this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : this.cfg.baseUrl + '/');
    if (url.protocol !== 'https:') throw new Error('O endpoint do provedor de IA deve usar HTTPS');
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!res.ok) {
      const txt = redactSecrets((await res.text().catch(() => '')).slice(0, 300));
      throw new Error(`Provedor de IA respondeu HTTP ${res.status}${txt ? ': ' + txt : ''}`);
    }
    return (await res.json()) as { output: ResponseItem[]; usage?: { input_tokens?: number; output_tokens?: number } };
  }

  async run(args: AiTurnInput): Promise<AiRunResult> {
    const input: unknown[] = args.input.map((m) => ({ role: m.role, content: m.content }));
    const tools = args.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    const usage = { input: 0, output: 0 };
    const toolCalls: { name: string; ok: boolean }[] = [];
    const maxSteps = args.maxSteps ?? 6;
    for (let step = 1; step <= maxSteps; step++) {
      const r = await this.call(
        {
          model: this.cfg.model,
          instructions: args.instructions,
          input,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          max_output_tokens: this.cfg.maxOutputTokens,
          store: false,
          include: ['reasoning.encrypted_content']
        },
        args.signal
      );
      usage.input += r.usage?.input_tokens ?? 0;
      usage.output += r.usage?.output_tokens ?? 0;
      const calls = r.output.filter((o) => o.type === 'function_call');
      if (calls.length === 0) {
        const text = r.output
          .filter((o) => o.type === 'message')
          .flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text ?? '')
          .join('\n')
          .trim();
        return { text, usage, toolCalls, steps: step };
      }
      input.push(...r.output);
      for (const c of calls) {
        let result: unknown;
        let ok = true;
        try {
          const parsed = c.arguments ? JSON.parse(c.arguments) : {};
          result = await args.execute(c.name ?? '', parsed);
        } catch (err) {
          ok = false;
          result = { erro: (err as Error).message };
        }
        toolCalls.push({ name: c.name ?? '', ok });
        input.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result).slice(0, 60_000) });
      }
    }
    return { text: 'Interrompi a análise porque ela excedeu o limite de etapas permitido. Tente um pedido mais específico.', usage, toolCalls, steps: maxSteps };
  }
}
