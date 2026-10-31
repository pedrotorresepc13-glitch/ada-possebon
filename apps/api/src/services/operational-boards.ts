import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { LiveBoardSpec } from './operational-query.ts';
import { notFound } from '../errors.ts';
import { forbidden } from '../errors.ts';
import { buildAuthContext } from '../identity.ts';
import { audit } from '../audit.ts';

interface BoardRow {
  id:string; owner_user_id:number; unit_id:number; title:string;
  spec:unknown; created_at:Date; updated_at:Date;
}

/** Uma tela é uma definição persistente. Os dados nunca são copiados para ADA. */
export class OperationalBoardService {
  constructor(private readonly d:Deps) {}

  async create(ctx:AuthContext,raw:unknown) {
    this.d.operational.assertAllowed(ctx);
    const spec=LiveBoardSpec.parse(raw);
    // Antes de salvar, executa e valida TODOS os painéis; não cria telas vazias ou fictícias.
    for(const panel of spec.panels) await this.d.operational.query(ctx,panel.plan);
    const r=await this.d.db.query<BoardRow>(
      `INSERT INTO ada.operational_board(owner_user_id,unit_id,title,spec)
       VALUES ($1,$2,$3,$4::jsonb) RETURNING id,owner_user_id,unit_id,title,spec,created_at,updated_at`,
      [ctx.systemUserId,ctx.activeUnitId,spec.title,JSON.stringify(spec)]
    );
    return r.rows[0]!;
  }

  async list(ctx:AuthContext) {
    this.d.operational.assertAllowed(ctx);
    const r=await this.d.db.query<BoardRow>(
      `SELECT id,owner_user_id,unit_id,title,spec,created_at,updated_at
       FROM ada.operational_board
       WHERE unit_id=$1 AND deleted_at IS NULL AND (owner_user_id=$2 OR EXISTS
         (SELECT 1 FROM ada.operational_board_share s WHERE s.board_id=ada.operational_board.id AND s.target_user_id=$2))
       ORDER BY updated_at DESC LIMIT 100`,[ctx.activeUnitId,ctx.systemUserId]
    );
    return r.rows;
  }

  async get(ctx:AuthContext,id:string) {
    this.d.operational.assertAllowed(ctx);
    if(!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Painel');
    const r=await this.d.db.query<BoardRow>(
      `SELECT id,owner_user_id,unit_id,title,spec,created_at,updated_at
       FROM ada.operational_board
       WHERE id=$1 AND unit_id=$2 AND deleted_at IS NULL AND (owner_user_id=$3 OR EXISTS
         (SELECT 1 FROM ada.operational_board_share s WHERE s.board_id=ada.operational_board.id AND s.target_user_id=$3))`,
      [id,ctx.activeUnitId,ctx.systemUserId]
    );
    if(!r.rows[0]) throw notFound('Painel');
    return r.rows[0]!;
  }

  async data(ctx:AuthContext,id:string) {
    const board=await this.get(ctx,id);
    const spec=LiveBoardSpec.parse(board.spec);
    const panels=await Promise.all(spec.panels.map(async (p)=>{
      try {
        const data=await this.d.operational.query(ctx,p.plan);
        return {title:p.title,type:p.type,status:'ok',...data};
      } catch(err) {
        // Painel continua acessível, mas informa falhas de fonte, estrutura ou permissão.
        return {title:p.title,type:p.type,status:'indisponivel',
          message:(err as Error).message,rows:[],columns:[],rowCount:0};
      }
    }));
    return {board:{id:board.id,title:board.title,spec,owned:board.owner_user_id===ctx.systemUserId},panels,generatedAt:new Date().toISOString()};
  }

  async append(ctx:AuthContext,id:string,panel:unknown) {
    const board=await this.get(ctx,id);
    if(board.owner_user_id!==ctx.systemUserId) throw forbidden('Somente o dono pode editar a tela.');
    const parsed=LiveBoardSpec.shape.panels.element.parse(panel);
    await this.d.operational.query(ctx,parsed.plan);
    await this.d.db.tx(async q=>{
      const r=await q.query<BoardRow>('SELECT * FROM ada.operational_board WHERE id=$1 FOR UPDATE',[id]);
      const spec=LiveBoardSpec.parse(r.rows[0]!.spec);
      if(spec.panels.some(p=>JSON.stringify(p)===JSON.stringify(parsed))) return;
      spec.panels.push(parsed);
      const validated=LiveBoardSpec.parse(spec);
      await q.query('UPDATE ada.operational_board SET spec=$2,updated_at=now() WHERE id=$1',[id,validated]);
    });
    return this.get(ctx,id);
  }

  async share(ctx:AuthContext,id:string,targetUserId:number) {
    const board=await this.get(ctx,id);
    if(board.owner_user_id!==ctx.systemUserId) throw forbidden('Somente o dono pode compartilhar a tela.');
    const identity=await this.d.identity.resolve(targetUserId);
    if(!identity || !identity.active || targetUserId===ctx.systemUserId) throw forbidden('Escolha outro usuário ativo desta unidade.');
    buildAuthContext(identity,ctx.activeUnitId,'sharing',this.d.config.programs,this.d.identity.kind);
    await this.d.db.tx(async q=>{
      await q.query('INSERT INTO ada.operational_board_share(board_id,target_user_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,targetUserId,ctx.systemUserId]);
      await audit(q,{actor:ctx.systemUserId,unit:ctx.activeUnitId,action:'tela.compartilhada',targetType:'operational_board',targetId:id,outcome:'ok',details:{targetUserId}});
    });
    return {shared:true};
  }
  async unshare(ctx:AuthContext,id:string,targetUserId:number) {
    const board=await this.get(ctx,id);
    if(board.owner_user_id!==ctx.systemUserId) throw forbidden('Somente o dono pode remover compartilhamentos.');
    await this.d.db.query('DELETE FROM ada.operational_board_share WHERE board_id=$1 AND target_user_id=$2',[id,targetUserId]);
    return {shared:false};
  }
  async shares(ctx:AuthContext,id:string) {
    const board=await this.get(ctx,id);
    if(board.owner_user_id!==ctx.systemUserId) throw forbidden('Somente o dono pode consultar os destinatários.');
    const r=await this.d.db.query('SELECT s.target_user_id AS id,u.display_name AS name FROM ada.operational_board_share s LEFT JOIN ada.user_identity_map u ON u.system_user_id=s.target_user_id WHERE s.board_id=$1',[id]);
    return r.rows;
  }
}
