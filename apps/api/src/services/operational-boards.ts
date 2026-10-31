import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { LiveBoardSpec } from './operational-query.ts';
import { notFound } from '../errors.ts';

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
       WHERE unit_id=$1 AND owner_user_id=$2 AND deleted_at IS NULL
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
       WHERE id=$1 AND unit_id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`,
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
    return {board:{id:board.id,title:board.title,spec},panels,generatedAt:new Date().toISOString()};
  }
}
