export const isProtectedTable=(name:string)=>/^(system_|ada_|log_|audit_|migration|pg_|auth|oauth|session|sso_|user_session|users?$|usuarios?$|usuario_senha|senha|credential|credencial|token|password|api_key|permission|permissao|perfil_acesso)/i.test(name);
export interface UnitRelation{from_table:string;from_col:string;to_table:string;to_col:string}
/** Somente dependências de FK de saída; caminhos ambíguos exigem mapeamento explícito. */
export function findUnitPath(table:string,columns:Map<string,Map<string,string>>,relations:UnitRelation[]):UnitRelation[]|null{
  if(columns.get(table)?.has('unit_id'))return [];
  const queue:{table:string;path:UnitRelation[];seen:Set<string>}[]=[{table,path:[],seen:new Set([table])}];
  const found:UnitRelation[][]=[];
  while(queue.length){const current=queue.shift()!;if(current.path.length>=3)continue;
    for(const fk of relations.filter(r=>r.from_table===current.table)){
      if(current.seen.has(fk.to_table)||!columns.get(fk.from_table)?.has(fk.from_col)||!columns.get(fk.to_table)?.has(fk.to_col))continue;
      const path=[...current.path,fk];
      if(columns.get(fk.to_table)?.has('unit_id')){found.push(path);if(found.length>1)return null;}
      else queue.push({table:fk.to_table,path,seen:new Set([...current.seen,fk.to_table])});
    }
  }
  return found.length===1?found[0]!:null;
}
export function unitPredicate(table:string,alias:string,columns:Map<string,Map<string,string>>,relations:UnitRelation[],quote:(s:string)=>string,param:string):string{
  const path=findUnitPath(table,columns,relations);
  if(!path)throw new Error('Tabela sem caminho único de unidade por FK verificada: '+table+'. É necessário mapear o vínculo de unidade.');
  if(!path.length)return alias+'.unit_id = '+param;
  const parts:string[]=[];let prior=alias;
  const joins:string[]=[];
  path.forEach((fk,i)=>{const next=alias+'_u'+i;joins.push((i?'JOIN ':'')+'public.'+quote(fk.to_table)+' '+next+(i?' ON '+prior+'.'+quote(fk.from_col)+' = '+next+'.'+quote(fk.to_col):''));
    if(i===0)parts.push(prior+'.'+quote(fk.from_col)+' = '+next+'.'+quote(fk.to_col));
    if(columns.get(fk.to_table)?.has('deletado_em'))parts.push(next+'.deletado_em IS NULL');
    if(columns.get(fk.to_table)?.has('deleted_at'))parts.push(next+'.deleted_at IS NULL');
    prior=next;
  });
  parts.push(prior+'.unit_id = '+param);
  return 'EXISTS (SELECT 1 FROM '+joins.join(' ')+' WHERE '+parts.join(' AND ')+')';
}
