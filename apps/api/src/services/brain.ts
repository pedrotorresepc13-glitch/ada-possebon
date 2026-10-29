import { z } from 'zod';
import type { AuthContext } from '@ada/contracts';
import type { AdaConfig } from '../config.ts';

export class BrainUnavailableError extends Error {}

const Item = z.object({
  id: z.union([z.string(), z.number()]),
  unit_id: z.union([z.number(), z.string(), z.null()]),
  namespace: z.enum(['rule', 'model', 'schema', 'permission']),
  title: z.string(),
  content: z.string(),
  authority: z.coerce.number().min(0).max(100),
  source_type: z.string(),
  source_ref: z.string().nullable().optional(),
  source_updated_at: z.string().nullable().optional()
});

export interface BrainHit {
  id: string;
  unitId: number | null;
  namespace: 'rule' | 'model' | 'schema' | 'permission';
  title: string;
  excerpt: string;
  authority: number;
  sourceType: string;
  sourceRef: string | null;
  observedAt: string | null;
}

/** Consulta read-only ao Brain vivo, SEM compartilhar credenciais do Mail Import. */
export class PossebonBrainClient {
  constructor(
    private readonly cfg: AdaConfig['brain'],
    private readonly serviceToken: AdaConfig['possebon']['serviceToken'],
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get configured(): boolean {
    return Boolean(this.cfg.contextUrl && this.serviceToken);
  }

  async search(ctx: AuthContext, question: string, limit = 8): Promise<BrainHit[]> {
    // Defense in depth: o POSSEBON também verifica o programa e a unidade.
    const admin = Boolean(ctx.programs.AdaAdministracao);
    const technical = Boolean(ctx.programs.AdaConhecimentoTecnico);
    if (!admin && !technical) return [];
    if (!this.configured) return [];
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) return [];
    const normalized = question.trim().slice(0, 300);
    if (!normalized) return [];

    const url = new URL(this.cfg.contextUrl!);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
      throw new BrainUnavailableError('Endpoint Brain deve usar HTTPS');
    }
    const namespaces = admin ? ['rule', 'model', 'schema', 'permission'] : ['rule', 'model', 'schema'];
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          system_user_id: ctx.systemUserId,
          unit_id: ctx.activeUnitId,
          question: normalized,
          limit: Math.min(8, Math.max(1, limit)),
          namespaces
        }),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new BrainUnavailableError('POSSEBON Brain indisponível');
    }
    if (!response.ok) throw new BrainUnavailableError(`POSSEBON Brain respondeu HTTP ${response.status}`);
    let parsed: unknown;
    try { parsed = await response.json(); } catch { throw new BrainUnavailableError('Resposta inválida do Brain'); }
    const envelope = z.object({
      status: z.literal('success'),
      data: z.object({
        unit_id: z.coerce.number().int().positive(),
        items: z.array(Item).max(8)
      })
    }).safeParse(parsed);
    if (!envelope.success || envelope.data.data.unit_id !== ctx.activeUnitId) {
      throw new BrainUnavailableError('Resposta do Brain incompatível com a unidade ativa');
    }
    let used = 0;
    const hits: BrainHit[] = [];
    for (const raw of envelope.data.data.items) {
      const unitId = raw.unit_id === null ? null : Number(raw.unit_id);
      if (unitId !== null && unitId !== ctx.activeUnitId) {
        throw new BrainUnavailableError('Brain retornou conteúdo de outra unidade');
      }
      if (!namespaces.includes(raw.namespace)) throw new BrainUnavailableError('Brain retornou namespace não autorizado');
      if (used >= 8000) break;
      const excerpt = raw.content.slice(0, Math.min(1200, 8000 - used));
      used += excerpt.length;
      hits.push({
        id: String(raw.id),
        unitId,
        namespace: raw.namespace,
        title: raw.title.slice(0, 240),
        excerpt,
        authority: raw.authority,
        sourceType: raw.source_type.slice(0, 100),
        sourceRef: raw.source_ref?.slice(0, 240) ?? null,
        observedAt: raw.source_updated_at ?? null
      });
    }
    return hits;
  }
}
