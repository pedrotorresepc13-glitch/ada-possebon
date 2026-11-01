import {expect,it} from 'vitest';
import {createPglite} from '../apps/api/src/db.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import type {AuthContext} from '@ada/contracts';
import {protectedBusinessTable,readGrants} from '../scripts/deploy/business-readonly.ts';
const ctx:AuthContext={sessionId:'test',systemUserId:230,login:'admin',displayName:'Admin',activeUnitId:3,allowedUnitIds:[3],units:[{id:3,name:'EPC13'}],groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),identitySource:'possebon'};
it('consulta item sem unidade por FK verificada e mantém o isolamento mesmo quando filtros são omitidos',async()=>{
 const db=await createPglite();try{
 await db.exec(`CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer,deletado_em timestamp);
 CREATE TABLE public.procurement(id integer PRIMARY KEY,projeto_id integer REFERENCES projeto(id),descricao text);
 CREATE TABLE public.procurement_item(id integer PRIMARY KEY,procurement_id integer REFERENCES procurement(id),descricao text);
 CREATE TABLE public.ambigua(id integer,origem_id integer REFERENCES projeto(id),destino_id integer REFERENCES projeto(id));
 INSERT INTO projeto VALUES(1,3,NULL),(2,4,NULL),(3,3,now());
 INSERT INTO procurement VALUES(10,1,'Notebook TI'),(20,2,'Notebook outra unidade'),(30,3,'Projeto excluído');
 INSERT INTO procurement_item VALUES(100,10,'Notebook'),(200,20,'Notebook'),(300,30,'Notebook');`);
 const service=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>db.query<T>(sql,params)}),async()=>({admin:false,tables:{projeto:{columns:['id','unit_id','deletado_em']},procurement:{columns:['id','projeto_id','descricao']},procurement_item:{columns:['id','procurement_id','descricao']},ambigua:{columns:['id','origem_id','destino_id']}}}));
 const plan={from:'procurement_item',select:[{field:'procurement_item.id',as:'item'}]};
 expect((await service.query(ctx,plan)).rows).toEqual([{item:100}]);
 expect((await service.query({...ctx,activeUnitId:4,allowedUnitIds:[4]},plan)).rows).toEqual([{item:200}]);
 expect((await service.query(ctx,{...plan,where:[{field:'procurement_item.id',op:'eq',value:200}]})).rows).toEqual([]);
 await expect(service.query(ctx,{from:'ambigua',select:[{field:'ambigua.id'}]})).rejects.toThrow(/vínculo único/);
 expect((await service.processMap(ctx)).tables.find(t=>t.nome==='procurement_item')?.consultavel).toBe(true);
 const related=await service.query(ctx,{from:'procurement',joins:['projeto'],select:[{field:'procurement.id',as:'oc'}]});
 expect(related.rows).toEqual([{oc:10}]);
 }finally{await db.close();}
});
it('gera somente concessões SELECT ausentes para tabelas de negócio e protege identificadores',()=>{
 const grants=readGrants([{name:'procurement',can_read:false},{name:'colaborador',can_read:true},{name:'system_users',can_read:false},{name:'oauth_token',can_read:false},{name:'users',can_read:false}], 'ada_ro');
 expect(grants).toEqual(['GRANT SELECT ON public."procurement" TO "ada_ro";']);
 expect(protectedBusinessTable('ada_private')).toBe(true);
 expect(readGrants([{name:'nome"especial',can_read:false}], 'leitor"x')[0]).toBe('GRANT SELECT ON public."nome""especial" TO "leitor""x";');
});
it('a concessão permite leitura de negócio sem conceder escrita ou acesso à autenticação',async()=>{
 const db=await createPglite();try{
   await db.exec('CREATE ROLE business_reader; CREATE TABLE public.procurement(id integer); CREATE TABLE public.system_users(id integer); GRANT USAGE ON SCHEMA public TO business_reader;');
   for(const sql of readGrants([{name:'procurement',can_read:false},{name:'system_users',can_read:false}],'business_reader'))await db.exec(sql);
   await db.exec('SET ROLE business_reader');
   expect((await db.query("SELECT has_table_privilege(current_user,'public.procurement','SELECT') AS leitura,has_table_privilege(current_user,'public.procurement','INSERT') AS escrita,has_table_privilege(current_user,'public.system_users','SELECT') AS autenticacao")).rows[0]).toEqual({leitura:true,escrita:false,autenticacao:false});
   await db.exec('RESET ROLE');
 }finally{await db.close();}
});
