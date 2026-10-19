// Serviço LOCAL de desenvolvimento. NÃO exponha esta porta diretamente na internet.
// Node.js 22+. Configurações e credenciais ficam apenas em variáveis de ambiente.
// Este serviço não acessa dados de empresas. Recebe somente o texto enviado pelo operador.
import http from 'node:http';

const PORT=Number(process.env.HOLO_ASSISTANT_PORT||4892);
const allowedOrigins=new Set(['http://localhost:4891','http://127.0.0.1:4891']);
const localUrl='http://127.0.0.1:11434/api/chat';
const apiUrl=process.env.HOLO_API_URL||'https://api.openai.com/v1/chat/completions';
const apiKey=process.env.HOLO_API_KEY||'';
const maxBytes=4096;

function send(res,code,data,origin='') {
  res.writeHead(code,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})
  });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  return await new Promise((resolve,reject)=>{
    let body='',size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>maxBytes){reject(new Error('Requisição excedeu 4 KB'));req.destroy();return;}
      body+=chunk.toString('utf8');
    });
    req.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(new Error('JSON inválido'));}});
    req.on('error',reject);
  });
}
function asText(content) {
  if(typeof content==='string')return content.trim();
  if(Array.isArray(content))return content.filter(p=>p?.type==='text').map(p=>p.text||'').join('\n').trim();
  return '';
}
async function generate({prompt,area,provider}) {
  const sys='Você é o assistente demonstrativo HOLO Enterprise. Responda em português brasileiro. Não invente dados, números ou fontes empresariais. Não há bancos, APIs, memórias nem empresas reais conectadas. Se pedirem números reais, explique que a fonte ainda não foi vinculada. Área em foco: '+area+'.';
  if(provider==='local'){
    const model=process.env.HOLO_LOCAL_MODEL||'llama3.2';
    const response=await fetch(localUrl,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model,stream:false,messages:[{role:'system',content:sys},{role:'user',content:prompt}]}),
      signal:AbortSignal.timeout(45000)
    });
    if(!response.ok)throw new Error('Modelo local indisponível (HTTP '+response.status+')');
    const data=await response.json();return asText(data?.message?.content);
  }
  if(provider==='api'){
    if(!apiKey)throw new Error('HOLO_API_KEY não configurada no servidor');
    const url=new URL(apiUrl);
    if(url.protocol!=='https:')throw new Error('A API externa deve usar HTTPS');
    const response=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({model:process.env.HOLO_API_MODEL||'gpt-4o-mini',messages:[{role:'system',content:sys},{role:'user',content:prompt}],temperature:.2}),
      signal:AbortSignal.timeout(45000)
    });
    if(!response.ok)throw new Error('API indisponível (HTTP '+response.status+')');
    const data=await response.json();return asText(data?.choices?.[0]?.message?.content);
  }
  throw new Error('Provedor não suportado');
}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';
  if(req.method==='OPTIONS'){
    if(!allowedOrigins.has(origin))return send(res,403,{error:'Origem não autorizada'});
    res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'});res.end();return;
  }
  if(req.method==='GET'&&req.url==='/health')return send(res,200,{ok:true,mode:'local-development',connectedToEnterprise:false},origin);
  if(req.method!=='POST'||req.url!=='/api/assist')return send(res,404,{error:'Rota inexistente'},origin);
  if(!allowedOrigins.has(origin))return send(res,403,{error:'Origem não autorizada'},origin);
  try{
    const data=await readBody(req);
    const prompt=String(data?.prompt||'').trim();
    const area=String(data?.area||'visão geral').slice(0,80);
    const provider=data?.provider;
    if(!prompt||prompt.length>1800||!['local','api'].includes(provider))return send(res,400,{error:'Pedido inválido'},origin);
    const answer=await generate({prompt,area,provider});
    if(!answer)throw new Error('Modelo retornou resposta vazia');
    send(res,200,{answer,provider,enterpriseDataConnected:false},origin);
  }catch(err){send(res,502,{error:String(err?.message||'Falha na execução').slice(0,200)},origin);}
});
server.listen(PORT,'127.0.0.1',()=>console.log('HOLO: ponte local de IA iniciada em 127.0.0.1:'+PORT));
