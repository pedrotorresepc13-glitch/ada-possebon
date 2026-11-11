import { useEffect,useRef,useState } from 'react';
import { BASE } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useBranding } from '../branding.tsx';
import { Icon } from './Icon.tsx';

export function CompactAssistant(){
  const {name}=useBranding();const {me,unread,navigate}=useApp();
  const [open,setOpen]=useState(false);const [mounted,setMounted]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [ready,setReady]=useState(false);
  const [welcomeId,setWelcomeId]=useState<string|undefined>(undefined);
  const [revision,setRevision]=useState(0);
  const frame=useRef<HTMLIFrameElement>(null);const trigger=useRef<HTMLButtonElement>(null);
  const conversation=useRef<string|undefined>(undefined);
  useEffect(()=>{const receive=(event:MessageEvent)=>{
    if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;
    if(event.data?.type==='possebon:open-dashboard') {
      const path = event.data.path;
      if (path && !/^\/(?:telas|dashboards)(?:\/[0-9a-f-]{36})?$/.test(path)) return;
      setOpen(false);
      if(window.parent!==window) window.parent.postMessage({type:'possebon:open-dashboard',path:path||''},location.origin);
      else navigate(path||'/dashboards');
    }
    if(event.data?.type==='possebon:close'){setOpen(false);trigger.current?.focus();}
    if(event.data?.type==='possebon:ready')setReady(true);
    if(event.data?.type==='possebon:conversation'&&/^[0-9a-f-]{36}$/i.test(String(event.data.id)))conversation.current=event.data.id;
    if(event.data?.type==='possebon:conversation-unavailable'&&conversation.current===event.data.id){conversation.current=undefined;setWelcomeId(undefined);}
  };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[navigate]);
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  useEffect(()=>{const welcome=(event:Event)=>{const id=(event as CustomEvent<{id:string}>).detail?.id;if(!/^[0-9a-f-]{36}$/i.test(id??''))return;setWelcomeId(id);conversation.current=id;setMounted(true);setOpen(true);};
    window.addEventListener('possebon:welcome',welcome);return()=>window.removeEventListener('possebon:welcome',welcome);},[]);
  useEffect(()=>{const updated=(event:Event)=>{const id=(event as CustomEvent<{id:string}>).detail?.id;if(!/^[0-9a-f-]{36}$/i.test(id??''))return;setWelcomeId(id);conversation.current=id;setReady(false);setRevision(r=>r+1);};window.addEventListener('possebon:conversation-updated',updated);return()=>window.removeEventListener('possebon:conversation-updated',updated);},[]);
  const showPanel = (panel: 'chat' | 'dashboard' | 'monitors' | 'notifications') => {
    frame.current?.contentWindow?.postMessage({type:'possebon:show-panel',panel}, location.origin);
  };
  return <div className="assistant-dock">
    {mounted && <section className={expanded?'compact-window expanded':'compact-window'} hidden={!open} role="dialog" aria-label={'Conversa rápida com '+name}>
      <header>
        <span className="compact-title"><Icon name="spark" /><strong>{name} - IA Possebon</strong></span>
        <div className="compact-actions">
          <button className="btn ghost sm" disabled={!ready} title="Conversa" aria-label="Voltar à conversa" onClick={()=>showPanel('chat')}><Icon name="chat" size={17}/></button>
          <button className="btn ghost sm" disabled={!ready} title="Notificações" aria-label={unread ? 'Notificações: '+unread+' não lidas' : 'Notificações'} onClick={()=>showPanel('notifications')}><Icon name="bell" size={17}/>{unread>0&&<span className="count">{unread>99?'99+':unread}</span>}</button>
          <button className="btn ghost sm" disabled={!ready} title="Acompanhamentos" aria-label="Acompanhamentos" onClick={()=>showPanel('monitors')}><Icon name="clock" size={17}/></button>
          <button className="btn ghost sm" disabled={!ready} title="Dashboard" aria-label="Dashboard" onClick={()=>showPanel('dashboard')}><Icon name="chart" size={17}/></button>
          <button className="btn ghost sm" aria-label={expanded?'Reduzir conversa':'Expandir conversa'} aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}><Icon name="expand" size={17}/></button>
          <button className="btn ghost sm" aria-label="Minimizar conversa" onClick={()=>{setOpen(false);trigger.current?.focus();}}><Icon name="close" size={18}/></button>
        </div>
      </header>
      <iframe key={me.user.systemUserId+':'+me.activeUnit.id+':'+revision} ref={frame} allow="microphone; autoplay" title={'Conversa rápida com '+name} src={BASE+'/compacto'+(welcomeId?'?c='+welcomeId:'')}/>
    </section>}
    <button ref={trigger} className="assistant-launcher" aria-expanded={open} aria-label={open?'Minimizar assistente':'Conversar com '+name} onClick={()=>{setMounted(true);setOpen(v=>!v);}}><Icon name={open?'close':'spark'} size={24}/><span>{open?'Minimizar':name}</span></button>
  </div>;
}
