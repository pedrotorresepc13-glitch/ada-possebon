// A tela inicia pelo login POSSEBON. O acesso real é sempre verificado pelo servidor.
// A instância local suporta somente uma sessão por vez; NÃO constitui autenticação multiusuário.
const gate=document.createElement('section');
gate.id='holo-auth-gate';
gate.setAttribute('aria-label','Acesso ao assistente empresarial');
gate.innerHTML='<div class="hag-box"><div class="hag-mark">P</div><p class="hag-overline">POSSEBON · INTELIGÊNCIA EMPRESARIAL</p><h1>Seu trabalho. Suas permissões.</h1><p>Entre com seu usuário POSSEBON e sua unidade. As consultas operacionais respeitam as permissões verificadas pelo sistema de origem.</p><button id="hag-login" type="button">Entrar com POSSEBON</button><small id="hag-state">Sem sessão autenticada. Nenhum dado operacional será exibido.</small></div>';
document.body.append(gate);
const gateCss=document.createElement('style');
gateCss.textContent=`#holo-auth-gate{position:fixed;inset:0;background:linear-gradient(130deg,#e8f2f8 0%,#f7fafc 56%,#e1eef7 100%);z-index:900;display:grid;place-items:center;font:14px Inter,system-ui,Arial,sans-serif;color:#1d405d;padding:20px}
#holo-auth-gate[hidden]{display:none!important}
.hag-box{max-width:455px;width:100%;background:#fff;border:1px solid #cbdfee;border-radius:22px;padding:46px 42px;box-shadow:0 28px 80px #1e4a6723}
.hag-mark{width:48px;height:48px;border-radius:13px;background:#1a70aa;color:white;font-size:30px;font-weight:900;display:grid;place-items:center}
.hag-overline{letter-spacing:.1em;font-size:10px;color:#33729b;font-weight:800;margin-top:25px}
.hag-box h1{font-size:29px;letter-spacing:-.035em;margin:10px 0;color:#173a56}
.hag-box p:not(.hag-overline){color:#5f788d;line-height:1.65}
#hag-login{width:100%;background:#176fa9;color:white;padding:14px;border:0;border-radius:11px;font-size:14px;font-weight:750;margin-top:16px}
#hag-state{display:block;color:#667f90;line-height:1.5;margin-top:20px}
@media(max-width:520px){.hag-box{padding:27px}} `;
document.head.append(gateCss);
const nameKey='holo-enterprise-assistant-name';
function currentName(){try{return localStorage.getItem(nameKey)||'HOLO';}catch{return 'HOLO';}}
function updateName(){
  const name=currentName();
  document.title=name+' · POSSEBON';
  for(const node of document.querySelectorAll('[data-holo-name]'))node.textContent=name;
  const intro=document.getElementById('hb-title');
  if(intro)intro.textContent=name+' · Conhecimento POSSEBON';
  window.dispatchEvent(new CustomEvent('holo:name-changed',{detail:{name}}));
}
updateName();
let authState=null, busy=false;
const neural=document.getElementById('btn-neural');
const rename=document.getElementById('btn-assistant-name');
const exit=document.getElementById('btn-exit');
function showNeural(show){
  const map=document.getElementById('neural-map');
  const whiteboard=document.getElementById('report-board');
  if(show && authState?.can_manage_ai!==true)return;
  if(map)map.hidden=!show;
  if(whiteboard)whiteboard.hidden=show;
  if(neural)neural.textContent=show?'▣ Voltar ao quadro':'◈ Rede neural (admin)';
}
neural?.addEventListener('click',()=>showNeural(document.getElementById('neural-map')?.hidden));
rename?.addEventListener('click',()=>{
  if(authState?.can_manage_ai!==true)return;
  const value=window.prompt('Nome do assistente (2 a 40 caracteres):',currentName());
  if(value===null)return;
  const name=value.trim();
  if(name.length<2||name.length>40||/[<>]/.test(name))return window.alert('Use um nome de 2 a 40 caracteres, sem < ou >.');
  try{localStorage.setItem(nameKey,name);}catch{return window.alert('Não foi possível salvar neste navegador.');}
  updateName();
});
gate.querySelector('#hag-login').addEventListener('click',()=>{
  const login=document.getElementById('hb-open');
  if(login)login.click();
  else gate.querySelector('#hag-state').textContent='Conexão ainda não carregada. Reabra a tela.';
});
exit?.addEventListener('click',async()=>{
  try{await fetch('/api/possebon/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
  catch{}
  await check();
});
async function check(){
  if(busy)return;busy=true;
  try{
    const response=await fetch('/api/possebon/status',{signal:AbortSignal.timeout(4000),cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const s=await response.json();
    const wasConnected=!!authState?.connected;
    const before=authState?.connected?(authState.user_id+'-'+authState.unit_id):'';
    authState=s;
    const connected=!!s.connected;
    gate.hidden=connected;
    document.body.classList.toggle('holo-logged-out',!connected);
    gate.querySelector('#hag-state').textContent=connected?'Sessão conectada':'Entre para consultar sua unidade autorizada.';
    if(neural)neural.hidden=!connected||s.can_manage_ai!==true;
    if(rename)rename.hidden=!connected||s.can_manage_ai!==true;
    if(exit)exit.hidden=!connected;
    if(!connected)showNeural(false);
    const after=connected?(s.user_id+'-'+s.unit_id):'';
    if(wasConnected!==connected || before!==after)
      window.dispatchEvent(new CustomEvent('holo:auth-changed',{detail:{connected,identityChanged:before!==after}}));
    window.dispatchEvent(new CustomEvent('holo:auth-status',{detail:s}));
  }catch{
    const wasConnected=!!authState?.connected;
    authState=null;gate.hidden=false;showNeural(false);
    if(wasConnected)window.dispatchEvent(new CustomEvent('holo:auth-changed',{detail:{connected:false,identityChanged:true}}));
    gate.querySelector('#hag-state').textContent='HOLO Companion não está acessível. Inicie o serviço local e tente novamente.';
  }finally{busy=false;}
}
window.addEventListener('holo:brain-refresh',()=>void check());
setInterval(()=>void check(),4500);
void check();
