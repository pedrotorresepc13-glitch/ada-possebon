import {expect,it,vi} from 'vitest';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseModel,parseScreen,literalItems} from '../scripts/knowledge/extract-system-source.ts';
import {SystemSourcePack,type SourcePack} from '../apps/api/src/services/source-pack-schema.ts';
import {importSystemSource,sourceDefinitions} from '../apps/api/src/services/system-source-import.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import {setup} from './helpers.ts';
import {SystemSourceWatch} from '../apps/api/src/services/system-source-watch.ts';
const source=(path:string)=>({path,sha256:'a'.repeat(64)});
function fixture():SourcePack{return SystemSourcePack.parse({format:'possebon-system-source-v1',classification:'interno-restrito',snapshot:'2026-11-01T12:00:00Z',
 models:[{name:'Pedido',table:'pedido',fields:['id','unit_id','status','tipo'],source:source('app/model/Pedido.php')},{name:'DiarioObra',table:'diario_obra',fields:['id','unit_id','status'],source:source('app/model/DiarioObra.php')}],
 queries:[{name:'ResumoRdo',fields:['quantidade'],candidateTables:['diario_obra'],source:source('app/model/ResumoRdo.php')}],modules:[],
 screens:[{name:'PedidoForm',title:'Cadastro principal de pedido',area:'sms',table:'pedido',fields:['status'],definitions:[{field:'status',code:'G',label:'Grupo correto'}],defaults:[],source:source('app/control/sms/PedidoForm.php')},
 {name:'PedidoReportList',title:'Relatório antigo',area:'compras',table:'pedido',fields:['status'],definitions:[{field:'status',code:'G',label:'Grupo divergente'}],defaults:[],source:source('app/control/compras/PedidoReportList.php')},
 {name:'MeuRdoForm',title:'Meu RDO',area:'obra',table:'diario_obra',fields:['status'],definitions:[{field:'status',code:'V',label:'Validado'}],defaults:[],source:source('app/control/obra/MeuRdoForm.php')}]
});}
it('extrai só literais e liga códigos ao modelo primário, sem comentários, segredos ou expressão PHP',()=>{
 const model=parseModel(`<?php class Pedido extends TRecord { const TABLENAME='pedido'; const PRIMARYKEY='id'; function __construct(){parent::addAttribute('status');parent::addAttribute('token');}}`,'app/model/Pedido.php')!;
 expect(model.fields).toEqual(['id','status']);
 const php=`<?php class PedidoForm extends TPage {private static $activeRecord='Pedido'; function __construct(){
 $status = new TCombo('status');$token = new TCombo('token');
 // $status->addItems(["G"=>"Errado antigo"]);
 $status->addItems(["G"=>"Grupo correto","A"=>"Ativo"]);$token->addItems(["X"=>"Segredo"]);
 $status->setValue('A'); }}`;
 const screen=parseScreen(php,'app/control/compras/PedidoForm.php',[model])!;
 expect(screen.definitions).toEqual([{field:'status',code:'G',label:'Grupo correto'},{field:'status',code:'A',label:'Ativo'}]);
 expect(screen.defaults).toEqual([{field:'status',value:'A'}]);expect(JSON.stringify(screen)).not.toContain('Segredo');
 expect(literalItems('"G"=>"valor".getenv("PASSWORD")')).toBe(null);
 expect(literalItems('"G"=>"$variavel"')).toBe(null);
 expect(sourceDefinitions(fixture())).toMatchObject({conflicts:[{table:'pedido',field:'status',code:'G',resolved:true}]});
 expect(sourceDefinitions(fixture()).selected.find(d=>d.code==='G')!.label).toBe('Grupo correto');
});
it('importa base privada idempotente e códigos comprovados, reconhece RDO pelo formulário e não gasta estudo',async()=>{
 let calls=0;const h=await setup({ai:{name:'test',model:'test',configured:true,async run(){calls++;throw new Error('Não deve chamar modelo');}}});try{
 const original=await h.d.sessions.resolveContext(9001,1,'test');const ctx={...original,identitySource:'possebon' as const};
 const pack=fixture();const result=await importSystemSource(h.d,ctx,pack);
 expect(result.modelCalls).toBe(0);expect(result.documents).toBe(6);expect(result.conflicts).toHaveLength(1);
 expect(await h.d.businessDictionary.resolve(ctx,'pedido','status','G')).toMatchObject({known:true,definition:{label:'Grupo correto',origin:'source_pack'}});
 expect((await importSystemSource(h.d,ctx,{...pack,snapshot:'2026-11-02T12:00:00Z'})).unchanged).toBe(6);
 expect((await h.d.institutionalStudy.status(ctx)).indexed).toBe(0);
 await h.d.db.exec("CREATE TABLE public.pedido(id integer,unit_id integer,status text); CREATE TABLE public.diario_obra(id integer,unit_id integer,status text); INSERT INTO diario_obra VALUES(1,1,'V');");
 h.d.operational=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,p:unknown[]=[])=>h.d.db.query<T>(sql,p)}),async()=>({admin:true,tables:{}}),c=>h.d.businessDictionary.read(c));
 expect((await h.d.systemKnowledge.catalog(ctx,'sms')).tables.map(t=>t.name)).toContain('pedido');
 const catalog=await h.d.systemKnowledge.catalog(ctx,'RDO');expect(catalog.tables.map(t=>t.name)).toContain('diario_obra');
 const context=await h.d.systemKnowledge.context(ctx,'Veja o RDO.');expect(context).toContain('diario_obra');expect(context).toContain('MeuRdoForm');
 expect((await h.d.operational.query(ctx,{from:'diario_obra',select:[{field:'diario_obra.status',as:'situacao'}]})).rows).toEqual([{situacao:'Validado'}]);
 expect(await h.d.businessDictionary.read({...ctx,activeUnitId:2})).toEqual([]);
 const user=await h.d.sessions.resolveContext(9004,1,'user');
 expect((await h.d.businessDictionary.read(user)).find(item=>item.table==='pedido'&&item.code==='G'))
   .toMatchObject({label:'Grupo correto',origin:'source_pack'});
 // Mesmo sem permissões para ler os documentos administrativos, o usuário pode
 // aprender uma descrição literal certificada do POSSEBON Web para o seu campo.
 await h.d.db.query('UPDATE ada.app_setting SET value=$2 WHERE key=$1',
   ['business_dictionary:1',{ciphertext:h.d.cipher.encrypt('[]')}]);
 expect(await h.d.businessDictionary.resolve(user,'pedido','status','G')).toMatchObject({known:false});
 expect(await h.d.businessDictionary.discover(user,'pedido','status','G'))
   .toMatchObject({known:true,definition:{label:'Grupo correto',origin:'source_pack'}});
 expect(await h.d.businessDictionary.resolve(user,'pedido','status','G'))
   .toMatchObject({known:true,definition:{label:'Grupo correto'}});
 expect(await h.d.businessDictionary.findCode(user,'G','pedido'))
   .toMatchObject({found:true,matches:[{table:'pedido',column:'status',code:'G',label:'Grupo correto'}]});
 expect(await h.d.businessDictionary.discover(user,'pedido','status','X'))
   .toMatchObject({known:false,investigated:true});
 const sourceRow=await h.d.db.query<{id:string}>("SELECT id FROM ada.knowledge_source WHERE config->>'bootstrap_key'='system_source_pack:1'");
 await h.d.db.query("UPDATE ada.knowledge_source SET status='pausado' WHERE id=$1",[sourceRow.rows[0]!.id]);
 expect(await h.d.businessDictionary.resolve(ctx,'pedido','status','G')).toMatchObject({known:false});
 expect(await h.d.knowledge.search(ctx,'Grupo correto')).toEqual([]);expect(calls).toBe(0);
 }finally{await h.close();}
});

