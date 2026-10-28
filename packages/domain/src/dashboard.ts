import {
  DashboardSpec,
  type DashboardFilter,
  type DashboardPatchOp,
  type TimeRange,
  type WidgetSpec
} from '@ada/contracts';
import type { Catalog, MetricDef } from './catalog.ts';
import { todayInSaoPaulo } from './format.ts';

export interface SpecIssue {
  path: string;
  message: string;
}

/** Valida uma spec contra o catálogo: métricas, dimensões, comparações e filtros existentes e compatíveis. */
export function validateSpecAgainstCatalog(spec: DashboardSpec, catalog: Catalog): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const ids = new Set<string>();
  spec.widgets.forEach((w, i) => {
    const p = `widgets[${i}]`;
    if (ids.has(w.id)) issues.push({ path: p + '.id', message: `Widget duplicado: ${w.id}` });
    ids.add(w.id);
    const metrics: MetricDef[] = [];
    for (const m of w.metrics) {
      const def = catalog.metrics[m];
      if (!def) issues.push({ path: p + '.metrics', message: `Métrica não catalogada: ${m}` });
      else metrics.push(def);
    }
    if (w.compareMetric) {
      const cmp = catalog.metrics[w.compareMetric];
      if (!cmp) issues.push({ path: p + '.compareMetric', message: `Métrica de comparação não catalogada: ${w.compareMetric}` });
      else if (!metrics.some((m) => m.comparableWith.includes(w.compareMetric!))) {
        issues.push({ path: p + '.compareMetric', message: `Comparação não aprovada entre ${w.metrics.join(', ')} e ${w.compareMetric}` });
      }
    }
    const allMetrics = w.compareMetric && catalog.metrics[w.compareMetric] ? [...metrics, catalog.metrics[w.compareMetric]!] : metrics;
    for (const d of w.groupBy) {
      if (!catalog.dimensions[d]) issues.push({ path: p + '.groupBy', message: `Dimensão não catalogada: ${d}` });
      else if (allMetrics.some((m) => !m.dimensions[d])) issues.push({ path: p + '.groupBy', message: `Dimensão "${d}" não permitida para a métrica` });
    }
    for (const f of [...w.filters, ...spec.defaultFilters]) {
      if (allMetrics.some((m) => !m.dimensions[f.dimension] || catalog.dimensions[f.dimension]?.kind === 'time')) {
        issues.push({ path: p + '.filters', message: `Filtro por "${f.dimension}" não permitido para a métrica` });
      }
    }
    if (w.groupBy.length > 1 && !['stacked_bar', 'table'].includes(w.type)) {
      issues.push({ path: p + '.groupBy', message: 'Dois agrupamentos exigem barras empilhadas ou tabela' });
    }
    if ((w.type === 'pie' || w.type === 'donut') && (w.groupBy.includes('periodo') || w.metrics.length > 1)) {
      issues.push({ path: p + '.type', message: 'Pizza/rosca só é adequada para uma métrica distribuída em categorias' });
    }
    if (w.type === 'target_vs_actual' && !w.compareMetric) {
      issues.push({ path: p + '.compareMetric', message: 'Comparativo meta-realizado exige métrica de comparação' });
    }
  });
  for (const d of spec.filterControls) {
    if (!catalog.dimensions[d] || catalog.dimensions[d]!.kind === 'time') issues.push({ path: 'filterControls', message: `Controle de filtro inválido: ${d}` });
  }
  return issues;
}

function targetWidgets(spec: DashboardSpec, widgetId: string | undefined): WidgetSpec[] {
  if (widgetId) {
    const w = spec.widgets.find((x) => x.id === widgetId);
    if (!w) throw new Error(`Widget inexistente: ${widgetId}`);
    return [w];
  }
  // Sem alvo explícito, aplica ao primeiro widget (o "gráfico atual" da conversa).
  return spec.widgets.slice(0, 1);
}

/**
 * Aplica um patch incremental a uma spec, retornando nova spec validada pelo schema.
 * Não reconstrói do zero; mantém ids e demais propriedades.
 */
export function applyDashboardPatch(spec: DashboardSpec, ops: DashboardPatchOp[]): DashboardSpec {
  const next: DashboardSpec = structuredClone(spec);
  for (const op of ops) {
    switch (op.op) {
      case 'set_chart_type':
        for (const w of targetWidgets(next, op.widgetId)) w.type = op.chartType;
        break;
      case 'set_time_range':
        for (const w of targetWidgets(next, op.widgetId)) {
          w.timeRange = op.timeRange;
          if (op.timeGrain) w.timeGrain = op.timeGrain;
        }
        break;
      case 'set_compare':
        for (const w of targetWidgets(next, op.widgetId)) {
          if (op.compareMetric) w.compareMetric = op.compareMetric;
          else delete w.compareMetric;
        }
        break;
      case 'set_group_by':
        for (const w of targetWidgets(next, op.widgetId)) w.groupBy = op.groupBy;
        break;
      case 'set_metrics':
        for (const w of targetWidgets(next, op.widgetId)) w.metrics = op.metrics;
        break;
      case 'add_filter':
        for (const w of targetWidgets(next, op.widgetId)) {
          w.filters = [...w.filters.filter((f) => f.dimension !== op.filter.dimension), op.filter];
        }
        break;
      case 'add_filter_control':
        if (!next.filterControls.includes(op.dimension)) next.filterControls.push(op.dimension);
        break;
      case 'remove_filter_control':
        next.filterControls = next.filterControls.filter((d) => d !== op.dimension);
        break;
      case 'rename':
        next.title = op.title;
        if (op.description !== undefined) next.description = op.description;
        break;
      case 'add_widget':
        if (next.widgets.some((w) => w.id === op.widget.id)) throw new Error(`Widget já existe: ${op.widget.id}`);
        next.widgets.push(op.widget);
        break;
      case 'remove_widget':
        if (next.widgets.length <= 1) throw new Error('O dashboard precisa de ao menos um widget');
        next.widgets = next.widgets.filter((w) => w.id !== op.widgetId);
        break;
      case 'set_widget_title':
        for (const w of targetWidgets(next, op.widgetId)) w.title = op.title;
        break;
    }
  }
  return DashboardSpec.parse(next);
}

