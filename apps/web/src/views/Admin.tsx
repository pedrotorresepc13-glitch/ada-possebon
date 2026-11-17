import { OperationalSettings } from '../components/OperationalSettings.tsx';
import { BrandingSettings } from '../components/BrandingSettings.tsx';
import { useBranding } from '../branding.tsx';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatDateTime } from '@ada/domain/format';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import { ChatView } from './Chat.tsx';

const TABS = [
  ['regras-chat', 'Chat administrativo'],
  ['saude', 'Saúde'],
  ['identidade', 'Identidade'],
  ['conhecimento', 'Fontes de conhecimento'],
  ['conectores', 'Conectores'],
  ['email', 'E-mail'],
  ['ia', 'IA e custos'],
  ['acessos', 'Acessos operacionais'],
  ['politicas', 'Políticas'],
  ['auditoria', 'Auditoria']
] as const;

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    api<T>(path).then(setData).catch((e) => setErr((e as Error).message));
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, err, reload, setErr };
}

function Status({ s }: { s: string }) {
  const cls = ['ativo', 'indexado', 'ok', 'demonstracao'].includes(s) ? 'good' : ['erro', 'rejeitado'].includes(s) ? 'crit' : ['degradado', 'revisando', 'configurado_nao_validado'].includes(s) ? 'warn' : '';
  return <span className={`badge ${cls}`}>{s.replace(/_/g, ' ')}</span>;
}

function Kv({ obj }: { obj: Record<string, unknown> }) {
  return (
    <table className="data"><tbody>
      {Object.entries(obj).map(([k, v]) => (
        <tr key={k}><th scope="row" style={{ width: '40%' }}>{k.replace(/_/g, ' ')}</th><td>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</td></tr>
      ))}
    </tbody></table>
  );
}

function Health() {
  const { data, err, reload } = useLoad<Record<string, Record<string, unknown> | boolean | string>>('/admin/health');
  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  const worker = data.worker as { alive: boolean; instances: { worker_id: string; last_beat_at: string }[] };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      <section className="card"><h3>Banco</h3><Kv obj={data.database as Record<string, unknown>} /></section>
      <section className="card">
        <h3>Worker {worker.alive ? <span className="badge good">ativo</span> : <span className="badge crit">sem batimento recente</span>}</h3>
        {worker.instances.length === 0 ? <p className="muted">Nenhum worker registrado. Inicie apps/worker.</p> : worker.instances.map((w) => <div key={w.worker_id} className="small">{w.worker_id} — último batimento {formatDateTime(w.last_beat_at)}</div>)}
      </section>
      <section className="card"><h3>Filas</h3><Kv obj={data.queues as Record<string, unknown>} /></section>
      <section className="card"><h3>Acompanhamentos</h3><Kv obj={data.monitors as Record<string, unknown>} /></section>
      <section className="card"><h3>IA (24 h)</h3><Kv obj={data.ai as Record<string, unknown>} /></section>
      <section className="card"><h3>Identidade POSSEBON</h3><Kv obj={data.identity as Record<string, unknown>} /><p className="small muted">Ambiente: {String(data.environment)} · dados sintéticos: {data.demoData ? 'sim' : 'não'}</p></section>
      <div><button className="btn sm" onClick={reload}>↻ Atualizar</button></div>
    </div>
  );
}

interface Doc { id: string; title: string; source_name: string; status: string; scope: string; unit_id: number | null; sensitivity: string; injection_flags: string[]; error: string | null; chunks: number; created_at: string; checksum: string }

