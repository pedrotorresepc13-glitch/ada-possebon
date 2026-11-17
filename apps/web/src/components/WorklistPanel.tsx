import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Panel } from '../views/LiveBoards.tsx';

echarts.use([PieChart, TooltipComponent, AriaComponent, SVGRenderer]);

type Row = Record<string, string | number | boolean | null>;
interface Fields {
  id:string;status:string;subject:string;description?:string;priority?:string;
  createdAt?:string;updatedAt?:string;product?:string;category?:string;
}
type Worklist = NonNullable<Panel['worklist']>;
const normalize = (value:unknown) => String(value??'').trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const value = (row:Row,key?:string) => key ? String(row[key]??'').trim() : '';
const palette = ['#2563eb','#f59e0b','#84cc16','#8b5cf6','#ef4444','#64748b','#06b6d4','#c084fc'];
const rank=(status:string) => {
  const s=normalize(status);
  if(/abert|novo|pendente|backlog/.test(s))return 0;
  if(/andamento|atendimento|execuc|tratamento|progresso/.test(s))return 1;
  if(/aguard|espera/.test(s))return 2;
  if(/vencid|atras/.test(s))return 3;
  if(/rejeit|cancel/.test(s))return 4;
  if(/fech|finaliz|conclu|resolvid/.test(s))return 5;
  return 6;
};
const tone=(status:string)=>palette[rank(status)]??palette[7]!;
const isActive=(status:string)=>rank(status)<=1;
const highPriority=(priority:string)=>/critic|alta|alto|urgente|prioritar|p1\b|p0\b/.test(normalize(priority));
const shortDate=(raw:string)=> {
  if(!raw)return '';
  const date=new Date(raw);
  return Number.isNaN(date.getTime())?raw:
    new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'America/Sao_Paulo'}).format(date);
};
const titleText=(s:string)=>s.length>130?s.slice(0,127)+'…':s;

function Distribution({statuses,onPick}:{statuses:{name:string;count:number;color:string}[];onPick:(name:string)=>void}) {
  const node=useRef<HTMLDivElement>(null);
  const onPickRef=useRef(onPick);
  useEffect(()=>{onPickRef.current=onPick},[onPick]);
  useEffect(()=>{
    if(!node.current||!statuses.length)return;
    const chart=echarts.init(node.current,undefined,{renderer:'svg'});
    chart.setOption({
      tooltip:{trigger:'item',formatter:'{b}: {c} ({d}%)'},
      aria:{enabled:true},
      series:[{name:'Situação',type:'pie',radius:['58%','80%'],center:['50%','50%'],
        label:{show:false},labelLine:{show:false},
        data:statuses.map(s=>({name:s.name,value:s.count,itemStyle:{color:s.color}}))}]
    });
    chart.on('click',params=>{
      if(typeof params.name==='string')onPickRef.current(params.name);
    });
    const resize=new ResizeObserver(()=>chart.resize());resize.observe(node.current);
    return()=>{resize.disconnect();chart.dispose()};
  },[statuses]);
  return <div className="posso-worklist-chart" ref={node} role="img" aria-label="Distribuição de registros por situação"/>;
}

