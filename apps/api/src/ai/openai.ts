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
    const readTools = tools.filter((tool) => args.continuation?.readTools.includes(tool.name));
    const completedReads = new Set<string>();
    let steps = 0;
    for (let step = 1; step <= maxSteps + (args.continuation?.steps ?? 0); step++) {
      const continuing = step > maxSteps;
      const available = continuing ? readTools : tools;
      if (continuing && (!readTools.length || !toolCalls.at(-1)?.ok ||
        !readTools.some((tool) => tool.name === toolCalls.at(-1)?.name))) break;
      args.signal?.throwIfAborted();
      const r = await this.call(
        {
          model: this.cfg.model,
          instructions: args.instructions,
          input,
          tools: available,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          max_output_tokens: Math.min(this.cfg.maxOutputTokens,args.maxOutputTokens??this.cfg.maxOutputTokens),
          store: false,
          include: ['reasoning.encrypted_content']
        },
        args.signal
      );
      steps = step;
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
        args.signal?.throwIfAborted();
        let result: unknown;
        let ok = true;
        try {
          if (!available.some((tool) => tool.name === c.name)) throw new Error('Ferramenta indisponível nesta etapa.');
          const parsed = c.arguments ? JSON.parse(c.arguments) : {};
          const read = readTools.some((tool) => tool.name === c.name);
          const key = JSON.stringify([c.name, parsed], (_name, value: unknown) =>
            value && typeof value === 'object' && !Array.isArray(value)
              ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
          if (continuing && completedReads.has(key)) throw new Error('Consulta já realizada nesta investigação.');
          result = await args.execute(c.name ?? '', parsed);
          if (read) completedReads.add(key);
        } catch (err) {
          ok = false;
          result = { erro: (err as Error).message };
        }
        toolCalls.push({ name: c.name ?? '', ok });
        const output = JSON.stringify(result ?? null);
        input.push({ type: 'function_call_output', call_id: c.call_id, output: output.length > 60_000
          ? JSON.stringify({ truncado: true, amostra: output.slice(0, 30_000) }) : output });
      }
    }
    // Uma investigação que atingiu o limite ainda possui resultados de ferramentas.
    // Em vez de descartá-los, conclui com uma síntese limitada e explícita.
    // Este passo NÃO autoriza novas ferramentas nem aumenta indefinidamente o custo.
    try {
      const final = await this.call(
        {
          model: this.cfg.model,
          instructions: args.instructions +
            '\nA investigação atingiu o limite de etapas. Não solicite mais ferramentas. ' +
            'Responda em português com os resultados confirmados das consultas já realizadas, ' +
            'o que permanece sem comprovação e os próximos passos. ' +
            'Comece por "Resultado parcial:" e não invente números, fontes ou conclusões.',
          input: [...input, { role: 'user', content: 'Consolide os resultados já verificados; informe as pendências.' }],
          tools: [],
          tool_choice: 'none',
          max_output_tokens: Math.min(this.cfg.maxOutputTokens, args.maxOutputTokens ?? this.cfg.maxOutputTokens),
          store: false
        },
        args.signal
      );
      usage.input += final.usage?.input_tokens ?? 0;
      usage.output += final.usage?.output_tokens ?? 0;
      const summary = final.output
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim();
      return {
        text: summary.startsWith('Resultado parcial:') ? summary : 'Resultado parcial: ' + (summary || 'A análise ainda não foi concluída.'),
        usage, toolCalls, steps: steps + 1, partial: true
      };
    } catch (err) {
      if (args.signal?.aborted) throw err;
      // Sem síntese do provedor: informe o progresso sem atribuir resultados fictícios.
      const verified = [...new Set(toolCalls.filter((t) => t.ok).map((t) => t.name))];
      return {
        text: 'Resultado parcial: foram executadas ' + toolCalls.length +
          ' verificações. ' + (verified.length ? 'Ferramentas consultadas: ' + verified.join(', ') + '. ' : '') +
          'A conclusão não foi confirmada. A investigação pode ser aprofundada numa nova solicitação.',
        usage, toolCalls, steps, partial: true
      };
    }
  }
}
