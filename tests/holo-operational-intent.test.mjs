// Testes sem conexão de produção: nenhum número ou nome deve ser inventado.
import assert from 'node:assert/strict';
import {operationalIntent} from '../services/holo-operational-intent.mjs';
assert.deepEqual(operationalIntent('quantas pessoas temos na epc 13 ativas hoje?'),{
  name:'colaboradores_ativos',requestedUnit:3
});
assert.deepEqual(operationalIntent('Quantos COLABORADORES ATIVOS temos na EPC13?'),{
  name:'colaboradores_ativos',requestedUnit:3
});
assert.deepEqual(operationalIntent('Qual é o total de funcionários ativos?'),{
  name:'colaboradores_ativos',requestedUnit:null
});
for(const [question,subject] of [
  ['quem são os colaboradores da equipe do TI?','Nomes de colaboradores'],
  ['mas quem são os colaboradores?','Nomes de colaboradores'],
  ['quantas pessoas entraram no refeitório hoje?','Acessos ao refeitório'],
  ['Quantas compras temos hoje?','Situação das compras'],
  ['como estão as contratações que solicitei?','Solicitações de contratação']
]){
  const intent=operationalIntent(question);
  assert.equal(intent?.name,'consulta_nao_integrada',question);
  assert.equal(intent?.subject,subject,question);
}
assert.equal(operationalIntent('Qual é o schema da tabela colaborador?'),null);
assert.equal(operationalIntent('Mostre a área de Operações'),null);
assert.equal(operationalIntent('Temos pessoas cadastradas na EPC13?'),null);
console.log('HOLO: métricas reais usam rotas específicas; perguntas sem rota nunca vão ao LLM.');
