import assert from 'node:assert/strict';
import {isKnowledgeInventoryQuestion,summarizeKnowledge} from '../services/holo-knowledge-answer.mjs';
for(const q of ['o que você sabe?','o que voce aprendeu','quais coisas você conhece','HOLO, o que você sabe?',
  'o que voce sabe sobre possebon?']){
  assert.equal(isKnowledgeInventoryQuestion(q),true,q);
}
for(const q of ['quantas pessoas temos ativas na EPC13?','quais pessoas estão ativas?','abrir segurança']){
  assert.equal(isKnowledgeInventoryQuestion(q),false,q);
}
const overview={ready:true,total:245,namespaces:{rule:12,schema:203,permission:30},
 areas:{geral:{id:'geral',count:245},pessoas:{id:'pessoas',title:'Pessoas',count:40,
 examples:[{title:'Schema colaborador',namespace:'schema',source:'public.colaborador'}]},
 compras:{id:'compras',title:'Compras',count:12,examples:[{title:'Modelo Procurement',source:'curadoria'}]}}};
const status={connected:true,unit_id:3};
const answer=summarizeKnowledge(status,overview);
assert.match(answer,/245 itens do catálogo POSSEBON Brain/);
assert.match(answer,/unidade 3/);
assert.match(answer,/rule: 12/);
assert.match(answer,/Pessoas/);
assert.match(answer,/public.colaborador/);
assert.match(answer,/não significa acesso automático/);
assert.doesNotMatch(answer,/não tenho acesso a informações em tempo real/);
assert.match(summarizeKnowledge({connected:false,unit_id:3},overview),/sessão ativa/);
assert.match(summarizeKnowledge(status,{ready:false}),/estudo completo/);
console.log('Resumo de conhecimento: baseado em fontes reais, sem alucinacao.');
