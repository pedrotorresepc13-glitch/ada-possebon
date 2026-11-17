import { z } from 'zod';
import type { AuthContext } from '@ada/contracts';
import { assertAdmin } from '@ada/domain';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { invalid } from '../errors.ts';

const Input = z.object({
  name: z.string().trim().min(1).max(60)
    .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .&'’()_-]*$/u)
}).strict();
const DEFAULT_NAME = 'POSSO';

/** Identidade visual global, independente de unidade e da configuração do provedor. */
export class BrandingService {
  constructor(private readonly d: Deps) {}

  async read(): Promise<{ name: string }> {
    const r = await this.d.db.query<{ value: unknown }>(
      'SELECT value FROM ada.app_setting WHERE key = $1', ['assistant_branding']
    );
    const parsed = Input.safeParse(r.rows[0]?.value);
    // Identidade oficial não é uma preferência configurável: configurações legadas
    // permanecem preservadas no banco, mas não redefinem a identidade do agente.
    void parsed;
    return { name: DEFAULT_NAME };
  }

  async save(ctx: AuthContext, raw: unknown) {
    assertAdmin(ctx);
    const parsed = Input.safeParse(raw);
    if (!parsed.success || parsed.data.name.toLocaleUpperCase('pt-BR') !== DEFAULT_NAME)
      throw invalid('A identidade oficial do assistente virtual da POSSEBON é POSSO.');
    await this.d.db.tx(async q => {
      await q.query(
        `INSERT INTO ada.app_setting(key,value,updated_by) VALUES ($1,$2::jsonb,$3)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        ['assistant_branding', JSON.stringify({ name: DEFAULT_NAME }), ctx.systemUserId]
      );
      await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId,
        action: 'assistente.nome_atualizado', targetType: 'app_setting',
        targetId: 'assistant_branding', outcome: 'ok', details: { name: DEFAULT_NAME } });
    });
    return { name: DEFAULT_NAME };
  }
}
