import {expect,it} from 'vitest';
import {createPglite} from '../apps/api/src/db.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import type {AuthContext} from '@ada/contracts';
import {setup} from './helpers.ts';

const ctx:AuthContext={sessionId:'test',systemUserId:230,login:'pedro',displayName:'Pedro',activeUnitId:3,allowedUnitIds:[3],units:[{id:3,name:'EPC13'}],groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),identitySource:'possebon'};
it('a regra administrativa vale para qualquer tabela de negócio, inclusive caminhos de unidade ambíguos',async()=>{
 const db=await createPglite();try{
  await db.exec(`CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
  INSERT INTO projeto VALUES(1,3),(2,4);`);
  for(const table of ['medicao','rdo','contrato']){
   await db.exec(`CREATE TABLE public.${table}(id integer PRIMARY KEY,descricao text,origem_id integer REFERENCES projeto(id),destino_id integer REFERENCES projeto(id));
   INSERT INTO public.${table} VALUES(1,'Registro encontrado',1,2);`);
  }
  const source=async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>db.query<T>(sql,params)});
  const admin=new OperationalQueryService(source);
  for(const table of ['medicao','rdo','contrato']){
   const result=await admin.query(ctx,{from:table,select:[{field:table+'.id',as:'registro'}],search:{fields:[table+'.descricao'],text:'encontrado'}});
   expect(result.rows).toEqual([{registro:1}]);
   expect(result.provenance.scope).toBe('unit_unverified');
   expect((await admin.processMap(ctx)).tables.find(t=>t.nome===table)?.consultavel).toBe(true);
  }
 }finally{await db.close();}
});

it('prévia não grava e o bloqueio confirmado vale para consulta direta e por JOIN', async () => {
 const h = await setup();
 try {
  const unitId = 3;
  const message = 'Bloqueie a tabela projeto para usuários';
  const policy = h.d.operationalAccess;
  expect(await policy.conversationCommand(ctx, { message, unitId })).toMatchObject({confirmable:true});
  expect((await policy.conversationRules(unitId)).blockedTables).toEqual([]);
  const user: AuthContext = {...ctx, roles:['user'], programs:{AdaEmbedView:[]}};
  await expect(policy.conversationCommand(user, {message, unitId, confirm:true})).rejects.toThrow();
  await expect(policy.conversationCommand(ctx, {message, unitId:4, confirm:true})).rejects.toThrow('unidade mudou');
  await policy.conversationCommand(ctx, {message, unitId, confirm:true});
  await policy.conversationCommand(ctx, {message:'Responda assim: use frases curtas', unitId, confirm:true});
  expect(await policy.conversationRules(unitId)).toEqual({blockedTables:['projeto'],style:'use frases curtas'});
  expect(await policy.conversationCommand(ctx, {message:'Mostre as regras atuais',unitId})).toMatchObject({text:expect.stringContaining('projeto'),confirmable:false});
  expect(await policy.conversationCommand(ctx, {message:'Mostre o estado atual',unitId})).toMatchObject({text:expect.stringContaining('Documentos indexados'),confirmable:false});
  expect((await policy.conversationRules(4)).blockedTables).toEqual([]);
  await h.d.db.exec(`CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
    CREATE TABLE public.pedido(id integer PRIMARY KEY,unit_id integer,projeto_id integer REFERENCES projeto(id));
    INSERT INTO projeto VALUES(1,3); INSERT INTO pedido VALUES(1,3,1);`);
  const source = async () => ({executeRead:<T>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)});
  const operations = new OperationalQueryService(source, c => policy.policy(c));
  const direct = {from:'projeto',select:[{field:'projeto.id',as:'registro'}]};
  const join = {from:'pedido',joins:['projeto'],select:[{field:'projeto.id',as:'registro'}]};
  await expect(operations.query(user,direct)).rejects.toThrow('bloqueada');
  await expect(operations.query(user,join)).rejects.toThrow('bloqueada');
  await expect(operations.query(ctx,direct)).rejects.toThrow('bloqueada');
  await policy.conversationCommand(ctx,{message:'Desbloqueie a tabela projeto',unitId,confirm:true});
  expect((await operations.query(user,direct)).rows).toEqual([{registro:1}]);
  expect((await operations.query(ctx,direct)).rows).toEqual([{registro:1}]);
  await expect(operations.diagnoseTable(ctx,'system_sessions')).rejects.toThrow('credencial PostgreSQL não foi verificado');
 } finally { await h.close(); }
});
it('admin busca procurement sem unidade, mantém EPC13 como contexto e informa quando a unidade não foi comprovada',async()=>{
 const db=await createPglite();try{
  await db.exec(`CREATE TABLE public.procurement(id integer PRIMARY KEY,descricao text,contrato text);
  CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
  CREATE TABLE public.pedido(id integer PRIMARY KEY,projeto_id integer REFERENCES projeto(id),descricao text);
  INSERT INTO procurement VALUES(10,'Notebook TI','Contrato EPC13'),(20,'Notebook externo','Outro contrato');
  INSERT INTO projeto VALUES(1,3),(2,4);
  INSERT INTO pedido VALUES(1,1,'Notebook EPC13'),(2,2,'Notebook externo');`);
  const source=async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>db.query<T>(sql,params)});
  const admin=new OperationalQueryService(source);
  const plan={from:'procurement',select:[{field:'procurement.id',as:'sc'},{field:'procurement.contrato',as:'contrato'}],search:{fields:['procurement.descricao'],text:'notebook'}};
  const found=await admin.query(ctx,plan);
  expect(found.rows).toHaveLength(2);
  expect(found.provenance).toMatchObject({scope:'unit_unverified',unitId:null,requestedUnitId:3});
  expect((await admin.processMap(ctx)).tables.find(t=>t.nome==='procurement')?.consultavel).toBe(true);
  const localPlan={from:'pedido',joins:['projeto'],select:[{field:'pedido.id',as:'sc'}]};
  expect((await admin.query(ctx,localPlan)).rows).toEqual([{sc:1}]);
  expect((await admin.query(ctx,{...localPlan,unitScope:'all'})).rows).toEqual([{sc:1},{sc:2}]);
  const restricted=new OperationalQueryService(source,async()=>({admin:false,tables:{procurement:{columns:['id','descricao','contrato']},pedido:{columns:['id','projeto_id','descricao']},projeto:{columns:['id','unit_id']}}}));
  const user:AuthContext={...ctx,roles:['user'],programs:{AdaEmbedView:[]}};
  await expect(restricted.query(user,plan)).rejects.toThrow(/vínculo único/);
  await expect(restricted.query(user,{...localPlan,unitScope:'all'})).rejects.toThrow(/administração/);
  expect((await restricted.query(user,localPlan)).rows).toEqual([{sc:1}]);
  await expect(admin.query({...ctx,identitySource:'dev_synthetic'},plan)).rejects.toThrow();
 }finally{await db.close();}
});

