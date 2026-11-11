import { describe, expect, it, vi } from 'vitest';
import { MyImportCatalogService } from '../apps/api/src/services/myimport-catalog.ts';

const endpoint = 'http://127.0.0.1:4808/api/internal/posso/integration-catalog';
const token = 'local-internal-token-32-characters-long-only';
const catalog = (unitId: number, modelUnitId = unitId) => ({
  schemaVersion: 1,
  unitId,
  generatedAt: '2026-11-11T15:00:00Z',
  count: 1,
  models: [{
    id: 'model-carol', unitId: modelUnitId, name: 'Carol',
    systemModel: false, enabled: true, state: 'ACTIVE',
    sourceKind: 'SCHEDULED_API', processHandler: 'CAROL_PONTO',
    version: 7, mappingCount: 3, updatedAt: '2026-11-11T15:00:00Z'
  }]
});

function make(response: unknown, status = 200) {
  const send = vi.fn(async () =>
    new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } }));
  return { send, client: new MyImportCatalogService({ catalogUrl: endpoint, token }, send as typeof fetch) };
}

describe('POSSO ↔ My Import local catalog', () => {
  it('does not contact the worker when configuration is absent', async () => {
    const send = vi.fn();
    const client = new MyImportCatalogService({}, send as typeof fetch);
    await expect(client.list(3)).rejects.toThrow('não configurado');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses external destinations even when token is configured', async () => {
    const send = vi.fn();
    const client = new MyImportCatalogService({
      catalogUrl: 'https://example.com/api/internal/posso/integration-catalog',
      token
    }, send as typeof fetch);
    await expect(client.list(3)).rejects.toThrow('127.0.0.1');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a technical token only to loopback and accepts the correct unit', async () => {
    const { client, send } = make(catalog(3));
    const result = await client.list(3);
    expect(result.models).toHaveLength(1);
    const [url, opts] = send.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe('127.0.0.1');
    expect(opts.redirect).toBe('error');
    expect((opts.headers as Record<string,string>)['X-POSSO-Internal-Token']).toBe(token);
  });

  it('rejects foreign-unit envelopes and records', async () => {
    await expect(make(catalog(4)).client.list(3)).rejects.toThrow('unidade');
    await expect(make(catalog(3, 4)).client.list(3)).rejects.toThrow('unidade');
  });

  it('rejects accidental disclosure of API secrets or complete models', async () => {
    const payload = catalog(3) as unknown as {
      models: Record<string, unknown>[];
    };
    payload.models[0]!.source = { api: { headers: { Authorization: 'secret' } } };
    await expect(make(payload).client.list(3)).rejects.toThrow('contrato');
  });

  it('does not fall back to MAD Builder on worker errors', async () => {
    await expect(make({ error: 'unavailable' }, 503).client.list(3)).rejects.toThrow('recusou');
  });
});
