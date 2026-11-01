import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {setup,type Harness} from './helpers.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import type {AuthContext} from '@ada/contracts';
import {createPglite} from '../apps/api/src/db.ts';
import {migrateUp,migrateDown} from '../apps/api/src/migrate.ts';

let h:Harness;
const admin:AuthContext={sessionId:'test',systemUserId:900,login:'admin',displayName:'Administrador',activeUnitId:1,allowedUnitIds:[1],units:[{id:1,name:'Unidade'}],groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),identitySource:'possebon'};
const member:AuthContext={...admin,systemUserId:901,roles:['user'],programs:{ComprasList:[]},workContext:{teamIds:[10],reportUserIds:[]}};
const plan={from:'pedido',select:[{field:'pedido.id',as:'id'},{field:'pedido.situacao',as:'situacao'}],where:[{field:'pedido.id',op:'eq',value:1}]};
beforeAll(async()=>{
  h=await setup();
  await h.d.db.exec(`CREATE TABLE public.pedido(id integer PRIMARY KEY,unit_id integer,equipe_id integer,situacao text,valor numeric);
    INSERT INTO pedido VALUES(1,1,10,'Pendente',100),(2,1,20,'Outro time',200),(3,2,10,'Outra unidade',300);`);
  h.d.operational=new OperationalQueryService(async()=>({executeRead:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}),ctx=>h.d.operationalAccess.policy(ctx));
});
afterAll(async()=>{vi.restoreAllMocks();await h.close();});

