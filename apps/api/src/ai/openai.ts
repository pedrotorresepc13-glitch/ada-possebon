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
    const maxSteps = args.maxSteps ?? (args.toolBudgetMs ? Infinity : 6);
    const deadline = args.toolBudgetMs ? Date.now() + args.toolBudgetMs : Infinity;
    const results = new Map<string, string>();
    let step = 0;
    let repeated = 0;
    for (; step < maxSteps && Date.now() < deadline && repeated < 2;) {
      step++;
      args.signal?.throwIfAborted();
      const windowSignal = args.toolBudgetMs ? AbortSignal.timeout(Math.max(1, deadline-Date.now())) : undefined;
      const signal = args.signal && windowSignal ? AbortSignal.any([args.signal,windowSignal]) : args.signal ?? windowSignal;
      const r = await this.call(
        {
          model: this.cfg.model,
          instructions: args.instructions,
          input,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          max_output_tokens: Math.min(this.cfg.maxOutputTokens,args.maxOutputTokens??this.cfg.maxOutputTokens),
          store: false,
          include: ['reasoning.encrypted_content']
        },
        signal
      ).catch(error => {
        if (windowSignal?.aborted && !args.signal?.aborted) return null;
        throw error;
      });
      if (!r) break;
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
      let fresh = false;
      for (const c of calls) {
        let result: unknown;
        let ok = true;
        try {
          if (!tools.some(tool => tool.name === c.name)) throw new Error('Ferramenta indisponível nesta investigação.');
          const parsed = c.arguments ? JSON.parse(c.arguments) : {};
          const key = JSON.stringify([c.name, parsed]);
          const cached = results.get(key);
          if (cached !== undefined) {
            input.push({ type: 'function_call_output', call_id: c.call_id, output: cached });
            continue;
          }
          fresh = true;
          result = await args.execute(c.name ?? '', parsed);
          results.set(key, JSON.stringify(result ?? null).slice(0, 60_000));
        } catch (err) {
          ok = false;
          result = { erro: (err as Error).message };
        }
        toolCalls.push({ name: c.name ?? '', ok });
        input.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result ?? null).slice(0, 60_000) });
      }
      repeated = fresh ? 0 : repeated + 1;
    }
    if (!args.toolBudgetMs) return { text: '', usage, toolCalls, steps: step };
    const final = await this.call({
      model: this.cfg.model,
      instructions: args.instructions + '\nFinalize com o que foi confirmado pelas ferramentas. Diferencie resultados, ações realizadas e o ponto exato que ainda precisa de validação. Não invente conclusões.',
      input,
      tools: [],
      max_output_tokens: Math.min(this.cfg.maxOutputTokens,args.maxOutputTokens??this.cfg.maxOutputTokens),
      store: false
    }, args.signal ? AbortSignal.any([args.signal,AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)).catch(error => {
      if (args.signal?.aborted) throw error;
      return null;
    });
    if (!final) return {
      text: 'A investigação ficou incompleta. Posso retomar as verificações.',
      usage, toolCalls, steps: step, partial: true
    };
    usage.input += final.usage?.input_tokens ?? 0;
    usage.output += final.usage?.output_tokens ?? 0;
    const text = final.output.filter(item => item.type === 'message')
      .flatMap(item => item.content ?? []).filter(item => item.type === 'output_text')
      .map(item => item.text ?? '').join('\n').trim();
    return { text, usage, toolCalls, steps: step + 1, partial: true };
  }
}