it('sincroniza uma nova publicação e não reimporta a mesma revisão após reinício', async () => {
 const root = await mkdtemp(join(tmpdir(), 'posso-source-'));
 const h = await setup();
 try {
  await mkdir(join(root, 'app/model'), {recursive:true});
  await mkdir(join(root, 'app/control'), {recursive:true});
  await mkdir(join(root, 'app/routes'), {recursive:true});
  const model = join(root, 'app/model/Pedido.php');
  await writeFile(model, "<?php class Pedido extends TRecord { const TABLENAME='pedido'; }");
  const ctx = await h.d.sessions.resolveContext(9001, 1, 'test');
  vi.spyOn(h.d.sessions, 'resolveContext').mockResolvedValue({...ctx, identitySource:'possebon'});
  h.d.config.systemSource = {root, userId:9001, unitId:1};
  const version = async () => (await h.d.db.query<{version:number}>(
   "SELECT version FROM ada.knowledge_document WHERE original_name='app/model/Pedido.php'"
  )).rows[0]?.version;
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(1);
  await writeFile(join(root,'app/routes/api.php'), "<?php Router::get('/novo-modulo','NovoController::show'); Router::post('/token','Auth::token');");
  await new SystemSourceWatch(h.d).tick();
  const routes = (await h.d.db.query<{extracted_text:string}>(
   "SELECT extracted_text FROM ada.knowledge_document WHERE original_name='app/routes/api.php'"
  )).rows[0]!.extracted_text;
  expect(routes).toContain('GET /novo-modulo');
  expect(routes).not.toContain('POST /token');
  expect(await version()).toBe(1);
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(1);
  await writeFile(model, "<?php class Pedido extends TRecord { const TABLENAME='pedido'; function init(){parent::addAttribute('status');} }");
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(2);
  const actor = {...ctx, identitySource:'possebon' as const};
  await h.d.operationalAccess.conversationCommand(actor,{message:'Pause o inventário do MAD Builder',unitId:1,confirm:true});
  await writeFile(model, "<?php class Pedido extends TRecord { const TABLENAME='pedido'; }");
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(2);
  await h.d.operationalAccess.conversationCommand(actor,{message:'Retome o inventário do MAD Builder',unitId:1,confirm:true});
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(3);
  await h.d.db.query("UPDATE ada.knowledge_source SET status='pausado' WHERE config->>'bootstrap_key'='system_source_pack:1'");
  await writeFile(model, "<?php class Pedido extends TRecord { const TABLENAME='pedido'; function init(){parent::addAttribute('status');} }");
  await new SystemSourceWatch(h.d).tick();
  expect(await version()).toBe(3);
 } finally {
  await h.close();
  await rm(root, {recursive:true,force:true});
 }
});
