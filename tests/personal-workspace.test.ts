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
  await h.d.db.exec("CREATE TABLE public.frequencia(id integer PRIMARY KEY,unit_id integer,dia date,situacao text)");
  h.d.operational=new OperationalQueryService(async()=>({executeRead:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}),ctx=>h.d.operationalAccess.policy(ctx));
});
afterAll(async()=>{vi.restoreAllMocks();await h.close();});

describe('permissões operacionais por vínculo',()=>{
  it('permite consultar e editar a tela própria com 719, mantendo os limites de unidade e administração',async()=>{
    const reader:AuthContext={...member,programs:{AdaEmbedView:[]}};
    const initial={title:'Compras',panels:[{title:'Pedidos',type:'table',plan}]};
    const board=await h.d.liveBoards.create(reader,initial);
    const revised={title:'Compras da unidade',panels:[{
      title:'Valor dos pedidos',type:'table',plan:{from:'pedido',select:[{field:'pedido.valor',as:'valor'}]}
    }]};
    expect((await h.d.liveBoards.replace(reader,board.id,revised)).id).toBe(board.id);
    const result=await h.d.liveBoards.data(reader,board.id);
    expect(result.panels[0]?.rows.map(row=>Number(row.valor)).sort()).toEqual([100,200]);
    await expect(h.d.operationalAccess.save(reader,{rules:[]})).rejects.toThrow();
    await expect(h.d.liveBoards.replace({...reader,systemUserId:902},board.id,revised)).rejects.toThrow();
  });
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
  it('avisa sobre uma ocorrência nova do dia, sem alertar sobre outro dia, unidade ou repetição',async()=>{
    const reader:AuthContext={...member,systemUserId:905,programs:{AdaEmbedView:[]}};
    const resolver=vi.spyOn(h.d.sessions,'resolveContext').mockResolvedValue(reader);
    try {
      const {id}=await h.d.watches.create(reader,{name:'Faltas sem justificativa',todayField:'frequencia.dia',
        plan:{from:'frequencia',select:[{field:'frequencia.id'}],
          where:[{field:'frequencia.situacao',op:'eq',value:'Sem justificativa'}]}});
      await h.d.db.exec("INSERT INTO public.frequencia VALUES(1,1,'2026-10-27','Sem justificativa'),(2,2,'2026-10-27','Sem justificativa'),(3,1,'2026-10-26','Sem justificativa')");
      await h.d.watches.runDue();
      await h.d.db.query('UPDATE ada.operational_watch SET next_check_at=now() WHERE id=$1',[id]);
      await h.d.watches.runDue();
      expect((await h.d.db.query('SELECT 1 FROM ada.notification WHERE recipient_user_id=905')).rowCount).toBe(1);
      expect((await h.d.watches.current(reader,id)).row).toMatchObject({ocorrencias:1});
    } finally { resolver.mockRestore(); }
  });
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
  it('abre o mesmo chat e Dashboard em branco mesmo em dois acessos simultâneos',async()=>{
    const reader:AuthContext={...member,systemUserId:903,programs:{AdaEmbedView:[]}};
    const [first,second]=await Promise.all([
      h.d.workspace.personalAssets(reader),h.d.workspace.personalAssets(reader)
    ]);
    expect(first.conversationId).toBeTruthy();
    expect(first.liveBoardId).toBeTruthy();
    expect(second).toEqual(first);
    const board=await h.d.liveBoards.data(reader,first.liveBoardId!);
    expect(board.board.title).toBe('Meu Dashboard');
    expect(board.panels).toEqual([]);
  });
  it('administradores e colaboradores também reutilizam um único Dashboard pessoal',async()=>{
    const adminUser:AuthContext={...admin,systemUserId:9990};
    const [first,second]=await Promise.all([
      h.d.workspace.personalAssets(adminUser),h.d.workspace.personalAssets(adminUser)
    ]);
    expect(first.liveBoardId).toBeTruthy();
    expect(second.liveBoardId).toBe(first.liveBoardId);
    const again=await h.d.workspace.personalAssets(adminUser);
    expect(again).toEqual(first);
    const count=await h.d.db.query<{n:number}>(
      'SELECT count(*)::int AS n FROM ada.operational_board WHERE owner_user_id=$1 AND unit_id=$2 AND deleted_at IS NULL',
      [adminUser.systemUserId,adminUser.activeUnitId]);
    expect(count.rows[0]?.n).toBe(1);
    const ctx:AuthContext={...member,systemUserId:9004};
    const assets=await h.d.workspace.personalAssets(ctx);
    const client=await h.login('colab.a',1);
    const endpoint=await client.get('/workspace/personal-dashboard');
    expect(endpoint.status).toBe(200);
    expect(endpoint.json.dashboardId).toBe(assets.liveBoardId);
  });
  it('inclui e altera apenas o painel pedido, sem criar outro Dashboard nem apagar os demais',async()=>{
    const author:AuthContext={...admin,systemUserId:9991};
    const assets=await h.d.workspace.personalAssets(author);
    const panelA={title:'Solicitações',type:'table' as const,plan};
    const panelB={title:'Situação dos pedidos',type:'bar' as const,plan:{
      from:'pedido',select:[{field:'pedido.id',as:'quantidade',aggregate:'count' as const}],
      groupBy:['pedido.situacao']
    }};
    const first=await h.d.liveBoards.editPersonal(author,{
      operations:[{action:'add',targetTitle:'Solicitações',panel:panelA}]
    });
    expect(first.id).toBe(assets.liveBoardId);
    await h.d.liveBoards.editPersonal(author,{
      operations:[{action:'add',targetTitle:'Situação dos pedidos',panel:panelB}]
    });
    const replaced={...panelA,title:'Solicitações',plan:{
      from:'pedido',select:[{field:'pedido.id',as:'identificador'}],
      where:[{field:'pedido.id',op:'eq',value:1}]
    }};
    await h.d.liveBoards.editPersonal(author,{
      operations:[{action:'replace',targetTitle:'Solicitações',panel:replaced}]
    });
    const state=await h.d.liveBoards.get(author,assets.liveBoardId!);
    const saved=state.spec as {panels:{title:string}[]};
    expect(saved.panels.map(p=>p.title)).toEqual(['Solicitações','Situação dos pedidos']);
    await expect(h.d.liveBoards.editPersonal(author,{operations:[
      {action:'add',targetTitle:'Solicitações',panel:panelA}
    ]})).rejects.toThrow('Já existe');
    const n=await h.d.db.query<{count:number}>(
      'SELECT count(*)::int AS count FROM ada.operational_board WHERE owner_user_id=$1 AND unit_id=$2 AND deleted_at IS NULL',
      [author.systemUserId,author.activeUnitId]);
    expect(n.rows[0]?.count).toBe(1);
  });
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
