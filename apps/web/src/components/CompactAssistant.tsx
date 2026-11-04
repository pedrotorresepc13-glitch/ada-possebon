import { useEffect,useRef,useState } from 'react';
import { BASE } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useBranding } from '../branding.tsx';
import { Icon } from './Icon.tsx';

export function CompactAssistant(){
  const {name}=useBranding();const {navigate,me}=useApp();
  const [open,setOpen]=useState(false);const [mounted,setMounted]=useState(false);
  const [welcomeId,setWelcomeId]=useState<string|undefined>(undefined);
  const [revision,setRevision]=useState(0);
  const frame=useRef<HTMLIFrameElement>(null);const trigger=useRef<HTMLButtonElement>(null);
  const conversation=useRef<string|undefined>(undefined);
  useEffect(()=>{const receive=(event:MessageEvent)=>{
    if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;
    if(event.data?.type==='possebon:close'){setOpen(false);trigger.current?.focus();}
    if(event.data?.type==='possebon:navigate'&&/^\/(?:telas\/[0-9a-f-]{36}|dashboards\/[0-9a-f-]{36}|acompanhamentos)$/.test(String(event.data.path))){setOpen(false);navigate(event.data.path);}
    if(event.data?.type==='possebon:conversation'&&/^[0-9a-f-]{36}$/i.test(String(event.data.id)))conversation.current=event.data.id;
  };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[navigate]);
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  useEffect(()=>{const welcome=(event:Event)=>{const id=(event as CustomEvent<{id:string}>).detail?.id;if(!/^[0-9a-f-]{36}$/i.test(id??''))return;setWelcomeId(id);conversation.current=id;setMounted(true);setOpen(true);};
    window.addEventListener('possebon:welcome',welcome);return()=>window.removeEventListener('possebon:welcome',welcome);},[]);
  useEffect(()=>{const updated=(event:Event)=>{const id=(event as CustomEvent<{id:string}>).detail?.id;if(!/^[0-9a-f-]{36}$/i.test(id??''))return;setWelcomeId(id);conversation.current=id;setRevision(r=>r+1);};window.addEventListener('possebon:conversation-updated',updated);return()=>window.removeEventListener('possebon:conversation-updated',updated);},[]);
  return <div className="assistant-dock">
    {mounted&&<section className="compact-window" hidden={!open} role="dialog" aria-label={'Conversa rápida com '+name}><header><span className="row"><Icon name="spark"/><strong>{name}</strong></span><div className="row"><button className="btn ghost sm" aria-label="Abrir conversa completa" onClick={()=>{setOpen(false);navigate(conversation.current?'/?c='+conversation.current:'/?nova='+Date.now());}}><Icon name="expand" size={17}/></button><button className="btn ghost sm" aria-label="Minimizar conversa" onClick={()=>{setOpen(false);trigger.current?.focus();}}><Icon name="close" size={18}/></button></div></header><iframe key={me.user.systemUserId+':'+me.activeUnit.id+':'+revision} ref={frame} title={'Conversa rápida com '+name} src={BASE+'/compacto'+(welcomeId?'?c='+welcomeId:'')}/></section>}
    <button ref={trigger} className="assistant-launcher" aria-expanded={open} aria-label={open?'Minimizar assistente':'Conversar com '+name} onClick={()=>{setMounted(true);setOpen(v=>!v);}}><Icon name={open?'close':'spark'} size={24}/><span>{open?'Minimizar':name}</span></button>
  </div>;
}
