import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPglite, type Db } from '../apps/api/src/db.ts';
import { ReadonlyMetricAdapter } from '../apps/api/src/services/readonly-postgres.ts';
import { REAL_CATALOG } from '../packages/domain/src/catalog.ts';

describe('métrica real read-only sem IA e com filtro rígido de unidade', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPglite();
    await db.exec(
      `CREATE TABLE public.equipe (id integer PRIMARY KEY, unit_id integer NOT NULL, nome text NOT NULL);
       CREATE TABLE public.colaborador (id integer PRIMARY KEY, unit_id integer NOT NULL,
         equipe_id integer, criado_em timestamptz, deletado_em timestamptz);`
    );
    await db.query("INSERT INTO public.equipe(id,unit_id,nome) VALUES (1,3,'Operações'),(2,4,'Outra unidade')");
    await db.query(
      `INSERT INTO public.colaborador(id,unit_id,equipe_id,criado_em,deletado_em)
       VALUES (1,3,1,'2026-10-01T12:00:00Z',NULL),
              (2,3,1,'2026-10-02T12:00:00Z',NULL),
              (3,4,2,'2026-10-02T12:00:00Z',NULL),
              (4,3,1,'2026-10-02T12:00:00Z','2026-10-03T12:00:00Z')`
    );
  });
  afterAll(async () => db.close());

  it('reconsulta os valores atuais ao mudar o banco, sem modelo de IA', async () => {
    const adapter = new ReadonlyMetricAdapter(db);
    const args = {
      metric: REAL_CATALOG.metrics['possebon.colaborador.cadastros']!,
      groupBy: ['equipe'],
      timeGrain: 'month' as const,
      range: { from: '2026-10-01', to: '2026-10-31' },
      filters: [],
      unitIds: [3]
    };
    const first = await adapter.queryMetric(args);
    expect(first).toEqual([{ dims:['Operações'], v:2 }]);
    await db.query(
      "INSERT INTO public.colaborador(id,unit_id,equipe_id,criado_em,deletado_em) VALUES (5,3,1,'2026-10-20T12:00:00Z',NULL)"
    );
    const second = await adapter.queryMetric(args);
    expect(second).toEqual([{dims:['Operações'],v:3}]);
  });

  it('impede consulta a métricas fora da allowlist SQL de produção', async () => {
    const adapter = new ReadonlyMetricAdapter(db);
    const metric = { ...REAL_CATALOG.metrics['possebon.colaborador.cadastros']!, id: 'qualquer.outra' };
    await expect(adapter.queryMetric({
      metric, groupBy:[], timeGrain:'month',
      range:{from:'2026-10-01',to:'2026-10-31'},filters:[],unitIds:[3]
    })).rejects.toThrow(/lista de consultas reais/);
  });
});