it('consulta nomes e logins do cadastro para usuário da Posso e respeita bloqueio administrativo', async () => {
 const h=await setup();
 try {
  await h.d.db.exec("CREATE TABLE public.system_users(id int, name text, login text, password text); INSERT INTO system_users VALUES(1,'Pessoa de teste','pessoa','segredo');");
  const user:AuthContext={...ctx,roles:['user'],programs:{AdaEmbedView:[]}};
  const service=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}),c=>h.d.operationalAccess.policy(c));
  const plan={from:'system_users',select:[{field:'system_users.name',as:'nome'},{field:'system_users.login',as:'usuario'}]};
  expect((await service.query(user,plan)).rows).toEqual([{nome:'Pessoa de teste',usuario:'pessoa'}]);
  await expect(service.query(user,{from:'system_users',select:[{field:'system_users.password'}]})).rejects.toThrow();
  await h.d.operationalAccess.conversationCommand(ctx,{message:'Bloqueie a tabela system_users',unitId:3,confirm:true});
  await expect(service.query(user,plan)).rejects.toThrow('bloqueada');
  await expect(service.query(ctx,plan)).rejects.toThrow('bloqueada');
 } finally {await h.close();}
});

it('concede leitura de nomes e permissões sem conceder leitura de senhas ou escrita', async () => {
 const {readFile}=await import('node:fs/promises');
 const db=await createPglite();
 try {
  await db.exec("CREATE ROLE posso_directory_reader; CREATE TABLE public.system_users(id int,name text,login text,password text); INSERT INTO system_users VALUES(1,'Teste','teste','segredo');");
  const sql=(await readFile(new URL('../deploy/sql/possebon-directory-read.sql',import.meta.url),'utf8')).replace(":'posso_role'","'posso_directory_reader'");
  await db.exec(sql);
  await db.exec(sql);
  expect((await db.query("SELECT has_column_privilege('posso_directory_reader','public.system_users','name','SELECT') AS nome,has_column_privilege('posso_directory_reader','public.system_users','password','SELECT') AS senha,has_table_privilege('posso_directory_reader','public.system_users','INSERT') AS escrita")).rows).toEqual([{nome:true,senha:false,escrita:false}]);
  await db.exec('SET ROLE posso_directory_reader');
  expect((await db.query('SELECT name,login FROM system_users')).rows).toEqual([{name:'Teste',login:'teste'}]);
  await expect(db.query('SELECT password FROM system_users')).rejects.toThrow();
  await db.exec('RESET ROLE');
 } finally {await db.close();}
});
