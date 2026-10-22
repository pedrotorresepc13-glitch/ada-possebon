// Onboarding HOLO/POSSEBON. A senha só é enviada ao servidor local (loopback)
// e dele à API HTTPS oficial; nenhuma credencial é salva no navegador.
const mount=document.createElement('div');
mount.id='holo-brain-onboarding';
mount.innerHTML=[
  '<button class="hb-open" id="hb-open" type="button">◈ Conectar POSSEBON</button>',
  '<dialog class="hb-modal" id="hb-dialog" aria-labelledby="hb-title">',
  '  <form class="hb-form" id="hb-form" autocomplete="off">',
  '    <header><div><strong id="hb-title">HOLO · Conhecimento POSSEBON</strong><small>Conexão segura e estudo inicial, somente leitura</small></div><button id="hb-close" type="button" aria-label="Fechar">✕</button></header>',
  '    <p id="hb-connection" class="hb-connection">Verificando serviço...</p>',
  '    <section class="hb-login" id="hb-login">',
  '      <label>Usuário POSSEBON<input id="hb-user" autocomplete="off" maxlength="200" required placeholder="Seu login do POSSEBON"></label>',
  '      <label>Senha<input id="hb-password" type="password" autocomplete="off" maxlength="1024" required placeholder="Senha do POSSEBON"></label>',
  '      <label id="hb-unit-row" hidden>Unidade<select id="hb-unit"><option value="">Selecione a unidade</option></select></label>',
  '      <button id="hb-connect" class="hb-primary" type="submit">Conectar com segurança</button>',
  '    </section>',
  '    <section class="hb-study" id="hb-study" hidden>',
  '      <div class="hb-metrics"><span id="hb-identity"></span><strong id="hb-total">0 itens estudados</strong></div>',
  '      <div class="hb-meter"><div id="hb-meter-fill"></div></div>',
  '      <p id="hb-progress">Preparando estudo...</p>',
  '      <div class="hb-actions"><button type="button" class="hb-primary" id="hb-refresh">Estudar / atualizar Brain</button><button type="button" id="hb-logout">Desconectar</button></div>',
  '      <p class="hb-small">A HOLO lê regras, esquema, processos, permissões e código já catalogado. Não sincroniza nem modifica o POSSEBON Web ou o My Import. Os arquivos ficam no disco D: da sua instalação.</p>',
  '    </section>',
  '    <p class="hb-message" id="hb-message" role="status"></p>',
  '  </form>',
  '</dialog>'
].join('');
document.querySelector('.topbar .header-actions')?.prepend(mount);
const style=document.createElement('link');
style.rel='stylesheet';style.href='/studio/brain-onboarding.css';document.head.append(style);
const node=id=>mount.querySelector('#'+id);
let last=null,loading=false;
const message=(text,error=false)=>{node('hb-message').textContent=text;node('hb-message').classList.toggle('hb-error',error);};
async function api(route,options={}){
  const res=await fetch(route,{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(22000)});
  const data=await res.json();
  if(!res.ok||data.ok===false)throw Error(data.error||'Falha HTTP '+res.status);
  return data;
}
const clearCredentials=()=>{node('hb-password').value='';node('hb-user').value='';};
function draw(state){
  last=state;
  const connected=!!state.connected;
  node('hb-login').hidden=connected;
  node('hb-study').hidden=!connected;
  node('hb-refresh').hidden=!state.can_manage_ai;
  node('hb-connection').textContent='Servidor POSSEBON: '+(state.remote||'não configurado')+
     (connected?' · Sessão temporária ativa':' · Aguarda autenticação');
  const pg=state.progress||{};
  const count=Number(pg.count)||0,expected=Number(pg.expected)||0;
  node('hb-meter-fill').style.width=Math.round(expected>0?Math.min(100,count/expected*100):0)+'%';
  node('hb-total').textContent=state.can_manage_ai?
    (pg.running?count:Number(state.knowledge?.count)||0).toLocaleString('pt-BR')+' itens '+(pg.running?'lidos':'catalogados'):
    'Catálogo reservado ao administrador';
  if(connected){
    node('hb-identity').textContent=(state.user_name||'Usuário POSSEBON')+' · Unidade '+state.unit_id;
    node('hb-progress').textContent=!state.can_manage_ai?
      'Sessão operacional ativa. Consulte o POSSEBON pelo quadro dentro do seu escopo.':pg.running?
      'Estudando '+(pg.namespace||'catálogo')+'... '+count.toLocaleString('pt-BR')+' de '+expected.toLocaleString('pt-BR')+' itens previstos.':
      (pg.error?'Estudo interrompido: '+pg.error:
        (state.knowledge?.ready?
          'Estudo disponível desde '+new Date(state.knowledge.completedAt).toLocaleString('pt-BR')+'.':
          'Ainda não existe um estudo completo nesta unidade.'));
    node('hb-refresh').disabled=!!pg.running;
    node('hb-logout').disabled=!!pg.running;
    node('hb-open').textContent=pg.running?'◈ Estudando '+count.toLocaleString('pt-BR'):
      state.knowledge?.ready?'◈ POSSEBON · '+Number(state.knowledge.count).toLocaleString('pt-BR')+' itens':'◈ POSSEBON conectado';
  }else{
    node('hb-open').textContent='◈ Conectar POSSEBON';
  }
}
async function status(){
  try{draw(await api('/api/possebon/status'));}
  catch(e){message('Serviço HOLO local indisponível: '+e.message,true);}
}
async function beginStudy(){
  message('Iniciando estudo do POSSEBON Brain...');
  try{await api('/api/possebon/study',{method:'POST',body:'{}'});await status();message('O estudo está em andamento. Você pode continuar utilizando a HOLO.');}
  catch(e){message('Não foi possível iniciar o estudo: '+e.message,true);}
}
node('hb-open').addEventListener('click',()=>{node('hb-dialog').showModal();void status();});
node('hb-close').addEventListener('click',()=>node('hb-dialog').close());
node('hb-dialog').addEventListener('close',()=>{if(!last?.connected)clearCredentials();});
node('hb-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(loading)return;loading=true;node('hb-connect').disabled=true;
  message('Verificando login e unidades autorizadas...');
  try{
    const data=await api('/api/possebon/login',{method:'POST',body:JSON.stringify({
      login:node('hb-user').value.trim(),password:node('hb-password').value,
      unit_id:Number(node('hb-unit').value)||undefined
    })});
    if(data.requires_unit_selection){
      const sel=node('hb-unit');sel.replaceChildren();
      const init=document.createElement('option');init.value='';init.textContent='Selecione a unidade';sel.append(init);
      for(const u of data.units||[]){
        const opt=document.createElement('option');opt.value=String(u.id);opt.textContent=u.name+' · '+u.id;sel.append(opt);
      }
      node('hb-unit-row').hidden=false;sel.required=true;
      message('Login válido. Selecione a unidade e clique novamente em Conectar.');
    }else{
      clearCredentials();node('hb-unit-row').hidden=true;
      await status();message('Autenticação concluída. O token fica somente na memória do serviço local.');
      if(data.can_manage_ai===true && !data.knowledge?.ready)void beginStudy();
    }
  }catch(err){message(err.message,true);}
  finally{loading=false;node('hb-connect').disabled=false;}
});
node('hb-refresh').addEventListener('click',()=>{void beginStudy();});
node('hb-logout').addEventListener('click',async()=>{
  try{await api('/api/possebon/logout',{method:'POST',body:'{}'});
    node('hb-unit-row').hidden=true;node('hb-unit').replaceChildren();clearCredentials();await status();
    message('Sessão temporária encerrada. O índice anterior permanece no disco D:.');
  }catch(e){message(e.message,true);}
});
setInterval(()=>{if(last?.progress?.running)void status();},1500);
void status();