describe('permissões operacionais por vínculo',()=>{
  it('restringe equipe, unidade e campos; vínculo ausente e programa revogado fecham o acesso',async()=>{
    await h.d.operationalAccess.save(admin,{rules:[{table:'pedido',program:'ComprasList',columns:['id','situacao'],scope:'team',scopeColumn:'equipe_id'}]});
    const all={from:'pedido',select:[{field:'pedido.id',as:'id'}]};
    expect((await h.d.operational.query(member,all)).rows).toEqual([{id:1}]);
    expect((await h.d.operational.query(admin,all)).rows).toHaveLength(2);
    await expect(h.d.operational.query(member,{from:'pedido',select:[{field:'pedido.valor'}]})).rejects.toThrow();
    await expect(h.d.operational.query({...member,workContext:undefined},all)).rejects.toThrow();
    await expect(h.d.operational.query({...member,programs:{}},all)).rejects.toThrow();
    expect((await h.d.operational.query(member,{...all,where:[{field:'pedido.id',op:'eq',value:2}]})).rows).toEqual([]);
  });
  it('compartilhamento reexecuta consulta com acesso do destinatário e remoção impede nova leitura',async()=>{
    const board=await h.d.liveBoards.create(admin,{title:'Pedidos',panels:[{title:'Pedidos',type:'table',plan:{from:'pedido',select:[{field:'pedido.id',as:'id'}]}}]});
    await h.d.db.query('INSERT INTO ada.operational_board_share(board_id,target_user_id,created_by) VALUES($1,$2,$3)',[board.id,member.systemUserId,admin.systemUserId]);
    const data=await h.d.liveBoards.data(member,board.id);
    expect(data.board.owned).toBe(false);expect(data.panels[0]?.rows).toEqual([{id:1}]);
    await expect(h.d.liveBoards.append(member,board.id,{title:'Outro',type:'kpi',plan})).rejects.toThrow();
    await h.d.liveBoards.unshare(admin,board.id,member.systemUserId);
    await expect(h.d.liveBoards.get(member,board.id)).rejects.toThrow();
  });
});
describe('acompanhamento real sem chamadas à IA',()=>{
  it('não avisa sem mudança; avisa uma vez após mudança e interrompe quando a permissão é revogada',async()=>{
    const resolver=vi.spyOn(h.d.sessions,'resolveContext').mockResolvedValue(member);
    const watch=await h.d.watches.create(member,{name:'Notebook',plan});
    expect((await h.d.watches.create(member,{name:'Notebook',plan})).id).toBe(watch.id);
    await h.d.watches.runDue();
    expect((await h.d.db.query('SELECT 1 FROM ada.notification WHERE recipient_user_id=901')).rowCount).toBe(0);
    await h.d.db.query("UPDATE pedido SET situacao='Aprovado' WHERE id=1");
    await h.d.db.query('UPDATE ada.operational_watch SET next_check_at=now() WHERE id=$1',[watch.id]);
    await h.d.watches.runDue();
    expect((await h.d.db.query('SELECT 1 FROM ada.notification WHERE recipient_user_id=901')).rowCount).toBe(1);
    await h.d.db.query('UPDATE ada.operational_watch SET next_check_at=now() WHERE id=$1',[watch.id]);
    await h.d.watches.runDue();
    expect((await h.d.db.query('SELECT 1 FROM ada.notification WHERE recipient_user_id=901')).rowCount).toBe(1);
    resolver.mockResolvedValue({...member,programs:{}});
    await h.d.db.query('UPDATE ada.operational_watch SET next_check_at=now() WHERE id=$1',[watch.id]);await h.d.watches.runDue();
    expect((await h.d.watches.list(member))[0]).toMatchObject({state:'error'});
    resolver.mockRestore();
  });
});
describe('preparação inicial persistente',()=>{
  it('migração aditiva preserva registros e configuração existentes',async()=>{
    const db=await createPglite();
    try{await migrateUp(db);await migrateDown(db,2);
      await db.query("INSERT INTO ada.app_setting(key,value) VALUES('assistant_branding',$1)",[{name:'Nome preservado'}]);
      const saved=await db.query<{id:string}>("INSERT INTO ada.conversation(owner_user_id,unit_id,title) VALUES(1,1,'Histórico preservado') RETURNING id");
      expect(await migrateUp(db)).toEqual(['0007_personal_workspace','0008_study_offsets']);
      expect((await db.query('SELECT title FROM ada.conversation WHERE id=$1',[saved.rows[0]!.id])).rows[0]).toEqual({title:'Histórico preservado'});
      expect((await db.query("SELECT value FROM ada.app_setting WHERE key='assistant_branding'")).rows[0]).toEqual({value:{name:'Nome preservado'}});
    }finally{await db.close();}
  });
  it('lista destinatários da unidade e nega edição administrativa ao colaborador',async()=>{
    const a=await h.login('admin.demo'),c=await h.login('colab.a');
    const recipients=await a.get('/sharing/recipients');expect(recipients.status).toBe(200);
    expect(recipients.json).toEqual(expect.arrayContaining([expect.objectContaining({id:9004})]));
    expect((await c.put('/admin/operational-access',{rules:[]})).status).toBe(403);
  });
  it('cria visão e boas-vindas uma única vez; recomeçar preserva conversas e painéis anteriores',async()=>{
    const c=await h.login('admin.demo');
    const me=await c.get('/me');
    const ctx=await h.d.sessions.resolveContext(me.json.user.systemUserId,me.json.activeUnit.id,'test');
    await h.d.workspace.run(ctx);
    const first=await h.d.db.query<{conversation_id:string;dashboard_id:string;state:string}>('SELECT * FROM ada.personal_workspace WHERE owner_user_id=$1',[ctx.systemUserId]);
    expect(first.rows[0]?.conversation_id).toBeTruthy();expect(first.rows[0]?.dashboard_id).toBeTruthy();
    await h.d.workspace.run(ctx);
    const again=await h.d.db.query('SELECT conversation_id,dashboard_id FROM ada.personal_workspace WHERE owner_user_id=$1',[ctx.systemUserId]);
    expect(again.rows[0]).toMatchObject({conversation_id:first.rows[0]!.conversation_id,dashboard_id:first.rows[0]!.dashboard_id});
    expect((await c.post('/workspace/welcome')).status).toBe(200);
    await h.d.workspace.retry(ctx,true);
    await vi.waitFor(async()=>{const r=await h.d.db.query<{state:string}>('SELECT state FROM ada.personal_workspace WHERE owner_user_id=$1',[ctx.systemUserId]);expect(['ready','partial']).toContain(r.rows[0]?.state);},{timeout:10000});
    expect((await h.d.db.query('SELECT 1 FROM ada.conversation WHERE id=$1',[first.rows[0]!.conversation_id])).rowCount).toBe(1);
    expect((await h.d.db.query('SELECT 1 FROM ada.dashboard WHERE id=$1',[first.rows[0]!.dashboard_id])).rowCount).toBe(1);
  });
});
