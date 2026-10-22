// Não usa dados de produção. Verifica intenção e impede uso de LLM para contagens reais.
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
assert.equal(operationalIntent('Qual é o schema da tabela colaborador?'),null);
assert.equal(operationalIntent('Mostre a área de Operações'),null);
assert.equal(operationalIntent('Quantas compras temos hoje?'),null);
assert.equal(operationalIntent('Temos pessoas cadastradas na EPC13?'),null);
console.log('HOLO operacional: perguntas de colaborador ativo roteadas de forma determinística OK');