/** Intervalo civil [from, to] (AAAA-MM-DD, inclusivo) no fuso de São Paulo. */
export function resolveTimeRange(range: TimeRange, now: Date = new Date()): { from: string; to: string } {
  if (range.kind === 'between') {
    if (range.from > range.to) throw new Error('Intervalo de datas invertido');
    return { from: range.from, to: range.to };
  }
  const today = todayInSaoPaulo(now);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d));
  let from: Date;
  if (range.unit === 'day') from = new Date(Date.UTC(y, m - 1, d - (range.amount - 1)));
  else if (range.unit === 'week') {
    const dow = (base.getUTCDay() + 6) % 7; // segunda-feira = 0
    from = new Date(Date.UTC(y, m - 1, d - dow - 7 * (range.amount - 1)));
  } else from = new Date(Date.UTC(y, m - 1 - (range.amount - 1), 1));
  return { from: from.toISOString().slice(0, 10), to: today };
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  dimensionKeys: string[];
}

const AGG: Record<MetricDef['aggregate']['fn'], (col: string) => string> = {
  count: () => 'COUNT(*)',
  sum: (c) => `COALESCE(SUM(f.${c}),0)`,
  avg: (c) => `AVG(f.${c})`,
  count_distinct: (c) => `COUNT(DISTINCT f.${c})`
};

/**
 * Monta SQL parametrizado SOMENTE a partir de definições do catálogo.
 * Identificadores vêm do código; valores do usuário entram apenas como parâmetros.
 * O filtro de unidade é obrigatório e também está embutido nos joins.
 */
export function buildMetricQuery(args: {
  metric: MetricDef;
  groupBy: string[];
  timeGrain: 'day' | 'week' | 'month';
  range: { from: string; to: string };
  filters: DashboardFilter[];
  unitIds: number[];
  limit?: number;
}): BuiltQuery {
  const { metric, groupBy, timeGrain, range, filters, unitIds } = args;
  if (unitIds.length === 0) throw new Error('Escopo de unidade vazio');
  if (!['day', 'week', 'month'].includes(timeGrain)) throw new Error('Granularidade inválida');
  const params: unknown[] = [unitIds, range.from, range.to];
  const timeExpr = metric.timeColumnType === 'date' ? `f.${metric.timeColumn}` : `(f.${metric.timeColumn} AT TIME ZONE 'America/Sao_Paulo')::date`;
  const joins = new Set<string>();
  const selects: string[] = [];
  const dimensionKeys: string[] = [];
  groupBy.forEach((d, i) => {
    const b = metric.dimensions[d];
    if (!b) throw new Error(`Dimensão não permitida: ${d}`);
    if (b.join) joins.add(b.join);
    const expr = d === 'periodo' ? `to_char(date_trunc('${timeGrain}', ${timeExpr}), 'YYYY-MM-DD')` : `COALESCE(${b.expr}::text, '(sem valor)')`;
    selects.push(`${expr} AS d${i}`);
    dimensionKeys.push(d);
  });
  const where = [`f.unit_id = ANY($1::int[])`, `${timeExpr} >= $2::date`, `${timeExpr} <= $3::date`];
  if (metric.where) where.push(`(${metric.where})`);
  for (const f of filters) {
    const b = metric.dimensions[f.dimension];
    if (!b || f.dimension === 'periodo') throw new Error(`Filtro não permitido: ${f.dimension}`);
    if (b.join) joins.add(b.join);
    params.push(f.values.map(String));
    where.push(`${b.expr}::text = ANY($${params.length}::text[])`);
  }
  const col = metric.aggregate.column ?? '';
  const agg = AGG[metric.aggregate.fn](col);
  const groupClause = selects.length ? ` GROUP BY ${selects.map((_, i) => `d${i}`).join(', ')}` : '';
  const orderClause = selects.length ? ` ORDER BY ${selects.map((_, i) => `d${i}`).join(', ')}` : '';
  params.push(Math.min(args.limit ?? 500, 500));
  const sql =
    `SELECT ${[...selects, `${agg}::float8 AS v`].join(', ')} FROM ${metric.table} f ${[...joins].join(' ')}` +
    ` WHERE ${where.join(' AND ')}${groupClause}${orderClause} LIMIT $${params.length}`;
  return { sql, params, dimensionKeys };
}

export function newWidgetId(existing: WidgetSpec[]): string {
  let i = existing.length + 1;
  while (existing.some((w) => w.id === `w${i}`)) i++;
  return `w${i}`;
}
