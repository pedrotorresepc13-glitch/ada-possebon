/** Transformação determinística de dados acompanhados em informações de negócio.
 * A tradução só afirma o que foi medido; status internos desconhecidos não são adivinhados.
 */
export interface WatchChange {
  field: string;
  label: string;
  before: string;
  after: string;
}
const labels: Record<string, string> = {
  solicitacao: 'Solicitação de compra',
  ordem_compra: 'Ordem de compra',
  conclusao_cotacao: 'Conclusão da cotação',
  autorizacao_compra: 'Autorização da compra',
  previsao_autorizacao: 'Previsão de autorização',
  ultima_alteracao: 'Data de atualização',
  status: 'Situação',
  situacao: 'Situação',
  etapa: 'Etapa',
  valor: 'Valor',
  valor_total: 'Valor total',
  fornecedor: 'Fornecedor',
  data_entrega: 'Data de entrega'
};
const technical = /^(?:c\d+|id|record_id|unit_id|codcoligada|codfilial)$/i;
const dateLabel = /(?:data|previsao|alteracao|conclusao|autorizacao|entrega)/i;

export function watchLabel(field: string): string {
  const key = field.toLowerCase();
  return labels[key] ?? key.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
}
export function watchDisplay(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return 'não informado';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'number') return String(value);
  const string = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!string || string === 'null') return 'não informado';
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(string) && dateLabel.test(field)) {
    const date = new Date(string.length === 10 ? string + 'T12:00:00Z' : string);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        ...(string.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {})
      }).format(date);
    }
  }
  return string.length > 120 ? string.slice(0, 117) + '…' : string;
}
export function watchFields(row: Record<string, unknown>) {
  return Object.entries(row)
    .filter(([field]) => !technical.test(field))
    .map(([field, value]) => ({ field, label: watchLabel(field), value: watchDisplay(value, field) }));
}
export function watchDifferences(before: Record<string, unknown>, after: Record<string, unknown>): WatchChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(field => !technical.test(field) && JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map(field => ({
      field, label: watchLabel(field),
      before: watchDisplay(before[field], field), after: watchDisplay(after[field], field)
    }));
}
export function watchSummary(name: string, changes: WatchChange[]) {
  const business = changes.filter(change => change.field !== 'ultima_alteracao');
  if (business.length) {
    const details = business.slice(0, 3).map(c => c.label + ': ' + c.before + ' → ' + c.after).join('; ');
    return name + ': ' + details + (business.length > 3 ? '; e outras ' + (business.length - 3) + ' mudanças.' : '.');
  }
  if (changes.some(change => change.field === 'ultima_alteracao'))
    return name + ': o cadastro foi atualizado, mas nenhuma alteração nas demais etapas acompanhadas foi confirmada.';
  return name + ': atualização detectada, sem mudança identificável nos campos de negócio selecionados.';
}
