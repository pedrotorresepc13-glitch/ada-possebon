// EXCLUSIVAMENTE DADOS SINTÉTICOS PARA TESTES DA INTERFACE.
// Nunca confundir estes valores com informações reais de clientes ou da POSSEBON.
export const areas = [
  {id:"geral",name:"Visão geral",icon:"✧",color:0x64e6db,description:"Panorama fictício de uma empresa de demonstração.",
   stats:[["Pessoas","128"],["Equipes","12"],["Projetos","8"],["Índice ilustrativo","84%"]],
   bars:[["Pessoas",128],["Equipes",12],["Projetos",8]],summary:"Este é um conjunto artificial de indicadores para demonstrar a experiência visual."},
  {id:"pessoas",name:"Pessoas",icon:"♧",color:0x66a9ff,description:"Exemplo de acompanhamento de colaboradores, equipes e treinamentos.",
   stats:[["Colaboradores","128"],["Equipes","12"],["Treinamentos","16"],["Conclusão","82%"]],
   bars:[["Operações",62],["Suporte",28],["Gestão",14],["Outros",24]],summary:"Na amostra fictícia, existem 128 colaboradores distribuídos entre 12 equipes."},
  {id:"compras",name:"Compras",icon:"◈",color:0xffc776,description:"Painel demonstrativo de aquisições, fornecedores e solicitações.",
   stats:[["Solicitações","42"],["Fornecedores","18"],["Em análise","9"],["Valor simulado","R$ 284 mil"]],
   bars:[["Materiais",48],["Serviços",24],["Equipamentos",17],["Outros",11]],summary:"Na amostra fictícia, há 42 solicitações de compras, sendo 9 em análise."},
  {id:"seguranca",name:"Segurança",icon:"⬡",color:0xff769d,description:"Dados simulados de inspeções, planos de ação e treinamentos.",
   stats:[["Inspeções","36"],["Planos","11"],["Concluídos","7"],["Indicador","64%"]],
   bars:[["Concluídos",7],["Pendentes",4]],summary:"A demonstração contém 11 planos de ação fictícios, dos quais 7 estão concluídos."},
  {id:"operacoes",name:"Operações",icon:"◇",color:0xba94ff,description:"Visão ilustrativa de projetos, atividades e andamento.",
   stats:[["Projetos","8"],["Atividades","63"],["Em andamento","22"],["Finalizadas","41"]],
   bars:[["Finalizadas",41],["Em andamento",22]],summary:"Na amostra fictícia, 41 de 63 atividades estão finalizadas."}
];
export const helpText="Você pode dizer: mostrar pessoas, abrir compras, ver segurança, operações, visão geral, fazer resumo ou iniciar apresentação. Para dados reais, será necessário conectar e autorizar uma fonte.";

/**
 * Detecta SOMENTE pedidos explícitos de navegação na interface (não perguntas
 * genéricas sobre CRUD). Puro e seguro: não executa comandos ou integrações.
 */
export function requestedNavigationId(message) {
  const q=String(message||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(!/\b(?:mostra|mostre|mostrar|abre|abra|abrir|exibe|exiba|exibir|acesse|acessar|acesse|navegue|navegar|visualize|visualizar|veja|ver|entre|entrar|leva|leve|ir|va|vá)\b/.test(q))return null;
  const names=[
    ['operacoes',/\b(?:operacao|operacoes|projeto|projetos|atividade|atividades|producao|obras|obra)\b/],
    ['pessoas',/\b(?:pessoa|pessoas|colaborador|colaboradores|funcionario|funcionarios|equipe|equipes|rh|treinamento|treinamentos)\b/],
    ['compras',/\b(?:compra|compras|material|materiais|fornecedor|fornecedores|solicitacao|solicitacoes|suprimentos)\b/],
    ['seguranca',/\b(?:seguranca|inspecao|inspecoes|auditoria|auditorias|ronda|rondas)\b/],
    ['geral',/\b(?:geral|inicio|panorama|principal)\b/]
  ];
  return names.find(([id,re])=>re.test(q))?.[0]||null;
}
