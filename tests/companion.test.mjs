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
  const dashboard=await readFile(path.join(root,'studio/app.js'),'utf8');
  assert.match(dashboard,/fetch\('\/api\/chat'/,'O painel principal deve usar o Companion');
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
  const d=await(await fetch(base+'/api/documents')).json();
  assert.equal(d.configured,false);
  assert.deepEqual(d.files,[]);
  const note=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'HOLO, lembre que esta é uma nota de teste'})});
  assert.equal(note.status,200);
  const memo=await note.json();
  assert.equal(memo.provider,'memory');
  assert.equal(memo.brain,'nao_consultado');
  const again=await(await fetch(base+'/api/health')).json();
  assert.equal(again.notesCount,1);
  const invalid=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"message":""}'});
  assert.equal(invalid.status,400);
  console.log('OK: Companion, arquivos estáticos, memória local, origem e isolamento de rotas.');
}finally{
  child.kill('SIGTERM');
  await new Promise(ok=>child.once('exit',ok));
  await rm(temp,{recursive:true,force:true});
}
