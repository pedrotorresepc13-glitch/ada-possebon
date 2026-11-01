/** Classificação de nomes para navegação; não comprova regra de negócio nem autorização. */
export function processArea(name:string){
  const rules:[string,RegExp][]=[['Compras',/compra|procurement|purchase|cotacao|fornecedor|requisicao/],['Contratos e documentos',/contrat|document|ged_|obrigac/],['Execução e produção',/rdo|produca|medicao|planej|cronograma|atividade|obra/],['Materiais e patrimônio',/material|estoque|almox|patrimonio|equipamento|produto/],['Pessoas e equipes',/colaborador|equipe|funcao|treinamento|efetivo/],['Financeiro',/finance|pagamento|fatura|custo|orcamento|receita/],['Qualidade e segurança',/qualidade|inspecao|seguranca|ocorrencia|sms_/]];
  return rules.find(([,re])=>re.test(name))?.[0]??'Outros processos';
}
export function diverseTables<T extends {nome:string}>(tables:T[],limit=6):T[]{
  const groups=new Map<string,T[]>();
  for(const t of tables){const key=processArea(t.nome);const list=groups.get(key)??[];list.push(t);groups.set(key,list);}
  const result:T[]=[];
  while(result.length<limit){let added=false;for(const list of groups.values()){const t=list.shift();if(t){result.push(t);added=true;}if(result.length===limit)break;}if(!added)break;}
  return result;
}
