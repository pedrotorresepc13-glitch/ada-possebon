// Respostas sobre o que a HOLO estudou: estritamente baseadas no indice Brain da sessao.
function normalize(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
export function isKnowledgeInventoryQuestion(message){
  const q=normalize(message).replace(/[?!.,]/g,' ').replace(/\s+/g,' ').trim();
  return /^(?:(?:holo|ola|oi)\s+)?(?:(?:o que|quais coisas|que coisas)\s+(?:voce\s+)?(?:sabe|conhece|aprendeu|estudou)|(?:qual|quais)\s+(?:o seu conhecimento|os seus conhecimentos|os modulos que voce conhece)|(?:me\s+)?(?:mostre|diga|resuma|explique)\s+(?:o que|seu conhecimento|o conhecimento)\s+(?:voce\s+)?(?:sabe|conhece|aprendeu|estudou)?)(?:\s+(?:da|de|do|sobre|a respeito do)\s+(?:epc\s*13|possebon|sistema|brain))?$/.test(q);
}
export function summarizeKnowledge(status,overview){
  if(!status?.connected){
    return 'Posso explicar o POSSEBON, mas não tenho uma sessão ativa para consultar o catálogo desta unidade agora. Conecte o POSSEBON na HOLO e eu mostrarei o que já foi estudado no Brain.';
  }
  if(!overview?.ready){
    return 'Estou conectado à unidade '+status.unit_id+', mas ainda não tenho um estudo completo do POSSEBON Brain nesta sessão. Use "Estudar / atualizar Brain" para construir o catálogo.';
  }
  const count=Number(overview.total)||0;
  const ns=Object.entries(overview.namespaces||{}).filter(([k,v])=>/^[a-z0-9_-]+$/i.test(k)&&Number(v)>0)
    .sort((a,b)=>b[1]-a[1]).slice(0,6)
    .map(([name,n])=>name+': '+Number(n).toLocaleString('pt-BR'));
  const areas=Object.values(overview.areas||{}).filter(a=>a.id!=='geral'&&Number(a.count)>0)
    .sort((a,b)=>Number(b.count)-Number(a.count)).slice(0,4);
  const topics=areas.map(a=>a.title+' ('+Number(a.count).toLocaleString('pt-BR')+' itens associados)').join(', ');
  const examples=[...new Map(areas.flatMap(a=>a.examples||[]).filter(x=>x.title)
    .map(x=>[x.title,x])).values()].slice(0,4);
  const sampled=examples.map(x=>x.title+' ['+(x.source||x.namespace||'Brain')+']').join('; ');
  return 'Na unidade '+status.unit_id+', estudei '+count.toLocaleString('pt-BR')+
    ' itens do catálogo POSSEBON Brain. Tipos de conhecimento: '+(ns.join(', ')||'não classificados')+'. '+
    (topics?'Áreas relacionadas: '+topics+'. ':'')+
    (sampled?'Exemplos de fontes: '+sampled+'. ':'')+
    'Isso inclui metadados, estruturas e regras já catalogadas — não significa acesso automático a todos os registros operacionais. '+
    'Para números atuais, como colaboradores ativos, utilizo as APIs operacionais autorizadas da unidade.';
}
