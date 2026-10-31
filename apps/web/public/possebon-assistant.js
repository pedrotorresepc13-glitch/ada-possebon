/* Integração opcional same-origin. Usa a sessão SSO existente; não recebe tokens. */
(() => {
  'use strict';
  if(window.PossebonAssistant)return;
  const base=new URL(document.currentScript.dataset.base||'/ada/',location.origin);
  if(base.origin!==location.origin)throw new Error('Use a mesma origem do POSSEBON.');
  const host=document.createElement('div'),root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>:host{position:fixed;bottom:20px;right:20px;z-index:10000;font:14px system-ui}button{font:inherit;cursor:pointer;background:#1d4ed8;color:white;border:0;border-radius:28px;padding:14px 20px}section{width:min(420px,calc(100vw - 40px));height:min(650px,calc(100dvh - 120px));margin-bottom:12px;background:white;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 12px 36px #0f172a22;display:flex;flex-direction:column}section[hidden]{display:none}header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;color:#0f172a}header button{background:transparent;color:#475569;padding:8px}iframe{width:100%;border:0;flex:1;min-height:0}</style><section hidden role="dialog" aria-label="Conversa rápida"><header><strong>Assistente</strong><button aria-label="Minimizar conversa">Fechar</button></header><iframe title="Conversa rápida"></iframe></section><button class="launcher" aria-expanded="false">Conversar</button>`;
  const panel=root.querySelector('section'),frame=root.querySelector('iframe'),launcher=root.querySelector('.launcher');
  let loaded=false,context=null;
  const sendContext=()=>{frame.contentWindow.postMessage({type:'possebon:context',context},location.origin);};
  frame.addEventListener('load',sendContext);
  function open(){if(!loaded){frame.src=new URL('compacto',base).href;loaded=true;}panel.hidden=false;launcher.setAttribute('aria-expanded','true');}
  function close(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus();}
  launcher.addEventListener('click',()=>panel.hidden?open():close());root.querySelector('header button').addEventListener('click',close);
  host.addEventListener('keydown',e=>{if(e.key==='Escape')close();});document.body.append(host);
  async function branding(){try{const response=await fetch(new URL('api/ada/branding',base),{cache:'no-store'});if(!response.ok)return;const value=await response.json();if(typeof value.name==='string'){root.querySelector('strong').textContent=value.name;launcher.textContent=value.name;panel.setAttribute('aria-label','Conversa com '+value.name);frame.title='Conversa com '+value.name;}}catch{/* A conversa permanece disponível. */}}
  void branding();window.addEventListener('focus',branding);
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow)return;if(event.data?.type==='possebon:ready')sendContext();if(event.data?.type==='possebon:close')close();if(event.data?.type==='possebon:navigate'&&/^\/(?:telas\/[0-9a-f-]{36}|dashboards\/[0-9a-f-]{36}|acompanhamentos)$/.test(String(event.data.path)))location.assign(new URL(event.data.path.slice(1),base).href);});
  window.PossebonAssistant={open,close,setContext(value){context=value&&typeof value.module==='string'?{module:value.module,table:value.table,recordId:value.recordId}:null;sendContext();}};
})();
