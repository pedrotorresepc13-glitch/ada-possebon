// Intenções operacionais devem ser tratadas por consultas explícitas e autorizadas.
// Não permitir que o Llama invente registros de pessoas, equipes, compras ou refeitório.
export function operationalIntent(question){
  const q=String(question||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const requestedUnit=/\bepc\s*[-]?\s*13\b/.test(q)?3:null;
  const staff=/\b(?:pessoa|pessoas|colaborador|colaboradores|funcionario|funcionarios|empregado|empregados)\b/.test(q);
  const active=/\b(?:ativo|ativos|ativa|ativas|trabalhando|contratado|contratados|efetivo)\b/.test(q);
  const quantity=/\b(?:quanto|quantos|quantas|quantidade|numero|numeros|total|temos|existem|contagem|ha)\b/.test(q);
  if(staff&&active&&quantity)return {name:'colaboradores_ativos',requestedUnit};
  if(staff && /\b(?:quem|nomes?|listar|listagem|quais|relacao)\b/.test(q))
    return {name:'consulta_nao_integrada',requestedUnit,subject:'Nomes de colaboradores'};
  if(/\b(?:refeitorio|catraca|acessos? ao restaurante)\b/.test(q) &&
     /\b(?:quantos|quantas|quantidade|acesso|entraram|entrou|frequentaram|hoje|ontem|mes)\b/.test(q))
    return {name:'consulta_nao_integrada',requestedUnit,subject:'Acessos ao refeitório'};
  if(/\b(?:equipe|setor|departamento)\b/.test(q) &&
     /\b(?:ti|tecnologia|informatica|colaborador|nomes?|quem|integram|fazem parte)\b/.test(q))
    return {name:'consulta_nao_integrada',requestedUnit,subject:'Integrantes da equipe'};
  if(/\b(?:compra|compras|solicitac(?:ao|oes)|procurement|pedido(?:s)? de material)\b/.test(q) &&
     /\b(?:status|situacao|pendente|aprovada|aprovado|quanto|quantos|quantas|grafico|painel|andamento)\b/.test(q))
    return {name:'consulta_nao_integrada',requestedUnit,subject:'Situação das compras'};
  if(/\b(?:contratac(?:ao|oes)|vagas?|recrutamento|candidato|admissao)\b/.test(q) &&
     /\b(?:situacao|status|andamento|solicitei|solicitadas?|minha equipe|meus pedidos)\b/.test(q))
    return {name:'consulta_nao_integrada',requestedUnit,subject:'Solicitações de contratação'};
  return null;
}
