import type { DashboardPatchOp, DashboardSpec, DashboardSpecInput, RuleDefinitionInput, Trigger, WidgetType } from '@ada/contracts';
import { normalizeText, type Catalog, type MetricDef, type SourceDef } from './catalog.ts';

/**
 * Interpretador DETERMINÍSTICO de comandos em português (sem IA).
 * Usado quando nenhum provedor de IA está configurado e como base dos testes.
 * Ele só produz estruturas validáveis; não inventa métricas nem dados.
 */
export type Intent =
  | { kind: 'create_dashboard'; spec: DashboardSpecInput; notes: string[] }
  | { kind: 'patch_dashboard'; ops: DashboardPatchOp[]; notes: string[] }
  | { kind: 'save_dashboard'; title: string }
  | { kind: 'create_monitor'; definition: RuleDefinitionInput }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'knowledge_question'; query: string }
  | { kind: 'help' };

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  quinze: 15, vinte: 20, trinta: 30
};

function parseAmount(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

const CHART_WORDS: [RegExp, WidgetType][] = [
  [/empilhad/, 'stacked_bar'],
  [/\blinhas?\b/, 'line'],
  [/\bbarras?\b|\bcolunas?\b/, 'bar'],
  [/\barea\b/, 'area'],
  [/\bpizza\b/, 'pie'],
  [/\brosca\b/, 'donut'],
  [/\btabela\b/, 'table'],
  [/\b(kpi|indicador|cartao|numero)\b/, 'kpi'],
  [/meta x realizado|meta-realizado|meta realizado|previsto x realizado/, 'target_vs_actual'],
  [/distribuicao|histograma/, 'distribution']
];

function findChartType(q: string): WidgetType | null {
  for (const [re, t] of CHART_WORDS) if (re.test(q)) return t;
  return null;
}

function findTimeRange(q: string): { kind: 'last'; amount: number; unit: 'day' | 'week' | 'month' } | null {
  const m = /ultim[oa]s?\s+(\d+|\w+)\s+(dias?|semanas?|mes|meses)/.exec(q);
  if (m) {
    const amount = parseAmount(m[1]!);
    if (amount) {
      const unit = m[2]!.startsWith('dia') ? 'day' : m[2]!.startsWith('semana') ? 'week' : 'month';
      return { kind: 'last', amount: Math.min(amount, 36), unit };
    }
  }
  if (/\b(este|neste|esse) mes\b|mes atual/.test(q)) return { kind: 'last', amount: 1, unit: 'month' };
  if (/\b(este|neste) ano\b|\bano\b/.test(q)) return { kind: 'last', amount: 12, unit: 'month' };
  return null;
}

/** Escolhe a métrica cujo sinônimo mais longo aparece no texto. */
export function findMetric(q: string, catalog: Catalog): MetricDef | null {
  let best: MetricDef | null = null;
  let bestLen = 0;
  for (const m of Object.values(catalog.metrics)) {
    for (const s of m.synonyms) {
      const re = new RegExp(`\\b${normalizeText(s)}\\b`);
      if (re.test(q) && s.length > bestLen) {
        best = m;
        bestLen = s.length;
      }
    }
  }
  return best;
}

function findGroupBy(q: string, metric: MetricDef | null, catalog: Catalog): string[] {
  const out: string[] = [];
  for (const m of q.matchAll(/\bpor\s+(\w+)/g)) {
    const word = m[1]!;
    const dim = Object.values(catalog.dimensions).find((d) => d.synonyms.includes(word));
    if (dim && (!metric || metric.dimensions[dim.id]) && !out.includes(dim.id)) out.push(dim.id);
  }
  return out;
}

function grainFor(range: { unit: string; amount: number } | null): 'day' | 'week' | 'month' {
  if (!range) return 'month';
  if (range.unit === 'day') return range.amount > 31 ? 'week' : 'day';
  if (range.unit === 'week') return 'week';
  return 'month';
}

const CREATE_VERBS = /\b(cri[ae]r?|mont[ae]r?|ger[ae]r?|fa[cz]a?|faca|mostr[ae]r?|quero|exib[ae]|desenh[ae]|plot[ae])\b/;
const PATCH_VERBS = /\b(mud[ae]r?|troc[ae]r?|alter[ae]r?|transform[ae]r?|coloc[ae]r?|deix[ae]r?|adicion[ae]r?|inclu[ai]r?|compar[ae]r?|agrup[ae]r?|ordene?)\b/;
const MONITOR_VERBS = /\b(monitor\w*|acompanh\w*|vigi\w*|observ\w*|avis[ae]\w*|alert\w*|notifiqu\w*)\b/;

function findMonitorSource(q: string, catalog: Catalog): SourceDef | null {
  for (const s of Object.values(catalog.sources)) {
    if (!s.monitor) continue;
    if (s.synonyms.some((syn) => new RegExp(`\\b${normalizeText(syn)}\\b`).test(q))) return s;
  }
  return null;
}

function parseMonitor(q: string, catalog: Catalog): Intent | null {
  if (!MONITOR_VERBS.test(q)) return null;
  const source = findMonitorSource(q, catalog);
  if (!source || !source.monitor) {
    return {
      kind: 'unsupported',
      reason:
        'Ainda não há uma fonte monitorável catalogada para esse pedido. A regra precisa de uma fonte autorizada e de campos catalogados; registrei que isso requer implementação.'
    };
  }
  const mon = source.monitor;
  const deadline = mon.fields.find((f) => /prazo|vencimento|entrega/.test(f.name) && (f.type === 'date' || f.type === 'timestamp'));
  const triggers: Trigger[] = [];
  if (deadline && /(prazo|data|entrega)[^.]{0,40}\b(mud|alter|mex)|(mud|alter|mex)\w*[^.]{0,40}(prazo|data|entrega)/.test(q)) {
    triggers.push({ type: 'field_changed', field: deadline.name });
  }
  const stale = /(\d+|\w+)\s*(h|hs|horas?|dias?)\s+sem\s+(atualiza|avanc|movimenta|andamento)/.exec(q) ?? /sem\s+(atualiza\w*|avanc\w*|movimenta\w*)\s+(por|ha|durante)?\s*(\d+|\w+)\s*(h|hs|horas?|dias?)/.exec(q);
  if (stale) {
    const amountTok = stale[0].match(/(\d+|\b(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta)\b)/)?.[1];
    const amount = amountTok ? parseAmount(amountTok) : null;
    const isDays = /dias?/.test(stale[0]);
    if (amount) triggers.push({ type: 'no_update_for', field: mon.updatedAtField, duration_hours: Math.min(isDays ? amount * 24 : amount, 2160) });
  }
  if (deadline && /\b(venc\w*|atras\w*|estour\w*|expir\w*)/.test(q)) triggers.push({ type: 'deadline_passed', field: deadline.name });
  const near = /falt\w*\s+(\d+|\w+)\s*(h|hs|horas?|dias?)/.exec(q);
  if (deadline && (near || /(perto|proxim\w*|antes) d[oa] (prazo|vencimento|entrega)/.test(q))) {
    const n = near ? parseAmount(near[1]!) ?? 24 : 24;
    triggers.push({ type: 'deadline_near', field: deadline.name, within_hours: Math.min(near && /dia/.test(near[2]!) ? n * 24 : n, 720) });
  }
  if (mon.statusField && /\bstatus\b|situacao/.test(q)) triggers.push({ type: 'status_changed', field: mon.statusField });
  const keyMatch = new RegExp(`\\b(?:${source.synonyms.map(normalizeText).join('|')})\\s*(?:n[o.]?\\s*|numero\\s*|#)?(\\d{1,12})\\b`).exec(q);
  if (!keyMatch && /\b(nova|novo|novas|novos|criad\w*|abert\w*)\b/.test(q)) triggers.push({ type: 'record_created' });
  if (triggers.length === 0) {
    return {
      kind: 'unsupported',
      reason:
        'Não identifiquei um gatilho suportado. Hoje consigo acompanhar: alteração de campo ou status, criação de registro, período sem atualização, prazo próximo ou vencido, limite numérico e variação percentual.'
    };
  }
  const filters = keyMatch ? [{ field: mon.keyField, op: 'eq' as const, value: Number(keyMatch[1]) }] : [];
  const name = keyMatch ? `Acompanhar ${mon.recordLabel} ${keyMatch[1]}` : `Acompanhar ${source.label}`;
  return {
    kind: 'create_monitor',
    definition: {
      version: 1,
      name,
      source: source.id,
      scope: { unit: 'from_authenticated_session' },
      filters,
      triggers,
      match: 'any',
      actions: [{ type: 'in_app_notification', recipient: 'rule_owner' }],
      cooldown_minutes: 60,
      enabled: false
    }
  };
}

export function parseIntent(text: string, catalog: Catalog, current: DashboardSpec | null): Intent {
  const raw = text.trim();
  const q = normalizeText(raw);
  if (!q || /^(ajuda|help|o que voce faz|comandos)\b/.test(q)) return { kind: 'help' };

  const save = /\bsalv[ae]r?\b(?:\s+(?:o\s+)?(?:dashboard|painel|grafico))?\s+como\s+(.+)$/i.exec(raw.normalize('NFC'));
  if (save) return { kind: 'save_dashboard', title: save[1]!.trim().replace(/^["“']|["”']$/g, '').slice(0, 120) };

  const monitor = parseMonitor(q, catalog);
  if (monitor) return monitor;

  const metric = findMetric(q, catalog);
  const chart = findChartType(q);
  const range = findTimeRange(q);
  const groupBy = findGroupBy(q, metric, catalog);

  // Refinamento do dashboard atual: só quando há dashboard em edição e o pedido não cria outro.
  if (current && (!CREATE_VERBS.test(q) || !metric) && (PATCH_VERBS.test(q) || chart || /\bfiltro\b/.test(q))) {
    const ops: DashboardPatchOp[] = [];
    const notes: string[] = [];
    const w = current.widgets[0]!;
    if (/\bcompar\w*/.test(q)) {
      const base = catalog.metrics[w.metrics[0]!];
      const target = metric && base?.comparableWith.includes(metric.id) ? metric.id : base?.comparableWith[0];
      if (target) ops.push({ op: 'set_compare', compareMetric: target });
      else notes.push('Não há métrica de comparação aprovada para este indicador.');
    }
    const filterDim = /filtr\w*\s+(?:por|de)\s+(\w+)/.exec(q);
    if (filterDim) {
      const dim = Object.values(catalog.dimensions).find((d) => d.synonyms.includes(filterDim[1]!));
      if (dim) ops.push({ op: 'add_filter_control', dimension: dim.id });
      else notes.push(`Dimensão "${filterDim[1]}" não está no catálogo.`);
    }
    if (chart) ops.push({ op: 'set_chart_type', chartType: chart });
    if (range) ops.push({ op: 'set_time_range', timeRange: range, timeGrain: grainFor(range) });
    if (groupBy.length && !filterDim) ops.push({ op: 'set_group_by', groupBy });
    if (metric && !/\bcompar\w*/.test(q) && !w.metrics.includes(metric.id)) ops.push({ op: 'set_metrics', metrics: [metric.id] });
    if (ops.length) return { kind: 'patch_dashboard', ops, notes };
    if (notes.length) return { kind: 'unsupported', reason: notes.join(' ') };
  }

  if (metric) {
    const effRange = range ?? { kind: 'last' as const, amount: 6, unit: 'month' as const };
    const grain = grainFor(effRange);
    const dims = groupBy.length ? groupBy : metric.defaultChart === 'kpi' ? [] : ['periodo'];
    const isTimeSeries = dims.includes('periodo');
    const type: WidgetType = chart ?? (dims.length === 0 ? 'kpi' : dims.length > 1 ? 'stacked_bar' : isTimeSeries ? 'line' : 'bar');
    const notes = metric.status !== 'validado' ? [`A métrica "${metric.label}" usa dados ${metric.status === 'sintetico' ? 'SINTÉTICOS de demonstração' : 'não validados'}.`] : [];
    return {
      kind: 'create_dashboard',
      notes,
      spec: {
        specVersion: 1,
        title: `${metric.label}${dims.filter((d) => d !== 'periodo').map((d) => ' por ' + catalog.dimensions[d]!.label.toLowerCase()).join('')}`,
        description: metric.description,
        widgets: [
          {
            id: 'w1',
            type,
            title: metric.label,
            metrics: [metric.id],
            groupBy: dims,
            timeGrain: grain,
            timeRange: effRange,
            filters: [],
            span: 4
          }
        ]
      }
    };
  }

  return { kind: 'knowledge_question', query: raw };
}

export const HELP_TEXT =
  'Posso: criar dashboards a partir do catálogo autorizado (ex.: "cria efetivo por equipe nos últimos seis meses"), ' +
  'refiná-los ("muda para linhas", "compara com o previsto", "coloca filtro por gerência", "salva como Efetivo EPC13"), ' +
  'criar acompanhamentos ("monitore a OS 123 e me avise quando mudarem o prazo ou ficar 48h sem avanço") ' +
  'e procurar em documentos corporativos aprovados. Só uso dados das fontes que você tem permissão para ver.';
