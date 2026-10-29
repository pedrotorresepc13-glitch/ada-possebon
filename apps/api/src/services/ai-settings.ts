import type { AuthContext } from '@ada/contracts';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { DisabledProvider } from '../ai/provider.ts';
import { OpenAIResponsesProvider } from '../ai/openai.ts';
import { selectAiProvider } from '../core.ts';
import { audit } from '../audit.ts';
import { invalid } from '../errors.ts';

const Input = z.object({
  provider: z.literal('openai'),
  model: z.string().trim().min(2).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  apiKey: z.string().trim().min(20).max(400).optional(),
  timeoutMs: z.number().int().min(5000).max(120000),
  maxOutputTokens: z.number().int().min(64).max(16000)
}).strict();

interface Row {
  model: string;
  api_key_enc: string | null;
  timeout_ms: number;
  max_output_tokens: number;
  updated_by: number;
  updated_at: Date;
}

/** Cofre de configuração: cifragem AES-256-GCM, apenas o servidor decifra. */
export class AiSettingsService {
  constructor(private readonly d: Deps, private readonly externalProvider = false) {}

  private async row(): Promise<Row | null> {
    const result = await this.d.db.query<Row>(
      'SELECT model, api_key_enc, timeout_ms, max_output_tokens, updated_by, updated_at FROM ada.ai_provider_settings WHERE id = 1'
    );
    return result.rows[0] ?? null;
  }

  /** Sincroniza também mudanças feitas por outra instância da ADA. Nunca substitui mocks em testes. */
  async reload(): Promise<void> {
    if (this.externalProvider) return;
    const row = await this.row();
    if (!row) {
      this.d.ai = selectAiProvider(this.d.config);
      return;
    }
    const key = row.api_key_enc ? this.d.cipher.decrypt(row.api_key_enc) : this.d.config.ai.apiKey;
    this.d.ai = key
      ? new OpenAIResponsesProvider({
        apiKey: key, model: row.model, baseUrl: this.d.config.ai.baseUrl,
        timeoutMs: row.timeout_ms, maxOutputTokens: row.max_output_tokens
      })
      : new DisabledProvider();
  }

  async read() {
    await this.reload();
    const row = await this.row();
    const c = this.d.config.ai;
    return {
      provider: 'openai',
      configured: this.d.ai.configured,
      model: row?.model ?? c.model ?? 'gpt-5-mini',
      apiKeyPresent: Boolean(row?.api_key_enc || c.apiKey),
      keySource: row?.api_key_enc ? 'cofre' : c.apiKey ? 'ambiente' : 'ausente',
      timeoutMs: row?.timeout_ms ?? c.timeoutMs,
      maxOutputTokens: row?.max_output_tokens ?? c.maxOutputTokens,
      dailyRequestsPerUser: c.dailyRequestsPerUser,
      chatPerMinute: c.chatPerMinute,
      endpoint: new URL(c.baseUrl).host,
      lastUpdatedAt: row?.updated_at ?? null,
      lastUpdatedBy: row?.updated_by ?? null,
      note: 'A chave é cifrada no banco e nunca retornada pela API. O botão Testar realiza uma chamada real ao provedor, sujeita a cobrança.'
    };
  }

  async save(ctx: AuthContext, input: unknown) {
    const p = Input.safeParse(input);
    if (!p.success) throw invalid('Configuração de IA inválida.', p.error.issues);
    const existing = await this.row();
    const value = p.data;
    const encrypted = value.apiKey
      ? this.d.cipher.encrypt(value.apiKey)
      : existing?.api_key_enc ?? null;
    if (!encrypted && !this.d.config.ai.apiKey) throw invalid('Informe a chave de API para habilitar a IA.');

    await this.d.db.query(
      `INSERT INTO ada.ai_provider_settings (id, model, api_key_enc, timeout_ms, max_output_tokens, updated_by)
       VALUES (1,$1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, api_key_enc = EXCLUDED.api_key_enc,
         timeout_ms = EXCLUDED.timeout_ms, max_output_tokens = EXCLUDED.max_output_tokens,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [value.model, encrypted, value.timeoutMs, value.maxOutputTokens, ctx.systemUserId]
    );
    await this.reload();
    await audit(this.d.db, {
      actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'ia.configuracao_atualizada',
      targetType: 'ai_provider_settings', targetId: 'openai', outcome: 'ok',
      details: { model: value.model, keyReplaced: Boolean(value.apiKey) }
    });
    return this.read();
  }

  async clear(ctx: AuthContext) {
    await this.d.db.query('DELETE FROM ada.ai_provider_settings WHERE id = 1');
    await this.reload();
    await audit(this.d.db, {
      actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'ia.configuracao_removida',
      targetType: 'ai_provider_settings', targetId: 'openai', outcome: 'ok'
    });
    return this.read();
  }

  async test(ctx: AuthContext) {
    await this.reload();
    if (!this.d.ai.configured) throw invalid('Cadastre uma chave e um modelo antes de testar.');
    let ok = false;
    let message: string;
    try {
      const result = await this.d.ai.run({
        instructions: 'Responda apenas com a palavra OK.',
        input: [{ role: 'user', content: 'Teste de conectividade.' }],
        tools: [],
        execute: async () => null,
        maxSteps: 1
      });
      ok = Boolean(result.text.trim());
      message = ok ? 'Conexão com o modelo validada.' : 'O provedor respondeu sem texto; verifique o modelo.';
    } catch (e) {
      // Não devolver corpo da resposta, credenciais ou dados confidenciais para o cliente.
      const code = /HTTP\s+(\d{3})/.exec((e as Error).message)?.[1];
      message = code ? `O provedor recusou o teste (HTTP ${code}). Confira chave, modelo e faturamento.`
        : 'Não foi possível validar o modelo. Verifique o endpoint e os limites da conta.';
    }
    await audit(this.d.db, {
      actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'ia.conexao_testada',
      targetType: 'ai_provider_settings', targetId: 'openai', outcome: ok ? 'ok' : 'erro'
    });
    return { ok, message };
  }
}
