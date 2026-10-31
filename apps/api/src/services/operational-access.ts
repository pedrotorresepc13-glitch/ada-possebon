import { z } from 'zod';
import { assertAdmin } from '@ada/domain';
import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { forbidden } from '../errors.ts';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const AccessRules = z.object({ rules: z.array(z.object({
  table: id, program: z.string().regex(/^[A-Za-z0-9_]{1,120}$/),
  columns: z.array(id).min(1).max(100),
  scope: z.enum(['unit','user','subject','team','reports']),
  scopeColumn: id.optional()
}).strict().refine(r => r.scope === 'unit' || Boolean(r.scopeColumn), 'Informe o campo do vínculo confirmado.')).max(150) }).strict();
export interface TableAccess { columns: string[]; scopeColumn?: string; scopeValues?: number[] }
export interface OperationalAccess { admin: boolean; tables: Record<string,TableAccess> }

export class OperationalAccessService {
  constructor(private readonly d: Deps) {}
  async read() {
    const r = await this.d.db.query<{value:unknown}>('SELECT value FROM ada.app_setting WHERE key=$1',['operational_access']);
    return AccessRules.parse(r.rows[0]?.value ?? {rules:[]});
  }
  async save(ctx:AuthContext,raw:unknown) {
    assertAdmin(ctx);
    const value = AccessRules.parse(raw);
    // Uma tabela tem uma regra: não combinar escopos distintos em um acesso mais amplo.
    if(new Set(value.rules.map(r=>r.table)).size!==value.rules.length) throw forbidden('Cadastre somente uma regra por tabela.');
    await this.d.db.tx(async q=>{
      await q.query(`INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      ['operational_access',value,ctx.systemUserId]);
      await audit(q,{actor:ctx.systemUserId,unit:ctx.activeUnitId,action:'operacional.acessos_atualizados',outcome:'ok',details:{rules:value.rules.length}});
    });
    return value;
  }
  async policy(ctx:AuthContext):Promise<OperationalAccess> {
    if(ctx.identitySource!=='possebon' || !ctx.allowedUnitIds.includes(ctx.activeUnitId)) throw forbidden('Acesso operacional exige identidade POSSEBON e unidade autorizada.');
    if(ctx.roles.includes('admin') && ctx.programs.AdaAdministracao) return {admin:true,tables:{}};
    const config=await this.read();
    const tables:OperationalAccess['tables']={};
    for(const rule of config.rules) {
      if(!Object.hasOwn(ctx.programs,rule.program)) continue;
      const work=ctx.workContext;
      const values = rule.scope==='user' ? [ctx.systemUserId] : rule.scope==='subject' ? (work?.subjectId?[work.subjectId]:[]) :
        rule.scope==='team' ? work?.teamIds??[] : rule.scope==='reports' ? work?.reportUserIds??[] : undefined;
      // Vínculo ausente jamais vira acesso à unidade inteira.
      if(values && !values.length) continue;
      tables[rule.table]={columns:rule.columns,scopeColumn:rule.scopeColumn,scopeValues:values};
    }
    return {admin:false,tables};
  }
}
