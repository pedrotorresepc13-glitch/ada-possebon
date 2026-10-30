import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers.ts';
import { buildAuthContext } from '../apps/api/src/identity.ts';
import { searchCorporateGraph, syncArchitectureGraph, syncContractGraph } from '../apps/api/src/services/corporate-brain.ts';

describe('cérebro corporativo — grafo persistente, fontes e isolamento', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup({ env: { ADA_DEMO_DATA: '0' } });
    h.identity.update(9001, { units: [{ id: 3, name: 'EPC13' }] });
    h.identity.update(9004, { units: [{ id: 3, name: 'EPC13' }] });
  });
  afterAll(async () => h.close());

  it('indexa modelos, campos, telas e módulos com relações verificáveis e sem duplicação', async () => {
    const data = {
      snapshot: '2026-10-28T21:31:06-03:00',
      models: [{ model: 'Colaborador', table: 'colaborador',
        fields: ['pessoa_id', 'equipe_id', 'unit_id'], source: 'app/model/Colaborador.php' }],
      screens_by_area: { admin: ['ColaboradorList'] },
      custom_php_modules: ['app/custom/PossebonBrainService.php']
    };
    const first = await syncArchitectureGraph(h.d.db, data);
    expect(first.nodes).toBeGreaterThan(5);
    expect(first.relations).toBeGreaterThan(3);
    const adminId = (await h.identity.resolve(9001))!;
    const admin = buildAuthContext(adminId,3,'graph-test',h.d.config.programs,'dev_synthetic');
    const hits = await searchCorporateGraph(h.d.db,admin,'colaborador');
    expect(hits.some((h) => h.kind === 'modelo' && h.relationships.some((r) => r.relation === 'representa' && r.target === 'colaborador'))).toBe(true);
    const count = await h.d.db.query<{n:number}>('SELECT count(*)::int AS n FROM ada.brain_node');
    await syncArchitectureGraph(h.d.db,data);
    const repeated = await h.d.db.query<{n:number}>('SELECT count(*)::int AS n FROM ada.brain_node');
    expect(repeated.rows[0]!.n).toBe(count.rows[0]!.n);
    const denied = buildAuthContext((await h.identity.resolve(9004))!,3,'graph-test',h.d.config.programs,'dev_synthetic');
    expect(await searchCorporateGraph(h.d.db,denied,'colaborador')).toEqual([]);
  });

  it('conecta documento contratual com partes sem expor dados à unidade ou perfil indevidos', async () => {
    const src = await h.d.db.query<{id:string}>(
      "INSERT INTO ada.knowledge_source(kind,name,scope,unit_id,sensitivity,required_programs,created_by) VALUES ('manual','EPC13','unidade',3,'restrito',ARRAY['AdaAdministracao']::text[],9001) RETURNING id"
    );
    const sid = src.rows[0]!.id;
    const d = await h.d.db.query<{id:string}>(
      "INSERT INTO ada.knowledge_document(source_id,title,mime_type,original_name,checksum,status,scope,unit_id,sensitivity,required_programs,created_by) VALUES ($1,'Contrato EPC13 - páginas 2-4','text/plain','ContratoEPC13.pdf','checksum-grafo','indexado','unidade',3,'restrito',ARRAY['AdaAdministracao']::text[],9001) RETURNING id",
      [sid]
    );
    expect(d.rows[0]?.id).toBeTruthy();
    const stats = await syncContractGraph(h.d.db,sid);
    expect(stats.relations).toBe(1);
    const admin = buildAuthContext((await h.identity.resolve(9001))!,3,'graph-test',h.d.config.programs,'dev_synthetic');
    const hits = await searchCorporateGraph(h.d.db,admin,'ContratoEPC13.pdf');
    expect(hits.some((n)=>n.kind==='documento' && n.relationships.some((r)=>r.relation==='contem_parte'))).toBe(true);
    const nonAdmin = buildAuthContext((await h.identity.resolve(9004))!,3,'graph-test',h.d.config.programs,'dev_synthetic');
    expect(await searchCorporateGraph(h.d.db,nonAdmin,'ContratoEPC13.pdf')).toEqual([]);
    const otherUnit = { ...admin, activeUnitId: 2 };
    expect(await searchCorporateGraph(h.d.db,otherUnit,'ContratoEPC13.pdf')).toEqual([]);
  });
});
