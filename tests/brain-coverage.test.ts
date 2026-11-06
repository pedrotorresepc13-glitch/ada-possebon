import { expect, it } from 'vitest';
import { setup } from './helpers.ts';

it('mede a cobertura documental por unidade e programa sem chamar o modelo', async () => {
  let calls=0;
  const h=await setup({ai:{name:'test',model:'test',configured:true,async run(){calls++;throw new Error('Não utilizar OpenAI para cobertura');}}});
  try {
    const source=await h.d.db.query<{id:string}>(
      "INSERT INTO ada.knowledge_source(kind,name,scope,unit_id,domain,required_programs,created_by) VALUES('manual','Fonte interna','unidade',1,'contratos',ARRAY['AdaAdministracao'],9001) RETURNING id"
    );
    await h.d.db.query(
      "INSERT INTO ada.knowledge_document(source_id,title,mime_type,checksum,status,scope,unit_id,domain,required_programs,created_by) VALUES($1,'Contrato de teste','text/plain','brain-coverage-test-1','indexado','unidade',1,'contratos',ARRAY['AdaAdministracao'],9001)",
      [source.rows[0]!.id]
    );
    const admin=await h.login('admin.demo');
    const r=await admin.get('/brain/coverage');
    expect(r.status).toBe(200);
    expect(r.json.modelCalls).toBe(0);
    expect(r.json.unitId).toBe(1);
    expect(r.json.areas).toHaveLength(12);
    const contracts=r.json.areas.find((a:{id:string})=>a.id==='contratos');
    expect(contracts.indexedDocuments).toBeGreaterThanOrEqual(1);
    const restricted=await h.login('colab.a');
    const other=await restricted.get('/brain/coverage');
    expect(other.status).toBe(200);
    expect(other.json.areas.find((a:{id:string})=>a.id==='contratos').indexedDocuments)
      .toBeLessThan(contracts.indexedDocuments);
    expect(JSON.stringify(other.json)).not.toContain('Contrato de teste');
    expect(calls).toBe(0);
  } finally {
    await h.close();
  }
});

it('worker publica pulso com estatísticas sem cópia de dados e sem tokens', async () => {
  let calls=0;
  const h=await setup({ai:{name:'test',model:'test',configured:true,async run(){calls++;throw new Error('Não utilizar OpenAI para pulso');}}});
  try {
    expect(await h.d.brainCoverage.tick(true)).toBe(true);
    const pulse=await h.d.brainCoverage.lastPulse();
    expect(pulse).toMatchObject({modelCalls:0,indexedDocuments:expect.any(Number),graphNodes:expect.any(Number)});
    const stored=await h.d.db.query<{value:unknown}>("SELECT value FROM ada.app_setting WHERE key='brain:pulse'");
    expect(JSON.stringify(stored.rows)).not.toContain('senha');
    const admin=await h.login('admin.demo');
    expect((await admin.get('/admin/brain-pulse')).status).toBe(200);
    const other=await h.login('colab.a');
    expect((await other.get('/admin/brain-pulse')).status).toBe(403);
    expect(calls).toBe(0);
  } finally {
    await h.close();
  }
});


it('descobre dominios adicionais sem tratar as doze categorias como limite de conhecimento', async () => {
  const h = await setup();
  try {
    const source = await h.d.db.query<{id:string}>(
      "INSERT INTO ada.knowledge_source(kind,name,scope,unit_id,domain,required_programs,created_by) VALUES('manual','Fonte de logística','unidade',1,'logistica_maritima',ARRAY['AdaAdministracao'],9001) RETURNING id"
    );
    await h.d.db.query(
      "INSERT INTO ada.knowledge_document(source_id,title,mime_type,checksum,status,scope,unit_id,domain,required_programs,created_by) VALUES($1,'Plano de logística marítima','text/plain','brain-logistica-v1','indexado','unidade',1,'logistica_maritima',ARRAY['AdaAdministracao'],9001)",
      [source.rows[0]!.id]
    );
    const admin = await h.login('admin.demo');
    const response = await admin.get('/brain/coverage');
    expect(response.status).toBe(200);
    expect(response.json.discoveredDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'logistica_maritima',indexedDocuments:1})
    ]));
    expect(response.json.modelCalls).toBe(0);
    const restricted = await h.login('colab.a');
    const other = await restricted.get('/brain/coverage');
    expect(JSON.stringify(other.json.discoveredDomains)).not.toContain('logistica_maritima');
  } finally {
    await h.close();
  }
});