/** Uma central interativa, não uma coleção de gráficos e tabelas desconectados. */
export function WorklistPanel({panel}:{panel:Panel}) {
  const cfg=panel.worklist as Worklist;
  const f:Fields=cfg.fields;
  const rows=panel.rows as Row[];
  const statuses=useMemo(()=>{
    const groups=new Map<string,{name:string;count:number;color:string}>();
    for(const row of rows){
      const status=value(row,f.status)||'Não informado';
      const k=normalize(status);
      const previous=groups.get(k);
      if(previous)previous.count++;
      else groups.set(k,{name:status,count:1,color:tone(status)});
    }
    return [...groups.values()].sort((a,b)=>rank(a.name)-rank(b.name)||b.count-a.count);
  },[rows,f.status]);
  const initial=useMemo(()=>{
    const explicit=cfg.defaultStatuses.map(normalize);
    const selected=statuses.filter(s=>explicit.length
      ? explicit.includes(normalize(s.name)):isActive(s.name)).map(s=>s.name);
    return selected.length?selected:null;
  },[cfg.defaultStatuses,statuses]);
  const [selection,setSelection]=useState<{all:boolean;values:string[]}|null>(null);
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<'attention'|'recent'|'oldest'>('attention');
  const [expanded,setExpanded]=useState('');
  const [visible,setVisible]=useState(8);
  useEffect(()=>{setSelection(null);setExpanded('');setVisible(8)},[panel.title,f.status]);
  const selected=selection??{all:initial===null,values:initial??[]};
  const showAll=selected.all;
  const setSingle=(status:string)=>{
    setSelection(current=>{
      const source=current??{all:initial===null,values:initial??[]};
      const values=source.all?[]:source.values;
      const present=values.some(x=>normalize(x)===normalize(status));
      const next=present?values.filter(x=>normalize(x)!==normalize(status)):[...values,status];
      return next.length?{all:false,values:next}:{all:true,values:[]};
    });
    setVisible(8);
  };
  const filtered=useMemo(()=>rows.filter(row=>{
    const status=value(row,f.status);
    if(!showAll&&!selected.values.some(s=>normalize(s)===normalize(status)))return false;
    if(!search.trim())return true;
    const q=normalize(search);
    return [f.id,f.subject,f.description,f.priority,f.product,f.category,f.status]
      .some(field=>field&&normalize(value(row,field)).includes(q));
  }).sort((a,b)=>{
    if(sort==='attention'){
      const importance=Number(highPriority(value(b,f.priority)))-Number(highPriority(value(a,f.priority)));
      if(importance)return importance;
      const priority=rank(value(a,f.status))-rank(value(b,f.status));
      if(priority)return priority;
    }
    const timestamp=(row:Row)=>Date.parse(value(row,f.updatedAt??f.createdAt))||0;
    return sort==='recent'?timestamp(b)-timestamp(a):timestamp(a)-timestamp(b);
  }),[rows,showAll,selected.values,search,sort,f]);
  const activeCount=rows.filter(row=>isActive(value(row,f.status))).length;
  const urgentCount=rows.filter(row=>highPriority(value(row,f.priority))&&isActive(value(row,f.status))).length;
  const waitingCount=rows.filter(row=>rank(value(row,f.status))===2).length;

  if(panel.status!=='ok')return <section className="posso-worklist" role="alert">
    Não foi possível atualizar a central de trabalho. {panel.message??''}
  </section>;

  return <section className="posso-worklist" aria-label={panel.title}>
    <header className="posso-worklist-heading">
      <div><span className="posso-worklist-overline">CENTRAL DE TRABALHO</span><h2>{panel.title}</h2>
        <p>Prioridades, situações e detalhes em uma única visão.</p></div>
      <span className="posso-worklist-count">{rows.length} carregados</span>
    </header>
    <div className="posso-worklist-kpis">
      <div><span>Demandas ativas</span><strong>{activeCount}</strong></div>
      <div><span>Prioridade alta</span><strong>{f.priority?urgentCount:'—'}</strong></div>
      <div><span>Aguardando</span><strong>{waitingCount}</strong></div>
      <div><span>Registros carregados</span><strong>{rows.length}</strong></div>
    </div>
    <div className="posso-worklist-overview">
      <Distribution statuses={statuses} onPick={setSingle}/>
      <div className="posso-worklist-distribution">
        <h3>Distribuição por situação</h3>
        <p>Selecione uma ou mais situações para explorar a fila.</p>
        <div className="posso-worklist-statuses" aria-label="Filtros de situação">
          <button className={showAll?'selected':''} onClick={()=>{setSelection({all:true,values:[]});setVisible(8)}} aria-pressed={showAll}>
            Todos <b>{rows.length}</b>
          </button>
          {statuses.map(s=>{
            const pressed=!showAll&&selected.values.some(v=>normalize(v)===normalize(s.name));
            return <button key={s.name} className={pressed?'selected':''}
              onClick={()=>setSingle(s.name)} aria-pressed={pressed}>
              <i style={{background:s.color}} aria-hidden="true"/>{s.name} <b>{s.count}</b>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="posso-worklist-list">
      <div className="posso-worklist-toolbar">
        <div><h3>Fila de trabalho</h3><p>{filtered.length} resultado(s) na seleção atual</p></div>
        <div className="posso-worklist-controls">
          <input type="search" value={search} onChange={event=>{setSearch(event.target.value);setVisible(8)}}
            placeholder="Buscar número, assunto ou descrição" aria-label="Buscar registros"/>
          <select aria-label="Ordenar registros" value={sort} onChange={event=>setSort(event.target.value as typeof sort)}>
            <option value="attention">Prioridades primeiro</option>
            <option value="oldest">Mais antigos</option>
            <option value="recent">Mais recentes</option>
          </select>
        </div>
      </div>
      {!filtered.length && <div className="posso-worklist-empty">Nenhum registro corresponde aos filtros.</div>}
      {filtered.slice(0,visible).map((row,i)=>{
        const id=value(row,f.id)||String(i+1);
        const status=value(row,f.status)||'Não informado';
        const subject=value(row,f.subject)||'Assunto não informado';
        const priority=value(row,f.priority);
        const description=value(row,f.description);
        const key=id+'-'+i;
        const isExpanded=expanded===key;
        const date=shortDate(value(row,f.updatedAt??f.createdAt));
        return <article key={key} className="posso-worklist-item">
          <button className="posso-worklist-item-main" onClick={()=>setExpanded(isExpanded?'':key)}
            aria-expanded={isExpanded} aria-label={'Ver detalhes do registro '+id}>
            <span className="posso-worklist-id">#{id}</span>
            <span className="posso-worklist-subject"><strong>{titleText(subject)}</strong>
              {description&&normalize(description)!==normalize(subject)&&
                <small>{description.length>135?description.slice(0,132)+'…':description}</small>}</span>
            <span className="posso-worklist-status" style={{borderColor:tone(status),color:tone(status)}}>{status}</span>
            {priority&&<span className={'posso-worklist-priority'+(highPriority(priority)?' urgent':'')}>{priority}</span>}
            {date&&<span className="posso-worklist-date">{date}</span>}
            <span className="posso-worklist-chevron" aria-hidden="true">{isExpanded?'⌃':'⌄'}</span>
          </button>
          {isExpanded&&<div className="posso-worklist-details">
            <div><b>Assunto</b><p>{subject}</p></div>
            {description&&<div><b>Descrição</b><p>{description}</p></div>}
            {f.product&&<div><b>Produto</b><p>{value(row,f.product)||'Não informado'}</p></div>}
            {f.category&&<div><b>Categoria</b><p>{value(row,f.category)||'Não informado'}</p></div>}
            {f.createdAt&&<div><b>Abertura</b><p>{shortDate(value(row,f.createdAt))||'Não informado'}</p></div>}
            {f.updatedAt&&<div><b>Última movimentação</b><p>{date||'Não informado'}</p></div>}
          </div>}
        </article>;
      })}
      {visible<filtered.length&&<button className="posso-worklist-more" onClick={()=>setVisible(n=>n+12)}>
        Mostrar mais {Math.min(12,filtered.length-visible)} registros
      </button>}
      {panel.rowCount>=200&&<p className="posso-worklist-note">A consulta atingiu o limite de 200 registros. Refine os filtros para analisar os demais.</p>}
    </div>
  </section>;
}
