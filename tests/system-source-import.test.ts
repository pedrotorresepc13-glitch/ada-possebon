import {expect,it} from 'vitest';
import {parseModel,parseScreen,literalItems} from '../scripts/knowledge/extract-system-source.ts';
import {SystemSourcePack,type SourcePack} from '../apps/api/src/services/source-pack-schema.ts';
import {importSystemSource,sourceDefinitions} from '../apps/api/src/services/system-source-import.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import {setup} from './helpers.ts';
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
 expect((await importSystemSource(h.d,ctx,pack)).unchanged).toBe(6);
 expect((await h.d.institutionalStudy.status(ctx)).indexed).toBe(0);
 await h.d.db.exec("CREATE TABLE public.pedido(id integer,unit_id integer,status text); CREATE TABLE public.diario_obra(id integer,unit_id integer,status text); INSERT INTO diario_obra VALUES(1,1,'V');");
 h.d.operational=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,p:unknown[]=[])=>h.d.db.query<T>(sql,p)}),async()=>({admin:true,tables:{}}),c=>h.d.businessDictionary.read(c));
 expect((await h.d.systemKnowledge.catalog(ctx,'sms')).tables.map(t=>t.name)).toContain('pedido');
 const catalog=await h.d.systemKnowledge.catalog(ctx,'RDO');expect(catalog.tables.map(t=>t.name)).toContain('diario_obra');
 const context=await h.d.systemKnowledge.context(ctx,'Veja o RDO.');expect(context).toContain('diario_obra');expect(context).toContain('MeuRdoForm');
 expect((await h.d.operational.query(ctx,{from:'diario_obra',select:[{field:'diario_obra.status',as:'situacao'}]})).rows).toEqual([{situacao:'Validado'}]);
 expect(await h.d.businessDictionary.read({...ctx,activeUnitId:2})).toEqual([]);
 const user=await h.d.sessions.resolveContext(9004,1,'user');expect(await h.d.businessDictionary.read(user)).toEqual([]);
 const sourceRow=await h.d.db.query<{id:string}>("SELECT id FROM ada.knowledge_source WHERE config->>'bootstrap_key'='system_source_pack:1'");
 await h.d.db.query("UPDATE ada.knowledge_source SET status='pausado' WHERE id=$1",[sourceRow.rows[0]!.id]);
 expect(await h.d.businessDictionary.resolve(ctx,'pedido','status','G')).toMatchObject({known:false});
 expect(await h.d.knowledge.search(ctx,'Grupo correto')).toEqual([]);expect(calls).toBe(0);
 }finally{await h.close();}
});
