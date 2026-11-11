import { z } from 'zod';
import type { AdaConfig } from '../config.ts';
import { HttpError } from '../errors.ts';

// Contrato de metadados apenas: nunca recebe JSON integral de modelo,
// cabecalhos de API, credenciais, mapeamentos com valores ou payloads.
export const MyImportCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  unitId: z.number().int().positive(),
  generatedAt: z.string(),
  count: z.number().int().min(0),
  models: z.array(z.object({
    id: z.string().min(1).max(100),
    unitId: z.number().int().positive(),
    name: z.string().max(300),
    systemModel: z.boolean(),
    enabled: z.boolean(),
    state: z.string().max(60),
    sourceKind: z.string().max(60),
    processHandler: z.string().max(100).nullable(),
    version: z.number().int().min(0),
    mappingCount: z.number().int().min(0),
    updatedAt: z.string()
  }).strict()).max(500)
}).strict();

export class MyImportCatalogService {
  constructor(private readonly cfg: AdaConfig['myImport'], private readonly fetcher: typeof fetch = fetch) {}

  async list(unitId: number): Promise<z.infer<typeof MyImportCatalogSchema>> {
    if (!Number.isSafeInteger(unitId) || unitId <= 0) {
      throw new HttpError(403, 'FORBIDDEN', 'Unidade inválida para consultar o My Import.');
    }
    if (!this.cfg.catalogUrl || !this.cfg.token || this.cfg.token.length < 32) {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', 'Canal local POSSO/My Import ainda não configurado.');
    }

    let url: URL;
    try {
      url = new URL(this.cfg.catalogUrl);
    } catch {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', 'URL local do My Import inválida.');
    }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/api/internal/posso/integration-catalog' ||
        url.username || url.password || url.search || url.hash) {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', 'O catálogo exige conexão HTTP direta em 127.0.0.1, sem proxy público.');
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        redirect: 'error',
        headers: { 'X-POSSO-Internal-Token': this.cfg.token, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', 'My Import local indisponível. Os demais recursos do POSSO continuam operacionais.');
    }

    if (!response.ok) {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', 'My Import recusou a consulta do catálogo técnico.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HttpError(502, 'SOURCE_UNAVAILABLE', 'My Import retornou um catálogo inválido.');
    }
    const parsed = MyImportCatalogSchema.safeParse(payload);
    if (!parsed.success || parsed.data.unitId !== unitId ||
        parsed.data.count !== parsed.data.models.length ||
        parsed.data.models.some(model => model.unitId !== unitId)) {
      throw new HttpError(502, 'SOURCE_UNAVAILABLE', 'My Import respondeu com uma unidade ou contrato incompatível.');
    }
    return parsed.data;
  }
}
