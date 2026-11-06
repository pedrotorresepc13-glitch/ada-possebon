import { describe, expect, it, vi } from 'vitest';
import { buildAuthContext, DEMO_USERS } from '../apps/api/src/identity.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { BrainUnavailableError, PossebonBrainClient } from '../apps/api/src/services/brain.ts';

const cfg = loadConfig({ ADA_ENV: 'test' });
const admin = buildAuthContext(DEMO_USERS[0]!, 1, 's', cfg.programs, 'dev_synthetic');
const manager = buildAuthContext(DEMO_USERS[1]!, 1, 's', cfg.programs, 'dev_synthetic');
const tech = { ...manager, programs: { ...manager.programs, AdaConhecimentoTecnico: [] } };

function makeClient(response: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } })
  );
  const client = new PossebonBrainClient(
    { contextUrl: 'https://app.possebon.com.br/api/ada/v1/brain/context' },
    'test-token-exclusive-ada',
    fetchMock as typeof fetch
  );
  return { client, fetchMock };
}

const envelope = (unit: number, namespace = 'schema', itemUnit: number | null = unit) => ({
  status: 'success',
  data: {
    unit_id: unit,
    items: [{
      id: 17, unit_id: itemUnit, namespace, title: 'Modelagem real',
      content: 'A tabela possui chave por unidade.',
      authority: 90, source_type: 'LIVE_SOURCE_SCHEMA',
      source_ref: 'app/model/Exemplo.php', source_updated_at: '2026-10-28T20:00:00-03:00'
    }]
  }
});

describe('ADA ↔ Brain POSSEBON: identidade, unidade e leitura', () => {
  it('desativado sem URL ou token não chama o servidor', async () => {
    const mock = vi.fn();
    const client = new PossebonBrainClient({ contextUrl: undefined }, 'token', mock as typeof fetch);
    expect(client.configured).toBe(false);
    expect(await client.search(admin, 'esquema')).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('sem programa técnico não pode sequer consultar o backend', async () => {
    const { client, fetchMock } = makeClient(envelope(1));
    expect(await client.search(manager, 'esquema')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia apenas usuário e unidade da sessão autoritativa; token vai no cabeçalho', async () => {
    const { client, fetchMock } = makeClient(envelope(1));
    const result = await client.search(tech, 'estrutura de tabelas');
    expect(result).toHaveLength(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toMatch(/^https:\/\//);
    const payload = JSON.parse(opts.body as string);
    expect(payload).toMatchObject({ system_user_id: 9002, unit_id: 1, limit: 8, namespaces: ['rule', 'model', 'schema'] });
    expect(payload).not.toHaveProperty('admin');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token-exclusive-ada');
  });

  it('administrador pode consultar o namespace permission', async () => {
    const { client, fetchMock } = makeClient(envelope(1, 'permission'));
    expect((await client.search(admin, 'programas')).length).toBe(1);
    const [, opts] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(opts.body as string).namespaces).toContain('permission');
  });

  it('rejeita resultados de outra unidade sem devolver conteúdo', async () => {
    const { client } = makeClient(envelope(1, 'rule', 2));
    await expect(client.search(tech, 'regras')).rejects.toBeInstanceOf(BrainUnavailableError);
  });

  it('rejeita envelope de outra unidade', async () => {
    const { client } = makeClient(envelope(2));
    await expect(client.search(tech, 'regras')).rejects.toBeInstanceOf(BrainUnavailableError);
  });

  it('rejeita namespace restrito não solicitado pelo usuário técnico', async () => {
    const { client } = makeClient(envelope(1, 'permission'));
    await expect(client.search(tech, 'regras')).rejects.toBeInstanceOf(BrainUnavailableError);
  });

  it('limita conteúdo e nunca consulta endereço HTTP externo', async () => {
    const veryLong = envelope(1);
    veryLong.data.items[0]!.content = 'x'.repeat(50_000);
    const { client } = makeClient(veryLong);
    const [hit] = await client.search(tech, 'regras');
    expect(hit!.excerpt.length).toBe(1200);
    const bad = new PossebonBrainClient({ contextUrl: 'http://example.com/brain' }, 'token');
    await expect(bad.search(tech, 'regras')).rejects.toBeInstanceOf(BrainUnavailableError);
  });

  it('resposta HTTP 403 causa indisponibilidade, não elevação de permissão', async () => {
    const { client } = makeClient({ error: 'Acesso negado' }, 403);
    await expect(client.search(tech, 'regras')).rejects.toBeInstanceOf(BrainUnavailableError);
  });
});
