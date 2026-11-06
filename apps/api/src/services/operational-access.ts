import { z } from 'zod';
import { assertAdmin } from '@ada/domain';
import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { hasBusinessRead } from '@ada/domain';
import { forbidden, invalid } from '../errors.ts';
import { sourceControlKey } from './system-source-watch.ts';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const AccessRules = z.object({ rules: z.array(z.object({
  table: id, program: z.string().regex(/^[A-Za-z0-9_]{1,120}$/),
  columns: z.array(id).min(1).max(100),
  scope: z.enum(['unit','user','subject','team','reports']),
  scopeColumn: id.optional()
}).strict().refine(r => r.scope === 'unit' || Boolean(r.scopeColumn), 'Informe o campo do vínculo confirmado.')).max(150) }).strict();
export interface TableAccess { columns: string[]; scopeColumn?: string; scopeValues?: number[] }
export interface OperationalAccess { admin: boolean; businessRead?: boolean; tables: Record<string,TableAccess>; blockedTables?: string[] }
const ConversationRules = z.object({ blockedTables: z.array(id).max(150), style: z.string().max(600) }).strict();

export class OperationalAccessService {
  constructor(private readonly d: Deps) {}
  async conversationRules(unitId: number) {
    const result = await this.d.db.query<{ value: unknown }>('SELECT value FROM ada.app_setting WHERE key=$1', ['posso:rules:' + unitId]);
    return ConversationRules.parse(result.rows[0]?.value ?? { blockedTables: [], style: '' });
  }
  async conversationCommand(ctx: AuthContext, raw: unknown) {
    assertAdmin(ctx);
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) throw forbidden('Unidade fora do escopo autorizado.');
    const { message, confirm, unitId } = z.object({ message: z.string().trim().min(1).max(650), confirm: z.boolean().default(false), unitId: z.number().int().positive() }).strict().parse(raw);
    if (unitId !== ctx.activeUnitId) throw forbidden('A unidade mudou. Revise a regra novamente.');
    if (/^(?:consulte|mostre|liste) (?:as )?regras(?: atuais)?[.!]?$/i.test(message)) {
      const rules = await this.conversationRules(unitId);
      const blocked = rules.blockedTables.join(', ') || 'nenhum bloqueio cadastrado';
      return { text: 'Tabelas bloqueadas nesta unidade: ' + blocked + '. Estilo: ' + (rules.style || 'padrão') + '.', confirmable: false };
    }
    if (/^(?:consulte|mostre) (?:o )?estado(?: atual)?[.!]?$/i.test(message)) {
      const [health, coverage] = await Promise.all([this.d.admin.health(), this.d.brainCoverage.status(ctx)]);
      const worker = health.worker ? (health.worker.alive ? 'ativo' : 'sem sinal recente') : 'sem verificação';
      const source = coverage.operationalSource === 'available' ? 'disponível' : 'indisponível';
      return { text: `Banco da Posso: ${health.database.ok ? 'disponível' : 'indisponível'}. Serviço em segundo plano: ${worker}. Fonte operacional: ${source}. Documentos indexados na cobertura da unidade: ${coverage.indexedDocuments}.`, confirmable: false };
    }
    const syncCommand = /^(pause|retome|consulte) (?:o )?invent[aá]rio (?:do )?mad builder[.!]?$/i.exec(message)?.[1]?.toLowerCase();
    if (syncCommand) {
      if (this.d.config.systemSource?.unitId !== unitId) return {
        text: 'A sincronização automática do MAD Builder ainda não está configurada para esta unidade.',
        confirmable: false
      };
      const key = sourceControlKey(unitId);
      if (syncCommand === 'consulte') {
        const states = await this.d.db.query<{ key: string; value: { paused?: boolean; snapshot?: string } }>(
          'SELECT key,value FROM ada.app_setting WHERE key IN ($1,$2)', [key, 'system_source_watch:' + unitId]
        );
        const paused = states.rows.find(row => row.key === key)?.value.paused;
        const snapshot = states.rows.find(row => row.key !== key)?.value.snapshot;
        const observed = snapshot ? new Date(snapshot).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
        return { text: `Inventário ${paused ? 'pausado' : 'programado para sincronizar'}. ${observed ? 'Última publicação importada em ' + observed + '.' : 'Nenhuma publicação importada pelo worker.'}`, confirmable: false };
      }
      const paused = syncCommand === 'pause';
      const summary = paused ? 'Pausar as próximas sincronizações do inventário nesta unidade.' : 'Retomar as próximas sincronizações do inventário nesta unidade.';
      if (!confirm) return { text: summary, confirmable: true };
      await this.d.db.tx(async q => {
        await q.query(`INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3)
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [key, { paused }, ctx.systemUserId]);
        await audit(q, {actor:ctx.systemUserId,unit:unitId,action:'posso.inventario_controle',
          targetType:'app_setting',targetId:key,outcome:'ok',details:{paused}});
      });
      return { text: paused ? 'Sincronizações futuras pausadas.' : 'Sincronizações futuras retomadas.', confirmable: false };
    }
    const blocked = /^(?:bloqueie (?:a )?tabela|n[aã]o (?:vai )?acess(?:e|ar) (?:a )?tabela)\s+([a-z][a-z0-9_]{0,62})(?:\s+para (?:os )?usu[aá]rios)?[.!]?$/i.exec(message)?.[1]?.toLowerCase();
    const unblocked = /^desbloqueie (?:a )?tabela\s+([a-z][a-z0-9_]{0,62})[.!]?$/i.exec(message)?.[1]?.toLowerCase();
    const style = /^(?:estilo|responda assim|voc[eê] vai falar assim)\s*:\s*(.{1,600})$/is.exec(message)?.[1]?.trim();
    if (!blocked && !unblocked && !style) return {
      text: 'Use “Bloqueie a tabela nome_da_tabela”, “Desbloqueie a tabela nome_da_tabela”, “Responda assim: sua orientação” ou “Consulte o inventário do MAD Builder”.',
      confirmable: false
    };
    const summary = blocked ? `Bloquear a tabela ${blocked} em consultas operacionais de todos os perfis desta unidade.`
      : unblocked ? `Remover o bloqueio administrativo de ${unblocked} nesta unidade.`
      : `Definir o estilo de resposta desta unidade como “${style}”.`;
    if (!confirm) return { text: summary, confirmable: true };
    const key = 'posso:rules:' + ctx.activeUnitId;
    await this.d.db.tx(async q => {
      await q.query('INSERT INTO ada.app_setting(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, { blockedTables: [], style: '' }]);
      const stored = await q.query<{ value: unknown }>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE', [key]);
      const current = ConversationRules.parse(stored.rows[0]?.value);
      if (blocked && !current.blockedTables.includes(blocked)) {
        if (current.blockedTables.length === 150) throw invalid('Limite de 150 tabelas bloqueadas por unidade.');
        current.blockedTables.push(blocked);
      }
      if (style) current.style = style;
      if (unblocked) current.blockedTables = current.blockedTables.filter(table => table !== unblocked);
      await q.query('UPDATE ada.app_setting SET value=$2,updated_by=$3,updated_at=now() WHERE key=$1', [key, current, ctx.systemUserId]);
      await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'posso.regra_conversa_aplicada',
        targetType: 'app_setting', targetId: key, outcome: 'ok', details: blocked || unblocked
          ? { table: blocked ?? unblocked, blocked: Boolean(blocked) } : { styleChanged: true } });
    });
    return { text: `Regra aplicada. ${summary}`, confirmable: false };
  }
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
    const { blockedTables } = await this.conversationRules(ctx.activeUnitId);
    if(ctx.roles.includes('admin') && ctx.programs.AdaAdministracao) return {admin:true,tables:{},blockedTables};
    if(hasBusinessRead(ctx)) return {admin:false,businessRead:true,tables:{},blockedTables};
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
    return {admin:false,tables,blockedTables};
  }
}
