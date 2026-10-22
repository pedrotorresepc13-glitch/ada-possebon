// Perguntas que exigem dados operacionais NÃO devem ser respondidas por RAG/LLM.
// Reconhecimento restrito a métricas disponíveis e explicitamente autorizadas.
export function operationalIntent(question) {
  const q=String(question||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const staff=/\b(?:pessoa|pessoas|colaborador|colaboradores|funcionario|funcionarios|empregado|empregados)\b/.test(q);
  const active=/\b(?:ativo|ativos|ativa|ativas|trabalhando|contratado|contratados|efetivo)\b/.test(q);
  const quantity=/\b(?:quanto|quantos|quantas|quantidade|numero|numeros|total|temos|existem|contagem|ha)\b/.test(q);
  if(staff && active && quantity){
    // Unidade mencionada explicitamente precisa coincidir com a sessão.
    const requestedUnit=/\bepc\s*[-]?\s*13\b/.test(q)?3:null;
    return {name:'colaboradores_ativos',requestedUnit};
  }
  return null;
}