function Knowledge() {
  const { name } = useBranding();
  const { me } = useApp();
  const sources = useLoad<{ id: string; name: string; kind: string; scope: string; unit_id: number | null; documents: number }[]>('/admin/knowledge/sources');
  const docs = useLoad<Doc[]>('/admin/knowledge/documents');
  const cov = useLoad<{ byStatus: { status: string; n: number }[] }>('/admin/knowledge/coverage');
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (review) dlg.current?.showModal(); }, [review]);
  const refresh = () => (sources.reload(), docs.reload(), cov.reload());
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg(ok); refresh(); } catch (e) { setMsg('Erro: ' + (e as Error).message); }
  };

  return (
    <div className="grid">
      {msg && <div className="note-box" role="status">{msg}</div>}
      <section className="card">
        <h3>Nova fonte</h3>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const scope = String(f.get('scope'));
          void run(() => api('/admin/knowledge/sources', { body: {
            kind: String(f.get('kind')), name: String(f.get('name')), scope, sensitivity: String(f.get('sens')),
            ...(scope === 'unidade' ? { unit_id: me.activeUnit.id } : {}), ...(scope === 'dominio' ? { domain: String(f.get('domain') || 'geral') } : {})
          } }), 'Fonte criada.');
          e.currentTarget.reset();
        }}>
          <input name="name" className="input" style={{ maxWidth: 260 }} placeholder="Nome (ex.: Políticas de RH)" required />
          <select name="kind" className="select" style={{ maxWidth: 150 }}><option value="upload">Documentos</option><option value="url">Site / URL</option><option value="manual">Manual</option></select>
          <select name="scope" className="select" style={{ maxWidth: 210 }}><option value="global">Corporativo (global)</option><option value="unidade">Somente {me.activeUnit.name}</option><option value="dominio">Domínio/módulo</option></select>
          <input name="domain" className="input" style={{ maxWidth: 150 }} placeholder="domínio (ex.: rh)" />
          <select name="sens" className="select" style={{ maxWidth: 150 }}><option value="interno">Interno</option><option value="publico">Público</option><option value="restrito">Restrito</option></select>
          <button className="btn primary">Criar</button>
        </form>
      </section>
      <section className="card">
        <h3>Enviar documentos ou importar URL</h3>
        <div className="row">
          <select className="select" style={{ maxWidth: 320 }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Fonte de destino">
            <option value="">Escolha a fonte…</option>
            {sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.scope}{s.unit_id ? ` ${s.unit_id}` : ''}) — {s.documents} doc.</option>)}
          </select>
          <input type="file" multiple accept=".txt,.md,.csv,.json,.html,.htm,.pdf,.docx,.xlsx" disabled={!sel} aria-label="Arquivos"
            onChange={(e) => {
              const files = e.target.files;
              if (!files?.length) return;
              const form = new FormData();
              for (const f of Array.from(files)) form.append('file', f, f.name);
              void run(() => api(`/admin/knowledge/sources/${sel}/upload`, { form }), `${files.length} arquivo(s) enviados para a fila de estudo.`);
              e.target.value = '';
            }} />
        </div>
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => {
          e.preventDefault();
          const url = String(new FormData(e.currentTarget).get('url'));
          void run(() => api(`/admin/knowledge/sources/${sel}/url`, { body: { url } }), 'URL na fila. A coleta respeita robots.txt e bloqueia endereços internos.');
        }}>
          <input name="url" type="url" className="input grow" placeholder="https://www.site-institucional.com.br/pagina" disabled={!sel} required />
          <button className="btn" disabled={!sel}>Importar URL</button>
        </form>
        <p className="muted small">Formatos estudados hoje: TXT, MD, CSV, JSON, HTML. PDF/DOCX/XLSX/OCR entram na fila e ficam em erro explícito até o extrator ser instalado. Conteúdo de documentos é tratado como dado, nunca como instrução para a {name}.</p>
      </section>
      <section className="card">
        <div className="row"><h3 className="grow">Fila de estudo</h3>{cov.data?.byStatus.map((s) => <span key={s.status} className="small">{s.status}: <strong>{s.n}</strong></span>)}<button className="btn sm" onClick={refresh}>↻</button></div>
        {!docs.data ? <div className="skeleton" style={{ height: 60 }} /> : docs.data.length === 0 ? <p className="muted">Nenhum documento.</p> : (
          <div style={{ overflow: 'auto' }}>
            <table className="data">
              <thead><tr><th>Documento</th><th>Fonte</th><th>Status</th><th>Escopo</th><th>Trechos</th><th>Alertas</th><th /></tr></thead>
              <tbody>
                {docs.data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}<div className="muted small">{formatDateTime(d.created_at)} · {d.checksum.slice(0, 10)}…</div></td>
                    <td>{d.source_name}</td>
                    <td><Status s={d.status} />{d.error && <div className="small" style={{ color: 'var(--critical)' }}>{d.error}</div>}</td>
                    <td>{d.scope}{d.unit_id ? ` (${d.unit_id})` : ''} · {d.sensitivity}</td>
                    <td className="num">{d.chunks}</td>
                    <td>{d.injection_flags.length ? <span className="badge warn" title={d.injection_flags.join(', ')}>⚠ possível instrução embutida</span> : '—'}</td>
                    <td className="row">
                      {d.status === 'revisando' && <button className="btn sm" onClick={async () => setReview(await api(`/admin/knowledge/documents/${d.id}`))}>Revisar</button>}
                      {['erro', 'rejeitado', 'indexado'].includes(d.status) && <button className="btn ghost sm" onClick={() => void run(() => api(`/admin/knowledge/documents/${d.id}/reprocess`, { body: {} }), 'Reprocessamento agendado.')}>Reprocessar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <dialog ref={dlg} onClose={() => setReview(null)} aria-labelledby="rev-title">
        {review && (
          <div className="dialog-body">
            <h2 id="rev-title" style={{ margin: 0, fontSize: 16 }}>Revisar: {String(review.title)}</h2>
            {(review.injection_flags as string[]).length > 0 && <div className="error-box">Sinais de instrução embutida: {(review.injection_flags as string[]).join('; ')}. O conteúdo será usado só como dado citável; avalie se deve ser aprovado.</div>}
            <pre className="code">{String(review.extracted_preview ?? '')}</pre>
            <div className="row">
              <button className="btn primary" onClick={() => void run(() => api(`/admin/knowledge/documents/${review.id}/review`, { body: { decision: 'aprovar' } }), 'Documento aprovado e indexado.').then(() => dlg.current?.close())}>Aprovar e indexar</button>
              <button className="btn danger" onClick={() => void run(() => api(`/admin/knowledge/documents/${review.id}/review`, { body: { decision: 'rejeitar', note: window.prompt('Motivo da rejeição:') ?? undefined } }), 'Documento rejeitado.').then(() => dlg.current?.close())}>Rejeitar</button>
              <button className="btn" onClick={() => dlg.current?.close()}>Fechar</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Connectors() {
  const { name } = useBranding();
  const { data, err, reload } = useLoad<{ id: string; label: string; kind: string; status: string; last_check_at: string | null; last_error: string | null; allowed_operations: string[] }[]>('/admin/connectors');
  const [msg, setMsg] = useState('');
  if (err) return <div className="error-box">{err}</div>;
  return (
    <section className="card">
      <p className="muted small">Um conector só fornece dados quando está “ativo” (validado) ou “demonstração” (sintético, fora de produção). Integrações sem credencial aparecem como “não configurado” — a {name} não finge conexões.</p>
      {msg && <div className="note-box" role="status">{msg}</div>}
      <table className="data">
        <thead><tr><th>Conector</th><th>Status</th><th>Operações permitidas</th><th>Última verificação</th><th /></tr></thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id}>
              <td>{c.label}<div className="muted small">{c.id} · {c.kind}</div></td>
              <td><Status s={c.status} />{c.last_error && <div className="small" style={{ color: 'var(--warning)' }}>{c.last_error}</div>}</td>
              <td className="small">{c.allowed_operations.join(', ') || '—'}</td>
              <td className="small">{c.last_check_at ? formatDateTime(c.last_check_at) : '—'}</td>
              <td className="row">
                <button className="btn sm" onClick={async () => { const r = await api<{ ok: boolean; message: string }>(`/admin/connectors/${c.id}/test`, { body: {} }); setMsg(`${c.id}: ${r.message}`); reload(); }}>Testar</button>
                {c.status === 'demonstracao' && <button className="btn ghost sm" onClick={async () => { await api(`/admin/connectors/${c.id}/status`, { body: { status: 'desabilitado' } }); reload(); }}>Desabilitar</button>}
                {c.status === 'desabilitado' && c.id.startsWith('demo.') && <button className="btn ghost sm" onClick={async () => { await api(`/admin/connectors/${c.id}/status`, { body: { status: 'demonstracao' } }); reload(); }}>Reabilitar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Email() {
  const { me } = useApp();
  const [kind,setKind] = useState<'email_graph'|'email_imap'|'email_gmail'>('email_graph');
  const [purpose,setPurpose] = useState<'institutional'|'posso'>('institutional');
  const { data, reload } = useLoad<{
    id:string;label:string;kind:string;status:string;hasSecret:boolean;unitId:number;
    lastTestResult:string|null;lastSyncAt:string|null;sync:string;sending:string;
    sendingEnabled:boolean;config:{graph_sync?:boolean;auth_mode?:string;mailbox?:string;purpose?:string;tenant?:string};
    allowedUserIds:number[];allowedGroupIds:number[];
  }[]>('/admin/email/accounts');
  const {data:drafts,reload:reloadDrafts}=useLoad<{
    id:string;accountId:string;to:string[];subject:string;body:string;status:string;
  }[]>('/email/drafts');
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState('');
  const [mailboxChoice,setMailboxChoice]=useState('');
  const [configuringId,setConfiguringId]=useState('');
  const [tenantDraft,setTenantDraft]=useState('');
  const [draftTo,setDraftTo]=useState('');
  const [draftSubject,setDraftSubject]=useState('');
  const [draftBody,setDraftBody]=useState('');

  const accountOptions=(data??[]).filter(a=>a.unitId===me.activeUnit.id&&
    a.kind==='email_graph'&&a.config.auth_mode==='app_only');
  const execute=async (key:string,task:()=>Promise<void>)=>{
    setBusy(key);setMsg('');
    try{await task();reload();reloadDrafts();}
    catch(e){setMsg('Não foi possível concluir: '+(e as Error).message);}
    finally{setBusy('');}
  };

  return <div className="grid" style={{gap:18}}>
    {msg&&<div className="note-box" role="status">{msg}</div>}

    <section className="card">
      <h2>Integração Microsoft 365 — POSSO</h2>
      <p className="muted">Cadastre separadamente as caixas institucionais e o e-mail do próprio POSSO. A leitura e o envio usam a identidade de cada caixa, sempre na unidade ativa.</p>
      <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>
        <div className="note-box" style={{margin:0}}>
          <strong>Correspondência institucional — Petrobras</strong>
          <p>Caixa utilizada para a comunicação oficial do Consórcio EPC13, com acesso apenas aos usuários autorizados.</p>
          <code>consorcioepc13@consorcioepc13.com.br</code>
        </div>
        <div className="note-box" style={{margin:0}}>
          <strong>Identidade de e-mail do POSSO</strong>
          <p>Caixa própria para receber mensagens, criar comunicações e enviar como POSSO. O endereço definitivo será informado pela TI.</p>
          <span>Separada da caixa institucional</span>
        </div>
      </div>
      <p className="muted small">O Microsoft Graph deve ser autorizado no Microsoft Entra ID / Exchange Online. Não informe senhas de usuário nem segredos de aplicativo nesta tela; a equipe de TI configura as credenciais no servidor seguro do POSSO.</p>
    </section>

    <section className="card">
      <h3>Adicionar conta de e-mail</h3>
      <form className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}
        onSubmit={e=>{
          e.preventDefault();const form=e.currentTarget;const f=new FormData(form);
          void execute('create',async()=>{
            const users=String(f.get('users')??'').split(/[,\s]+/).filter(Boolean).map(Number);
            const groups=String(f.get('groups')??'').split(/[,\s]+/).filter(Boolean).map(Number);
            await api('/admin/email/accounts',{body:{
              kind,label:String(f.get('label')??''),unit_id:me.activeUnit.id,
              allowed_user_ids:users.length?users:[me.user.systemUserId],
              allowed_group_ids:groups,
              config:kind==='email_graph'?{
                graph_sync:true,auth_mode:'app_only',purpose,
                mailbox:String(f.get('mailbox')??'').trim(),
                tenant:String(f.get('tenant')??'').trim()
              }:{
                host:String(f.get('host')??'').trim()||undefined,
                port:Number(f.get('port')??993),
                username:String(f.get('username')??'').trim()||undefined
              },
              ...(kind==='email_graph'?{}:f.get('secret')?{secret:String(f.get('secret'))}:{})
            }});
            setMsg('Conta cadastrada na unidade ativa. Complete o Tenant ID quando a TI informar, depois teste o acesso.');
            form.reset();setKind('email_graph');setPurpose('institutional');
          });
        }}>
        <label className="field">Integração
          <select name="kind" className="select" value={kind}
            onChange={e=>setKind(e.target.value as typeof kind)}>
            <option value="email_graph">Microsoft 365 — Graph (recomendado)</option>
            <option value="email_imap">IMAP — outro provedor</option>
            <option value="email_gmail">Gmail — preparação OAuth</option>
          </select>
        </label>
        <label className="field">Identificação no POSSO
          <input name="label" className="input" required placeholder="Correspondência EPC13 / Petrobras"/>
        </label>
        {kind==='email_graph'?<>
          <label className="field">Finalidade da caixa
            <select name="purpose" className="select" value={purpose}
              onChange={e=>setPurpose(e.target.value as typeof purpose)}>
              <option value="institutional">Institucional / Petrobras</option>
              <option value="posso">E-mail próprio do POSSO</option>
            </select>
          </label>
          <label className="field">Endereço Microsoft 365
            <input name="mailbox" type="email" className="input" required
              defaultValue={purpose==='institutional'?'consorcioepc13@consorcioepc13.com.br':''}
              key={purpose} placeholder="caixa@dominio.com.br" autoComplete="off"/>
          </label>
          <label className="field">Tenant ID Microsoft (GUID)
            <input name="tenant" className="input" placeholder="Pode informar depois da autorização pela TI" autoComplete="off"/>
          </label>
        </>:<>
          <label className="field">Servidor IMAP<input name="host" className="input" placeholder="imap.provedor.com.br"/></label>
          <label className="field">Porta<input name="port" className="input" type="number" defaultValue={993}/></label>
          <label className="field">Usuário<input name="username" className="input" autoComplete="off"/></label>
          <label className="field">Senha de aplicativo (outros provedores)
            <input name="secret" type="password" className="input" autoComplete="new-password"/>
          </label>
        </>}
        <label className="field">IDs de usuários autorizados no POSSEBON
          <input name="users" className="input" defaultValue={String(me.user.systemUserId)}
            placeholder="ex.: 230, 456"/>
        </label>
        <label className="field">IDs de grupos autorizados (opcional)
          <input name="groups" className="input" placeholder="ex.: 20, 33"/>
        </label>
        <div style={{alignSelf:'end'}}>
          <button className="btn primary" disabled={!!busy}>{busy==='create'?'Registrando...':'Cadastrar caixa'}</button>
        </div>
      </form>
    </section>

    <section className="card">
      <h3>Caixas configuradas nesta unidade</h3>
      {!data?.length?<p className="muted">Nenhuma caixa cadastrada nesta unidade.</p>:
        <div style={{overflowX:'auto'}}><table className="data">
          <thead><tr><th>Identidade</th><th>Integração</th><th>Situação</th><th>Operações</th></tr></thead>
          <tbody>{data.map(a=><tr key={a.id}>
            <td><strong>{a.label}</strong><div className="small muted">{a.config.mailbox??'Provedor externo'}</div>
              <div className="small muted">{a.config.purpose==='posso'?'E-mail do POSSO':'Conta institucional'} · Unidade {a.unitId}</div></td>
            <td>{a.kind==='email_graph'?'Microsoft Graph':'IMAP/Gmail'}
              <div className="small muted">{a.config.auth_mode==='app_only'?'Aplicativo (sem senha pessoal)':
                a.hasSecret?'Token ou senha cifrado':'Ainda sem autorização'}</div></td>
            <td><Status s={a.status}/><div className="small muted">{a.lastTestResult??'Aguardando teste de acesso'}</div>
              <div className="small muted">{a.sendingEnabled?'Envio autorizado':'Envio desabilitado'}</div></td>
            <td><div className="row" style={{gap:7,flexWrap:'wrap'}}>
              <button type="button" className="btn sm" disabled={!!busy}
                onClick={()=>void execute(a.id+'-test',async()=>{
                  const result=await api<{ok:boolean;message:string}>(`/admin/email/accounts/${a.id}/test`,{body:{}});
                  setMsg(result.message);
                })}>Testar acesso</button>
              {a.kind==='email_graph'&&a.config.graph_sync&&
                <button type="button" className="btn sm" disabled={!!busy} onClick={()=>void execute(a.id+'-sync',async()=>{
                  const result=await api<{synchronized:number;stored:number}>(`/admin/email/accounts/${a.id}/sync`,{body:{}});
                  setMsg(`Leitura concluída: ${result.synchronized} alterações, ${result.stored} mensagens disponíveis.`);
                })}>Ler e-mails</button>}
              {a.kind==='email_graph'&&a.config.auth_mode==='app_only'&&
                <button type="button" className="btn sm" disabled={!!busy||(!a.sendingEnabled&&a.status!=='ativo')}
                  onClick={()=>void execute(a.id+'-sending',async()=>{
                    if(!window.confirm(a.sendingEnabled?'Desativar o envio por esta caixa?':
                      'Habilitar envio externo por esta caixa? O POSSO continuará exigindo confirmação para cada rascunho.'))return;
                    await api(`/admin/email/accounts/${a.id}/sending`,{body:{enabled:!a.sendingEnabled}});
                    setMsg(a.sendingEnabled?'Envio desativado.':'Envio habilitado para usuários autorizados.');
                  })}>{a.sendingEnabled?'Desativar envio':'Habilitar envio'}</button>}
              {a.kind==='email_graph'&&a.config.auth_mode==='app_only'&&
                <button type="button" className="btn sm" disabled={!!busy}
                  onClick={()=>{setConfiguringId(configuringId===a.id?'':a.id);setTenantDraft(a.config.tenant??'');}}>
                  {a.config.tenant?'Editar Tenant':'Configurar Tenant'}
                </button>}
              <button type="button" className="btn ghost sm danger" disabled={!!busy}
                onClick={()=>void execute(a.id+'-remove',async()=>{
                  if(!window.confirm('Remover esta caixa, suas credenciais e o cache sincronizado?'))return;
                  await api(`/admin/email/accounts/${a.id}`,{method:'DELETE'});
                  setMsg('Conta removida.');
                })}>Remover</button>
            </div>
              {configuringId===a.id&&<form className="grid" style={{gap:8,marginTop:12}}
                onSubmit={e=>{e.preventDefault();void execute(a.id+'-configure',async()=>{
                  await api(`/admin/email/accounts/${a.id}`,{
                    method:'PATCH',body:{tenant:tenantDraft}
                  });
                  setConfiguringId('');setMsg('Tenant ID registrado. Agora teste o acesso Microsoft Graph.');
                });}}>
                <label className="field">Tenant ID Microsoft
                  <input className="input" required value={tenantDraft}
                    onChange={e=>setTenantDraft(e.target.value)} placeholder="GUID informado pela TI"/>
                </label>
                <button className="btn sm primary" disabled={!!busy}>Salvar Tenant ID</button>
              </form>}
            </td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="card">
      <h3>Preparar e aprovar uma mensagem</h3>
      <p className="muted small">O POSSO pode elaborar rascunhos na conversa. Mensagens externas só são transmitidas com confirmação explícita; uma resposta HTTP 202 do Graph significa solicitação de envio aceita, não entrega garantida.</p>
      <form className="grid" onSubmit={event=>{
        event.preventDefault();
        void execute('draft',async()=>{
          const draft=await api<{id:string}>('/email/drafts',{body:{
            accountId:mailboxChoice,to:draftTo.split(/[,;]+/).map(s=>s.trim()).filter(Boolean),
            subject:draftSubject,body:draftBody
          }});
          setMsg('Rascunho '+draft.id+' criado. Revise e confirme o envio abaixo.');
          setDraftTo('');setDraftSubject('');setDraftBody('');
        });
      }}>
        <label className="field">Remetente
          <select className="select" value={mailboxChoice} onChange={e=>setMailboxChoice(e.target.value)} required>
            <option value="">Selecione a caixa autorizada</option>
            {accountOptions.map(a=><option value={a.id} key={a.id}>{a.label} — {a.config.mailbox}</option>)}
          </select>
        </label>
        <label className="field">Destinatários (separados por vírgula)
          <input className="input" value={draftTo} onChange={e=>setDraftTo(e.target.value)}
            required placeholder="destinatario@empresa.com.br"/>
        </label>
        <label className="field">Assunto
          <input className="input" value={draftSubject} onChange={e=>setDraftSubject(e.target.value)} required/>
        </label>
        <label className="field">Mensagem
          <textarea className="textarea" rows={5} value={draftBody} onChange={e=>setDraftBody(e.target.value)}
            required placeholder="Escreva a mensagem que o POSSO deverá preparar."/>
        </label>
        <button className="btn primary" disabled={!!busy||!mailboxChoice}>Salvar rascunho</button>
      </form>
      <h4>Meus rascunhos e envios</h4>
      {!drafts?.length?<p className="muted">Nenhum rascunho preparado.</p>:
        <div className="list">{drafts.map(d=><div key={d.id} className="list-item">
          <strong>{d.subject}</strong><div className="muted small">Para: {d.to.join(', ')} · {d.status}</div>
          <details><summary>Ver texto completo</summary><p style={{whiteSpace:'pre-wrap'}}>{d.body}</p></details>
          {d.status==='draft'&&<button className="btn sm" disabled={!!busy}
            onClick={()=>void execute('send-'+d.id,async()=>{
              if(!window.confirm('Confirma o ENVIO externo de "'+d.subject+'" para '+d.to.join(', ')+'?'))return;
              const result=await api<{message:string}>(`/email/drafts/${d.id}/send`,{body:{confirm:true}});
              setMsg(result.message);
            })}>Confirmar e enviar</button>}
        </div>)}</div>}
    </section>
  </div>;
}

interface AiConfigView {
  provider: string;
  configured: boolean;
  model: string;
  apiKeyPresent: boolean;
  keySource: string;
  secureKeyStorage: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  dailyRequestsPerUser: number;
  chatPerMinute: number;
  endpoint: string;
  lastUpdatedAt: string | null;
  note: string;
}

function Ai() {
  const { name } = useBranding();
  const s = useLoad<AiConfigView>('/admin/ai');
  const u = useLoad<Record<string, unknown>[]>('/admin/ai/usage');
  const [model, setModel] = useState('gpt-5-mini');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(45000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!s.data) return;
    setModel(s.data.model);
    setTimeoutMs(s.data.timeoutMs);
    setMaxOutputTokens(s.data.maxOutputTokens);
    setApiKey('');
  }, [s.data]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setApiKey('');
      setMessage(success);
      s.reload();
    } catch (e) {
      setMessage('Erro: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid">
      <section className="card">
        <h3>Provedor de inteligência artificial</h3>
        <p className="muted small">Chave configurada no servidor e cifrada antes de ser salva no banco da {name}. Somente administradores autorizados pelo POSSEBON podem alterar esta configuração.</p>
        {s.err && <div className="error-box">{s.err}</div>}
        {s.data && (
          <div className="row" style={{ marginBottom: 12 }}>
            <span className={'badge ' + (s.data.configured ? 'good' : 'warn')}>{s.data.configured ? 'IA configurada' : 'IA não configurada'}</span>
            <span className="small muted">Credencial: {s.data.apiKeyPresent ? 'presente (' + s.data.keySource + ')' : 'ausente'} · Endpoint: {s.data.endpoint}</span>
          </div>
        )}
        {s.data && !s.data.secureKeyStorage && <div className="error-box">Antes de cadastrar uma chave real, configure ADA_ENCRYPTION_KEY no servidor da assistente. Sem essa chave exclusiva, o armazenamento seguro de credenciais não estará habilitado.</div>}
        {message && <div className="note-box" role="status">{message}</div>}
        <form className="grid" onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => api('/admin/ai/settings', { method: 'PUT', body: {
              provider: 'openai', model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              timeoutMs, maxOutputTokens
            } }),
            'Configuração salva. A IA já pode ser usada em novas mensagens.'
          );
        }}>
          <label className="small" htmlFor="ai-provider">Provedor</label>
          <input className="input" id="ai-provider" value="OpenAI — Responses API" disabled />
          <label className="small" htmlFor="ai-model">Modelo</label>
          <input className="input" id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}
            maxLength={100} placeholder="Ex.: gpt-5-mini" required autoComplete="off" />
          <label className="small" htmlFor="ai-key">Chave da API (secreta)</label>
          <input className="input" id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            maxLength={400} minLength={20} placeholder={s.data?.apiKeyPresent ? 'Deixe vazio para manter a chave atual' : 'Cole sua chave da OpenAI'} autoComplete="new-password" />
          <span className="muted small">A chave nunca será exibida novamente e não ficará guardada no navegador.</span>
          <div className="row">
            <div className="grow">
              <label className="small" htmlFor="ai-timeout">Tempo limite (ms)</label>
              <input className="input" id="ai-timeout" type="number" min={5000} max={120000} step={1000} required
                value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
            </div>
            <div className="grow">
              <label className="small" htmlFor="ai-tokens">Máximo de tokens de saída</label>
              <input className="input" id="ai-tokens" type="number" min={64} max={16000} step={1} required
                value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(Number(e.target.value))} />
            </div>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || !s.data}>Salvar configurações</button>
            <button className="btn" type="button" disabled={busy || !s.data?.configured}
              onClick={() => void (async () => {
                setBusy(true); setMessage('');
                try {
                  const r = await api<{ ok: boolean; message: string }>('/admin/ai/test', { body: {} });
                  setMessage((r.ok ? 'OK: ' : 'Falha: ') + r.message);
                } catch (e) { setMessage('Erro: ' + (e as Error).message); }
                finally { setBusy(false); }
              })()}>
              Testar conexão
            </button>
            <button className="btn danger" type="button" disabled={busy || !s.data?.lastUpdatedAt}
              onClick={() => {
                if (!window.confirm(`Remover a configuração de IA salva em ${name}? Uma eventual chave do ambiente continuará sendo utilizada.`)) return;
                void run(() => api('/admin/ai/settings', { method: 'DELETE' }), 'Configuração do cofre removida.');
              }}>
              Remover configuração
            </button>
          </div>
        </form>
        <p className="muted small" style={{ marginTop: 12 }}>{s.data?.note ?? 'Carregando…'} O envio de conversas ao provedor obedece às regras de privacidade e permissões da {name}.</p>
      </section>
      <section className="card">
        <h3>Consumo e limites</h3>
        {s.data && <Kv obj={{ dailyRequestsPerUser: s.data.dailyRequestsPerUser, chatPerMinute: s.data.chatPerMinute, lastUpdatedAt: s.data.lastUpdatedAt ?? '—' }} />}
      </section>
      <section className="card">
        <h3>Uso nos últimos 30 dias</h3>
        {!u.data?.length ? <p className="muted">Sem chamadas registradas.</p> : (
          <table className="data"><thead><tr><th>Dia</th><th>Provedor/modelo</th><th>Chamadas</th><th>Tokens entrada</th><th>Tokens saída</th><th>Falhas</th></tr></thead>
            <tbody>{u.data.map((r, i) => <tr key={i}><td>{formatDateTime(String(r.dia)).slice(0, 10)}</td><td>{String(r.provider)} / {String(r.model)}</td><td className="num">{String(r.chamadas)}</td><td className="num">{String(r.entrada)}</td><td className="num">{String(r.saida)}</td><td className="num">{String(r.falhas)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Policies() {
  const { data } = useLoad<Record<string, unknown>>('/admin/policies');
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  const { myEffectiveContext, ...rest } = data;
  return (
    <div className="grid">
      <section className="card"><h3>Regras</h3><Kv obj={rest} /></section>
      <section className="card"><h3>Seu contexto efetivo (vindo do POSSEBON)</h3><pre className="code">{JSON.stringify(myEffectiveContext, null, 2)}</pre></section>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const { data, reload } = useLoad<{ id: number; occurred_at: string; actor_user_id: number | null; unit_id: number | null; action: string; target_type: string | null; target_id: string | null; outcome: string; details: unknown }[]>(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Filtrar ação (ex.: monitor., sso.)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filtrar por ação" />
        <button className="btn sm" onClick={reload}>↻</button>
        <span className="muted small">Trilha imutável. Não contém texto de conversas nem segredos.</span>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="data">
          <thead><tr><th>Quando</th><th>Ator</th><th>Unidade</th><th>Ação</th><th>Alvo</th><th>Resultado</th><th>Detalhes</th></tr></thead>
          <tbody>{data?.map((e) => (
            <tr key={e.id}><td className="small">{formatDateTime(e.occurred_at)}</td><td>{e.actor_user_id ?? 'sistema'}</td><td>{e.unit_id ?? '—'}</td><td>{e.action}</td><td className="small">{e.target_type ? `${e.target_type} ${e.target_id ?? ''}` : '—'}</td><td><Status s={e.outcome} /></td><td className="small">{JSON.stringify(e.details)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function AdminAgentChat() {
  const {me} = useApp();
  const rules = useLoad<{blockedTables:string[];style:string}>('/admin/conversation-rules');
  return <div className="grid admin-posso">
    <section className="card admin-posso-chat">
      <h2>Conversar com o POSSO</h2>
      <p className="muted small">Sessão administrativa da unidade {me.activeUnit.name}. Solicite consultas, notificações, acompanhamentos e outras ações. O POSSO usa as ferramentas operacionais reais e confirma o resultado de cada execução.</p>
      <ChatView adminEmbedded />
    </section>
    <div className="grid">
      <section className="card">
        <h2>Preferências da conversa</h2>
        <p className="muted small">Orientações de apresentação. A capacidade de executar tarefas é a mesma do chat principal; a identidade e o escopo vêm do POSSEBON.</p>
        {rules.err ? <p role="alert">{rules.err}</p>
          : rules.data ? <p><strong>Estilo de resposta:</strong> {rules.data.style || 'Padrão'}</p>
          : <p role="status">Carregando preferências…</p>}
      </section>
      <KnowledgeCoverage />
    </div>
  </div>;
}

interface AdminCoverage {
  indexedDocuments: number;
  authorizedGraphNodes: number;
  operationalSource: 'available' | 'unavailable';
  checkedAt: string;
  catalogTruncated: boolean;
  areas: { id: string; name: string; indexedDocuments: number; authorizedTables: number }[];
}

function KnowledgeCoverage() {
  const { data, err, reload } = useLoad<AdminCoverage>('/brain/coverage');
  return <section className="card">
    <div className="row"><h2 className="grow">Cobertura de conhecimento</h2><button className="btn sm" onClick={reload}>Atualizar</button></div>
    {err ? <p className="error-box" role="alert">{err}</p> : data ? <>
      <p>{data.indexedDocuments} documentos indexados · {data.authorizedGraphNodes} referências no grafo</p>
      <p>Fonte operacional {data.operationalSource === 'available' ? 'disponível' : 'indisponível'} · {formatDateTime(data.checkedAt)}</p>
      {data.catalogTruncated && <p>O catálogo retornou uma contagem parcial de documentos.</p>}
      <details><summary>Ver cobertura por área</summary>
        <table className="data"><thead><tr><th>Área</th><th>Documentos</th><th>Tabelas no catálogo</th></tr></thead>
          <tbody>{data.areas.map(area => <tr key={area.id}><th scope="row">{area.name}</th><td>{area.indexedDocuments}</td><td>{area.authorizedTables}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <p role="status">Conferindo o conhecimento desta unidade…</p>}
  </section>;
}

export default function AdminView() {
  const { name } = useBranding();
  const { me } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('regras-chat');
  const panels: Record<string, ReactNode> = { saude: <Health />, identidade: <BrandingSettings />, conhecimento: <Knowledge />, conectores: <Connectors />, email: <Email />, ia: <Ai />, acessos: <OperationalSettings />, 'regras-chat': <AdminAgentChat key={me.activeUnit.id} />, politicas: <Policies />, auditoria: <Audit /> };
  return (
    <>
      <header className="topbar"><h1 className="grow" style={{ paddingLeft: 36 }}>Administração da {name}</h1><span className="badge">Acesso restrito</span></header>
      <div className="content">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{panels[tab]}</div>
      </div>
    </>
  );
}
