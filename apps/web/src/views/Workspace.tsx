import {PanelWidget,type Panel} from './LiveBoards.tsx';
import { useCallback,useEffect,useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useBranding } from '../branding.tsx';
import { Icon } from '../components/Icon.tsx';
import { DashboardCanvas } from '../components/DashboardCanvas.tsx';
import type { DashboardSpec,WidgetData } from '@ada/contracts';

interface Workspace {state:string;step:number;tasks:{label:string;state:string;message?:string}[];issues:string[];
  profile:{name:string;unit:string;role:string;title:string|null;teams:number;reports:number;programs:string[];documents:number;areas:string[]}|null;
  liveBoardId:string|null;dashboardId:string|null;conversationId:string|null;welcomePending?:boolean}

export function WorkspaceView() {
  const {me,navigate,theme}=useApp();const {name}=useBranding();
  const [workspace,setWorkspace]=useState<Workspace|null>(null);
  const [dashboard,setDashboard]=useState<{spec:DashboardSpec;data:WidgetData[]}|null>(null);
  const [operational,setOperational]=useState<Panel[]>([]);
  const [error,setError]=useState('');const [retrying,setRetrying]=useState(false);
  const load=useCallback(async()=>{
    try {setWorkspace(await api<Workspace>('/workspace'));setError('');}catch(e){setError((e as Error).message);}
  },[]);
  useEffect(()=>{let active=true;void load();const timer=window.setInterval(()=>{if(active&&document.visibilityState==='visible')void load();},4000);
    return()=>{active=false;window.clearInterval(timer);};},[load,me.activeUnit.id]);
  useEffect(()=>{let current=true;const id=workspace?.dashboardId;if(!id){setDashboard(null);return;}
    const refresh=async()=>{try{const [spec,data]=await Promise.all([api<{spec:DashboardSpec}>('/dashboards/'+id),api<{data:WidgetData[]}>('/dashboards/'+id+'/data')]);if(current)setDashboard({spec:spec.spec,data:data.data});}catch(e){if(current)setError((e as Error).message);}};
    void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30_000);
    return()=>{current=false;window.clearInterval(timer);};},[workspace?.dashboardId]);
  useEffect(()=>{if(!workspace?.welcomePending||!workspace.conversationId)return;
    window.dispatchEvent(new CustomEvent('possebon:welcome',{detail:{id:workspace.conversationId}}));
    void api('/workspace/welcome',{body:{}}).catch(()=>{});
  },[workspace?.welcomePending,workspace?.conversationId]);
  useEffect(()=>{let active=true;const id=workspace?.liveBoardId;if(!id){setOperational([]);return;}
    const refresh=()=>api<{panels:Panel[]}>('/live-boards/'+id+'/data').then(r=>{if(active)setOperational(r.panels);}).catch(e=>{if(active)setError((e as Error).message);});
    void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);return()=>{active=false;window.clearInterval(timer);};
  },[workspace?.liveBoardId]);
  const working=!workspace||['pending','running'].includes(workspace.state);
  const completed=workspace?.tasks.filter(t=>t.state==='done').length??0;
  const greeting=new Date().getHours()<12?'Bom dia':new Date().getHours()<18?'Boa tarde':'Boa noite';
  async function retry(restart=false){setRetrying(true);try{await api('/workspace/retry',{body:{restart}});await load();}catch(e){setError((e as Error).message);}finally{setRetrying(false);}}
  return <>
    <header className="topbar"><div className="page-heading grow"><span className="eyebrow">SEU ESPAÇO DE TRABALHO</span><h1>Visão geral</h1></div><span className="context-badge"><span className="status-dot" style={{background:'var(--accent)'}}/>{me.activeUnit.name}</span><button className="btn primary" onClick={()=>navigate('/?nova='+Date.now())}><Icon name="plus" size={17}/>Nova conversa</button></header>
    <main className="content workspace-content">
      <section className="welcome-strip"><div><div className="eyebrow">{me.activeUnit.name} · {workspace?.profile?.role??'Acesso confirmado'}</div><h2>{greeting}, {me.user.displayName.split(' ')[0]}.</h2><p>Seu trabalho, suas informações e os assuntos que precisam da sua atenção.</p></div><div className="assistant-presence"><span className="assistant-symbol"><Icon name="spark" size={22}/></span><div><strong>{name}</strong><span>{working?'Preparando seu ambiente':'Pronta para ajudar'}</span></div></div></section>
      {me.demoData&&<p className="note-box small">Ambiente de demonstração. Os indicadores abaixo usam dados fictícios.</p>}
      {error&&<div className="error-box" role="alert">{error}<button className="btn sm" onClick={()=>void load()}>Tentar novamente</button></div>}
      <section className="overview-cards" aria-label="Seu contexto confirmado">
        <article className="summary-card"><span className="summary-icon"><Icon name="shield"/></span><span>Áreas autorizadas</span><strong>{workspace?.profile?.programs.length??'—'}</strong><small>Permissões confirmadas no POSSEBON</small></article>
        <article className="summary-card"><span className="summary-icon"><Icon name="chart"/></span><span>Informações preparadas</span><strong>{completed}</strong><small>{working?'Validação em andamento':'Consultas conferidas para seu perfil'}</small></article>
        <article className="summary-card"><span className="summary-icon"><Icon name="brain"/></span><span>Conhecimento disponível</span><strong>{workspace?.profile?.documents??'—'}</strong><small>Documentos acessíveis na unidade</small></article>
        <article className="summary-card"><span className="summary-icon"><Icon name="home"/></span><span>Seu contexto</span><strong className="summary-text">{workspace?.profile?.title??workspace?.profile?.role??'Preparando'}</strong><small>{workspace?.profile?.teams?`${workspace.profile.teams} equipes vinculadas`:'Conforme seus acessos e vínculos'}</small></article>
      </section>
      <div className="workspace-columns"><section className="workspace-main">
        <div className="section-heading"><div><span className="eyebrow">INFORMAÇÕES DO SEU DIA</span><h2>Seu panorama</h2></div>{workspace?.dashboardId&&<button className="btn ghost sm" onClick={()=>navigate('/dashboards/'+workspace.dashboardId)}>Abrir dashboard<Icon name="arrow" size={16}/></button>}</div>
        {dashboard?<DashboardCanvas spec={dashboard.spec} data={dashboard.data} theme={theme}/>:operational.length?<div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))'}}>{operational.map((p,i)=><PanelWidget key={i} panel={p}/>)}</div>:<section className="card preparation-card" aria-busy={working}><span className="preparation-icon"><Icon name={working?'spark':'chart'} size={28}/></span><h3>{working?'Estou preparando seu ambiente':'Seu espaço está organizado'}</h3><p>{working?'Conferindo seus acessos e validando as informações úteis para você. Cada etapa concluída fica salva.':'Os indicadores aparecem quando as fontes estiverem conectadas e autorizadas para seu perfil. Você já pode conversar e consultar seus documentos.'}</p></section>}
        {workspace?.liveBoardId&&<button className="live-board-callout" onClick={()=>navigate('/telas/'+workspace.liveBoardId)}><span className="summary-icon"><Icon name="chart"/></span><span><strong>Panorama operacional</strong><small>Abra suas tabelas e indicadores com atualização automática.</small></span><Icon name="arrow"/></button>}
        <section className="card"><div className="section-heading"><h3>{working?'Preparação em andamento':'O que foi preparado'}</h3><span className="badge">{completed} de {workspace?.tasks.length??0}</span></div><progress className="preparation-progress" max={workspace?.tasks.length||1} value={completed} aria-label="Etapas concluídas"/><ul className="preparation-list">{workspace?.tasks.map((t,i)=><li key={i}><span className={'task-state '+t.state}><Icon name={t.state==='done'?'check':t.state==='error'?'close':'clock'} size={16}/></span><span>{t.label}{t.message&&<small>{t.message}</small>}</span></li>)}</ul>{workspace?.issues.map(issue=><p key={issue} className="small muted">{issue}</p>)}{workspace&&['partial','error'].includes(workspace.state)&&<button className="btn sm" disabled={retrying} onClick={()=>void retry()}>Tentar etapas pendentes</button>}</section>
      </section><aside className="workspace-aside">
        <section className="card assistant-card"><span className="assistant-symbol"><Icon name="spark" size={26}/></span><h3>O que vamos resolver?</h3><p>Faça uma pergunta, peça uma tela ou acompanhe um assunto importante para você.</p><button className="btn primary" onClick={()=>navigate(workspace?.conversationId?'/?c='+workspace.conversationId:'/?nova='+Date.now())}>{workspace?.conversationId?'Abrir minha primeira conversa':'Conversar agora'}<Icon name="arrow" size={16}/></button></section>
        <section className="card"><h3>Explore seu ambiente</h3><div className="quick-links">{[['/telas','Telas vivas','grid'],['/acompanhamentos','Acompanhamentos','clock'],['/memoria','Memória e preferências','settings'],['/estudo','Conhecimento disponível','brain']].map(([path,label,icon])=><button key={path} onClick={()=>navigate(path!)}><Icon name={icon!}/><span>{label}</span><Icon name="arrow" size={15}/></button>)}</div></section>
        <details className="card"><summary>Repetir a preparação inicial</summary><p className="small muted">Cria uma nova visão e uma conversa de boas-vindas. Suas conversas e telas anteriores são preservadas.</p><button className="btn sm" disabled={retrying||working} onClick={()=>void retry(true)}>Preparar meu ambiente novamente</button></details>
      </aside></div>
    </main>
  </>;
}
