/**
 * Linguagem de negócio para resultados POSSEBON. Não altera valores do banco:
 * somente a apresentação de resultados autorizados.
 *
 * Dicionários são POR tabela/campo. O código A pode ter significado diferente
 * em outro módulo e jamais deve ser traduzido globalmente.
 * Outros códigos precisam ser validados com o model/Designer do MAD Builder
 * antes de serem acrescentados. Nunca inferir descrição pela letra.
 */
const codeDictionaries: Record<string, Record<string,string>> = {
  'colaborador.status': {
    A: 'Ativo',
    D: 'Desligado'
  }
};

const exactLabels: Record<string,string> = {
  'colaborador.status':'Situação do colaborador',
  'colaborador.id':'Colaborador',
  'colaborador.equipe_id':'Equipe',
  'colaborador.funcao_id':'Função',
  'equipe.nome':'Equipe',
  'funcao.nome':'Função',
  'pessoa.nome':'Nome',
  'colaborador.criado_em':'Data de cadastro',
  'colaborador.deletado_em':'Data de exclusão'
};

const aliasLabels: Record<string,string> = {
  'status':'Situação',
  'situacao':'Situação',
  'quantidade':'Quantidade',
  'qtd':'Quantidade',
  'total':'Total',
  'total_cadastrados':'Total de colaboradores cadastrados',
  'total_colaboradores':'Total de colaboradores',
  'quantidade_colaboradores':'Quantidade de colaboradores',
  'nome':'Nome',
  'funcao':'Função',
  'equipe':'Equipe',
  'gerencia':'Gerência',
  'data':'Data'
};

export function businessColumnLabel(
  table:string,
  column:string,
  alias:string,
  aggregate?:string
):string {
  if (aggregate === 'count' && table === 'colaborador') {
    if (alias === 'total_cadastrados') return 'Total de colaboradores cadastrados';
    return 'Quantidade de colaboradores';
  }
  if (aggregate === 'count') return 'Quantidade';
  if (aliasLabels[alias.toLowerCase()]) return aliasLabels[alias.toLowerCase()]!;
  if (exactLabels[table+'.'+column]) return exactLabels[table+'.'+column]!;
  const cleaned=alias.replace(/^c[0-9]+$/,column).replace(/_/g,' ').trim();
  return cleaned ? cleaned[0]!.toUpperCase()+cleaned.slice(1) : 'Valor';
}

export function businessValue(table:string,column:string,value:unknown):unknown {
  if (value == null) return value;
  const dictionary=codeDictionaries[table+'.'+column];
  if (!dictionary || typeof value !== 'string') return value;
  const key=value.trim().toUpperCase();
  if (!key) return 'Não informado';
  return dictionary[key] ?? ('Situação sem descrição cadastrada (código '+key+')');
}
