import {useEffect,useState} from 'react';
import {api} from '../api.ts';
import {useApp} from '../app-context.ts';
interface Catalog{sourceState:string;totalTables:number;matchingTables:number;matchingReferences:number;page:number;hasMore:boolean;programs:string[];referenceCounts:{models:number;screens:number;modules:number};graphTruncated:boolean;
 tables:{name:string;area:string;columns:number;queryable:boolean;unitVerified:boolean;approvedCodeDefinitions:number;lastRead:{at:string;scope:string}|null}[];
 references:{kind:string;label:string;source_ref:string;snapshot:string|null}[]}
interface Profile{table:string;liveMetadataAvailable:boolean;guide:{checks:string[]};coverage:{documentMatches:number;approvedCodes:number;allRulesValidated:boolean};
 references:{kind:string;label:string;title:string|null;table_name:string|null;defaults:string|null;source_ref:string}[];
 structure:{colunas:{nome:string;tipo:string}[]}|null;lastRead:{at:string;scope:string}|null;note:string}
interface BrainCoverage { modelCalls:number; operationalSource:string; indexedDocuments:number; catalogTruncated:boolean; discoveredDomainCount:number; unclassifiedTableCount:number; discoveredDomains:{id:string;name:string;indexedDocuments:number;availableSources:number;coverage:string}[]; unclassifiedTables:string[]; areas:{id:string;name:string;indexedDocuments:number;authorizedTables:number;coverage:string}[] }
export function SystemKnowledge(){
 const {me}=useApp();const [text,setText]=useState('');const [term,setTerm]=useState('');const [page,setPage]=useState(0);const [refresh,setRefresh]=useState(0);
 const [coverage,setCoverage]=useState<BrainCoverage|null>(null);
 const [data,setData]=useState<Catalog|null>(null);const [detail,setDetail]=useState<Profile|null>(null);const [selected,setSelected]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');void api<Catalog>('/system-knowledge?q='+encodeURIComponent(term)+'&page='+page).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[term,page,refresh,me.activeUnit.id]);
 useEffect(()=>{let active=true;void api<BrainCoverage>('/brain/coverage').then(r=>{if(active)setCoverage(r);}).catch(()=>{if(active)setCoverage(null);});return()=>{active=false;};},[refresh,me.activeUnit.id]);
 useEffect(()=>{let active=true;setDetail(null);if(selected)void api<Profile>('/system-knowledge/module?table='+encodeURIComponent(selected)).then(r=>{if(active)setDetail(r);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[selected,me.activeUnit.id]);
 return <section className="card" aria-label="Conhecimento de todo o sistema">
  <h2>Conhecimento de todo o sistema</h2>
  <p className="muted small">Inventário autorizado de estruturas, telas, modelos e fontes. Inclui módulos fora das áreas editoriais. Estrutura descoberta, regras documentadas e leitura real são verificações diferentes.</p>
  {coverage&&<details><summary>Cobertura viva do cérebro: {coverage.indexedDocuments} documentos autorizados · {coverage.areas.length + (coverage.discoveredDomainCount ?? 0)} áreas identificadas · sem consumo de tokens</summary>
   <p className="muted small">Esta visão mostra documentação e tabelas acessíveis. Não mede saúde da empresa nem afirma que todo processo foi compreendido.</p>
   <ul className="list">{coverage.areas.map(a=><li className="list-item" key={a.id}><span><strong>{a.name}</strong><span className="muted small"> · {a.indexedDocuments} documentos · {a.authorizedTables} tabelas identificadas · {a.coverage.replaceAll('_',' ')}</span></span></li>)}</ul>
   {(coverage.discoveredDomains?.length??0)>0&&<details><summary>Outros domínios descobertos ({coverage.discoveredDomainCount})</summary><ul className="list">{coverage.discoveredDomains.map(d=><li className="list-item" key={d.id}><strong>{d.name}</strong><span className="muted small">{d.indexedDocuments} documentos · {d.availableSources} fontes</span></li>)}</ul></details>}
   {(coverage.unclassifiedTableCount??0)>0&&<details><summary>Tabelas ainda sem classificação ({coverage.unclassifiedTableCount})</summary><ul className="list">{coverage.unclassifiedTables.map(t=><li key={t} className="list-item"><span>{t}</span><button className="btn" type="button" onClick={()=>setSelected(t)}>Inspecionar</button></li>)}</ul></details>}
   {coverage.operationalSource!=='available'&&<p className="note-box">O esquema operacional não pôde ser verificado nesta sessão; a ausência de tabelas aqui não prova falta de dados.</p>}
   {coverage.catalogTruncated&&<p className="note-box">Acervo acima do limite de listagem: cobertura documental parcial.</p>}
  </details>}
  <form className="row" onSubmit={e=>{e.preventDefault();setSelected('');setTerm(text.trim());setPage(0);setRefresh(r=>r+1);}}>
   <label className="field grow">Pesquisar no sistema<input className="input" maxLength={120} value={text} onChange={e=>setText(e.target.value)} placeholder="RDO, AUDCOMP, ronda, compras ou outro módulo"/></label>
   <button className="btn" type="submit">Pesquisar e atualizar</button>
  </form>
  {error&&<p className="error-box" role="alert">{error}</p>}
  {!data&&!error?<p role="status">Conferindo as estruturas autorizadas...</p>:data&&<>
   <p>{data.totalTables} tabelas acessíveis no catálogo · {data.referenceCounts.screens} referências de telas · {data.referenceCounts.models} modelos · {data.programs.length} programas autorizados</p>
   {data.sourceState!=='available'&&<p className="note-box">Não foi possível conferir o esquema operacional agora. As referências importadas continuam listadas; elas não comprovam que o módulo esteja conectado.</p>}
   {data.graphTruncated&&<p className="note-box">O inventário de referências excedeu o limite desta revisão. A cobertura exibida é parcial.</p>}
   <ul className="list">{data.tables.map(t=><li className="list-item" key={t.name}><div><strong>{t.name.replaceAll('_',' ')}</strong><div className="muted small">{t.area} · {t.columns} campos · {t.approvedCodeDefinitions} códigos homologados</div><div className="muted small">{t.lastRead?'Última leitura real: '+new Date(t.lastRead.at).toLocaleString('pt-BR'):'Registros ainda sem leitura validada nesta cobertura.'} {!t.unitVerified&&'Vínculo de unidade não confirmado.'} {!t.queryable&&'Requer mapeamento autorizado para este perfil.'}</div></div><button className="btn" onClick={()=>setSelected(t.name)}>Ver estrutura de {t.name.replaceAll('_',' ')}</button></li>)}</ul>
   {!data.tables.length&&<p>Nenhuma tabela correspondente no esquema acessível desta consulta.</p>}
   <details><summary>Referências do inventário: {data.matchingReferences} correspondências</summary><ul>{data.references.map((r,i)=><li key={r.kind+':'+r.label+':'+i}>{r.label} · {r.kind}<div className="muted small">{r.source_ref} · revisão {r.snapshot??'não informada'}</div></li>)}</ul></details>
   <div className="row"><button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page+1}</span><button className="btn" disabled={!data.hasMore} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
  </>}
  {selected&&!detail&&!error&&<p role="status">Conferindo {selected}...</p>}
  {detail&&<article className="card"><h3>{detail.table.replaceAll('_',' ')}</h3><p>{detail.liveMetadataAvailable?'Estrutura conferida na conexão atual.':'Estrutura operacional ainda não confirmada.'} {detail.coverage.documentMatches} correspondências documentais · {detail.coverage.approvedCodes} códigos homologados.</p>
   <p className="muted small">O roteiro abaixo orienta a investigação; não comprova as regras locais nem a existência de todos esses campos.</p><ul>{detail.guide.checks.map(c=><li key={c}>{c}</li>)}</ul>
   <details><summary>Telas vinculadas e valores iniciais declarados</summary><ul>{detail.references.filter(r=>r.kind==='tela'&&r.table_name===detail.table).map(r=><li key={r.source_ref}>{r.title??r.label}<div className="muted small">{r.source_ref}{r.defaults&&r.defaults!=='[]'?' · Valores iniciais: '+r.defaults:''}</div></li>)}</ul><p className="muted small">Valores iniciais do formulário não representam todos os filtros ou regras de transição.</p></details>
   <details><summary>Campos disponíveis</summary><ul>{detail.structure?.colunas.map(c=><li key={c.nome}>{c.nome} · {c.tipo}</li>)}</ul></details><p className="muted small">{detail.note}</p></article>}
 </section>;
}
