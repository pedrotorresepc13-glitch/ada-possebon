/**
 * Interface de provedor de IA. O backend é o único que fala com o provedor;
 * o modelo só age por ferramentas explicitamente permitidas e validadas no servidor.
 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiTurnInput {
  instructions: string;
  input: { role: 'user' | 'assistant'; content: string }[];
  tools: ToolSpec[];
  execute: (name: string, args: unknown) => Promise<unknown>;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface AiRunResult {
  text: string;
  usage: { input: number; output: number };
  toolCalls: { name: string; ok: boolean }[];
  steps: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly configured: boolean;
  run(args: AiTurnInput): Promise<AiRunResult>;
}

export class AiNotConfiguredError extends Error {}

export class DisabledProvider implements AiProvider {
  readonly name = 'nenhum';
  readonly model = '';
  readonly configured = false;
  async run(): Promise<AiRunResult> {
    throw new AiNotConfiguredError('Nenhum provedor de IA configurado no servidor.');
  }
}
