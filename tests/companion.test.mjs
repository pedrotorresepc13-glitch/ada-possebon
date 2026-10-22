// Smoke local sem Ollama, token Brain, webcam ou acesso ao POSSEBON.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'holo-companion-test-'));
const port=await new Promise((ok,fail)=>{
  const server=net.createServer();
  server.once('error',fail);
  server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>ok(address.port));});
});
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['services/holo-companion.mjs'],{
  cwd:root,
  env:{...process.env,HOLO_COMPANION_PORT:String(port),HOLO_LOCAL_DATA_DIR:temp,
    HOLO_BRAIN_CONTEXT_URL:'',HOLO_BRAIN_TOKEN:'',HOLO_DOCUMENTOS_DIR:'',HOLO_AI_PROVIDER:'local'},
  stdio:'pipe'
});
let output='';
child.stdout.on('data',b=>output+=String(b));
child.stderr.on('data',b=>output+=String(b));
const wait=async()=>{
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error('Servidor saiu: '+output);
    try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}
    await new Promise(ok=>setTimeout(ok,100));
  }
  throw Error('Servidor não iniciou: '+output);
};
try{
  await wait();
  // Regressao: a interface antiga usava porta 4892, mas o instalador inicia
  // somente o servidor Companion (4891) que recebe /api/chat.
  const demoCode=await readFile(path.join(root,'studio/demo.js'),'utf8');
  const {requestedNavigationId}=await import('data:text/javascript;base64,'+Buffer.from(demoCode).toString('base64'));
  assert.equal(requestedNavigationId('me mostre operações e fale mais sobre ela'),'operacoes');
  assert.equal(requestedNavigationId('abra o painel de compras'),'compras');
  assert.equal(requestedNavigationId('mostre pessoas'),'pessoas');
  assert.equal(requestedNavigationId('abra segurança'),'seguranca');
  assert.equal(requestedNavigationId('o que são operações CRUD?'),null);
  const dashboard=await readFile(path.join(root,'studio/app.js'),'utf8');
  assert.doesNotMatch(dashboard,/command-form/,'Não pode haver segundo campo de conversa');
  assert.match(dashboard,/holo:navigate-area/,'Painel flutuante precisa navegar na mesma cena');
  const companion=await readFile(path.join(root,'studio/companion.js'),'utf8');
  assert.match(companion,/requestedNavigationId\(message\)/,'Assistente único precisa reconhecer navegação');
  const html=await readFile(path.join(root,'index.html'),'utf8');
  assert.equal((html.match(/id="hc-input"/g)||[]).length,0,'Chat é montado pelo Companion');
  assert.doesNotMatch(html,/id="command-input"/,'HTML não deve duplicar chat');
  assert.match(html,/holo-companion-slot/,'Conversa única precisa de uma aba dedicada');
  const serverCode=await readFile(path.join(root,'services/holo-companion.mjs'),'utf8');
  assert.match(serverCode,/operacoes:\['Operações'/,'Servidor deve entender contexto da area Operações');
  // Protege computadores de entrada contra regressão de prompts enormes.
  assert.match(serverCode,/memory\.history\.slice\(-4\)/,'Enviar somente histórico recente');
  assert.match(serverCode,/holoEvidence\.slice\(0,4\)/,'Limitar conhecimento enviado ao modelo');
  assert.match(serverCode,/num_ctx:localCtx,num_predict:localPredict/,'Limitar contexto e geração do Ollama');
  assert.match(serverCode,/2048,1024,8192/,'Perfil conservador inicial para 4 GB de VRAM');
  assert.match(companion,/fetch\(url/,'O único chat deve chamar o Companion');
  assert.doesNotMatch(dashboard,/127\.0\.0\.1:4892\/api\/assist/,'Nao usar o endpoint legado que exige outro servidor');
  const health=await(await fetch(base+'/api/health')).json();
  assert.equal(health.ok,true);
  assert.equal(health.brainConfigured,false);
  assert.equal(health.documentsConfigured,false);
  assert.equal(health.provider,'local');
  assert.equal((await fetch(base+'/index.html')).status,200);
  assert.equal((await fetch(base+'/studio/companion.js')).status,200);
  assert.equal((await fetch(base+'/vendor/vision_bundle.mjs')).status,200);
  assert.equal((await fetch(base+'/vendor/hand_landmarker.task')).status,200);
  assert.equal((await fetch(base+'/services/holo-companion.mjs')).status,404);
  assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://site-nao-autorizado.test'}})).status,403);
  // Sem login POSSEBON, endpoints de dados devem ser BLOQUEADOS.
  for(const route of ['/api/documents','/api/history','/api/document?name=x.txt']){
    const r=await fetch(base+route);assert.equal(r.status,401,route);
  }
  const note=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'HOLO, lembre que esta é uma nota de teste'})});
  assert.equal(note.status,401,'chat sem autenticação deve ser bloqueado');
  const again=await(await fetch(base+'/api/health')).json();
  assert.equal(again.notesCount,0,'nenhuma nota pode ser salva sem usuário');
  const liveWithoutAccess=await fetch(base+'/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'quantas pessoas temos na epc 13 ativas hoje?'})});
  assert.equal(liveWithoutAccess.status,401,'contagem real exige login');
  const missing=await liveWithoutAccess.json();
  assert.equal(missing.ok,false);
  assert.match(missing.error,/POSSEBON/);
  const invalid=await fetch(base+'/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"message":""}'});
  assert.equal(invalid.status,401,'validar credenciais antes do payload');
  console.log('OK: Companion, arquivos estáticos, memória local, origem e isolamento de rotas.');
}finally{
  child.kill('SIGTERM');
  await new Promise(ok=>child.once('exit',ok));
  await rm(temp,{recursive:true,force:true});
}
