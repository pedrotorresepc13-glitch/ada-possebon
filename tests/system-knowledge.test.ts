import {expect,it,vi} from 'vitest';
import {setup,type Harness} from './helpers.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import {syncArchitectureGraph} from '../apps/api/src/services/corporate-brain.ts';
import type {AuthContext} from '@ada/contracts';
async function system(h:Harness){
 await h.d.db.exec(Array.from({length:65},(_,i)=>`CREATE TABLE public.a_base_${i}(id integer,unit_id integer);`).join('\n')+`
  CREATE TABLE public.rdo(id integer,unit_id integer,status text);
  CREATE TABLE public.audcomp(id integer,unit_id integer,criterio text);
  CREATE TABLE public.ronda_gerencial(id integer,unit_id integer,prazo date);
  CREATE TABLE public.procurement(id integer,unit_id integer,tipo text);
  CREATE TABLE public.controle_novo(id integer,unit_id integer,situacao text);
  CREATE TABLE public.system_users(id integer,senha text);
  INSERT INTO controle_novo VALUES(1,1,'Pendente'),(2,2,'Outro');`);
 h.d.operational=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,p:unknown[]=[])=>h.d.db.query<T>(sql,p)}),c=>h.d.operationalAccess.policy(c),c=>h.d.businessDictionary.read(c),(c,t,s)=>h.d.systemKnowledge.recordRead(c,t,s));
 await syncArchitectureGraph(h.d.db,{snapshot:'2026-11-01T12:00:00Z',models:[{model:'ControleNovo',table:'controle_novo',fields:['id','unit_id','situacao'],source:'models/ControleNovo.php'}],screens_by_area:{'Módulo customizado':['ControleNovoList','ControleNovoForm'],'SMS':['AudcompList','RondaGerencialList']},custom_php_modules:['ModuloCustomizado.php']});
 const original=await h.d.sessions.resolveContext(9001,1,'system-test');return {...original,identitySource:'possebon' as const};
}
it('inventaria todo esquema e referências com paginação, incluindo módulo não cadastrado e sem inventar regras',async()=>{
 const h=await setup();try{
  const ctx=await system(h);const c=await h.d.systemKnowledge.catalog(ctx);
  expect(c.totalTables).toBe(70);expect(c.hasMore).toBe(true);expect(c.tables).toHaveLength(40);
  expect((await h.d.systemKnowledge.catalog(ctx,'',1)).tables.map(t=>t.name)).toContain('controle_novo');
  expect(c.referenceCounts).toMatchObject({models:1,screens:4,modules:1});
  expect(JSON.stringify(c)).not.toContain('system_users');
  const custom=await h.d.systemKnowledge.module(ctx,'controle_novo');
  expect(custom.liveMetadataAvailable).toBe(true);expect(custom.coverage.allRulesValidated).toBe(false);
  expect(custom.structure?.colunas.map(c=>c.nome)).toContain('situacao');
  expect(custom.references.some(r=>r.label==='ControleNovoList')).toBe(true);
  const audcomp=await h.d.systemKnowledge.module(ctx,'audcomp');
  expect(audcomp.guide.checks.join(' ')).toContain('Não deduzir expansão');
  expect((await h.d.systemKnowledge.module(ctx,'ronda_gerencial')).guide.checks.join(' ')).toContain('evidência de encerramento');
  expect((await h.d.systemKnowledge.context(ctx,'veja a SC do notebook'))).toContain('procurement');
  const user:AuthContext={...ctx,roles:['user'],programs:{Compras:[]}};
  vi.spyOn(h.d.operationalAccess,'read').mockResolvedValue({rules:[{table:'procurement',program:'Compras',columns:['id','unit_id','tipo'],scope:'unit'}]});
  expect((await h.d.systemKnowledge.catalog(user)).tables.map(t=>t.name)).toEqual(['procurement']);
  expect((await h.d.systemKnowledge.catalog(user)).referenceCounts.screens).toBe(0);
 }finally{await h.close();}
});
it('só registra leitura após consulta real, revalida permissões e não expõe registros no inventário',async()=>{
 const h=await setup();try{
  const ctx=await system(h);
  expect((await h.d.systemKnowledge.catalog(ctx,'controle novo')).tables[0]!.lastRead).toBe(null);
  await expect(h.d.operational.query(ctx,{from:'controle_novo',select:[{field:'controle_novo.inventado'}]})).rejects.toThrow();
  expect((await h.d.systemKnowledge.catalog(ctx,'controle novo')).tables[0]!.lastRead).toBe(null);
  expect((await h.d.operational.query(ctx,{from:'controle_novo',select:[{field:'controle_novo.id',as:'registro'}]})).rows).toEqual([{registro:1}]);
  const read=await h.d.systemKnowledge.catalog(ctx,'controle novo');expect(read.tables[0]!.lastRead).toMatchObject({scope:'unit'});
  expect(JSON.stringify(read)).not.toContain('Pendente');
  expect((await h.d.systemKnowledge.catalog({...ctx,permissionsVersion:'nova'},'controle novo')).tables[0]!.lastRead).toBe(null);
  vi.spyOn(h.d.operational,'processMap').mockRejectedValue(new Error('Fonte fora do ar'));
  const unavailable=await h.d.systemKnowledge.catalog(ctx);
  expect(unavailable.sourceState).toBe('unavailable');expect(unavailable.totalTables).toBe(0);expect(unavailable.referenceCounts.screens).toBe(4);
 }finally{await h.close();}
});
it('uma pergunta de módulo novo recebe contexto automaticamente e ferramentas funcionam pelo chat e API',async()=>{
 let prompt='';let calls=0;let found:unknown;
 const h=await setup({ai:{name:'test',model:'test',configured:true,async run(a){calls++;prompt=a.instructions;found=await a.execute('conhecer_sistema',{tabela:'controle_novo'});return {text:'Estrutura localizada; consultarei o registro solicitado.',usage:{input:50,output:10},toolCalls:[],steps:1};}}});try{
  const ctx=await system(h);const admin=await h.login('admin.demo');
  vi.spyOn(h.d.sessions,'resolveContext').mockResolvedValue(ctx);
  const result=await admin.post('/chat',{message:'Quero ver o controle novo.'});expect(result.status).toBe(200);expect(calls).toBe(1);
  expect(prompt).toContain('MAPA OPERACIONAL VERIFICADO');expect(prompt).toContain('controle_novo');
  expect(found).toMatchObject({table:'controle_novo',liveMetadataAvailable:true});
  const catalog=await admin.get('/system-knowledge?q=audcomp');expect(catalog.status).toBe(200);expect(catalog.json.tables[0].name).toBe('audcomp');
  expect((await admin.get('/system-knowledge/module?table=rdo')).json.guide.checks.join(' ')).toContain('Contagem de diários não é avanço físico');
 }finally{await h.close();}
});
