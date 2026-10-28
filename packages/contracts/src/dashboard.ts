import { z } from 'zod';
import { CatalogId, ScalarValue } from './common.ts';

export const TimeUnit = z.enum(['day', 'week', 'month']);

export const TimeRange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('last'), amount: z.number().int().min(1).max(36), unit: TimeUnit }).strict(),
  z.object({ kind: z.literal('between'), from: z.iso.date(), to: z.iso.date() }).strict()
]);
export type TimeRange = z.infer<typeof TimeRange>;

export const DashboardFilter = z
  .object({
    dimension: CatalogId,
    op: z.enum(['eq', 'in']),
    values: z.array(ScalarValue).min(1).max(50)
  })
  .strict();
export type DashboardFilter = z.infer<typeof DashboardFilter>;

export const WidgetType = z.enum([
  'kpi',
  'line',
  'bar',
  'area',
  'pie',
  'donut',
  'stacked_bar',
  'table',
  'target_vs_actual',
  'distribution'
]);
export type WidgetType = z.infer<typeof WidgetType>;

export const WidgetSpec = z
  .object({
    id: z.string().regex(/^w[a-z0-9_-]{1,30}$/),
    type: WidgetType,
    title: z.string().min(1).max(120),
    metrics: z.array(CatalogId).min(1).max(4),
    /** Métrica de comparação aprovada (ex.: previsto/meta). */
    compareMetric: CatalogId.optional(),
    /** Dimensões de agrupamento do catálogo. "periodo" é a dimensão temporal. */
    groupBy: z.array(CatalogId).max(2).default([]),
    timeGrain: TimeUnit.optional(),
    timeRange: TimeRange,
    filters: z.array(DashboardFilter).max(10).default([]),
    sort: z.object({ by: z.enum(['value', 'label']), dir: z.enum(['asc', 'desc']) }).strict().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    span: z.number().int().min(1).max(4).default(2)
  })
  .strict();
export type WidgetSpec = z.infer<typeof WidgetSpec>;

/**
 * Especificação declarativa e versionada de um dashboard.
 * Não contém números: os valores são sempre buscados na fonte autorizada ao abrir.
 */
export const DashboardSpec = z
  .object({
    specVersion: z.literal(1),
    title: z.string().min(1).max(120),
    description: z.string().max(500).default(''),
    widgets: z.array(WidgetSpec).min(1).max(12),
    columns: z.number().int().min(1).max(4).default(4),
    theme: z.enum(['auto', 'dark', 'light']).default('auto'),
    /** Filtros fixos aplicados a todos os widgets. */
    defaultFilters: z.array(DashboardFilter).max(10).default([]),
    /** Dimensões expostas como controles interativos de filtro. */
    filterControls: z.array(CatalogId).max(6).default([])
  })
  .strict();
export type DashboardSpec = z.infer<typeof DashboardSpec>;
export type DashboardSpecInput = z.input<typeof DashboardSpec>;

const WidgetTarget = { widgetId: z.string().optional() };

/** Operações de alteração incremental. O modelo nunca reescreve HTML/JS/SQL. */
export const DashboardPatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_chart_type'), ...WidgetTarget, chartType: WidgetType }).strict(),
  z.object({ op: z.literal('set_time_range'), ...WidgetTarget, timeRange: TimeRange, timeGrain: TimeUnit.optional() }).strict(),
  z.object({ op: z.literal('set_compare'), ...WidgetTarget, compareMetric: CatalogId.nullable() }).strict(),
  z.object({ op: z.literal('set_group_by'), ...WidgetTarget, groupBy: z.array(CatalogId).max(2) }).strict(),
  z.object({ op: z.literal('set_metrics'), ...WidgetTarget, metrics: z.array(CatalogId).min(1).max(4) }).strict(),
  z.object({ op: z.literal('add_filter'), ...WidgetTarget, filter: DashboardFilter }).strict(),
  z.object({ op: z.literal('add_filter_control'), dimension: CatalogId }).strict(),
  z.object({ op: z.literal('remove_filter_control'), dimension: CatalogId }).strict(),
  z.object({ op: z.literal('rename'), title: z.string().min(1).max(120), description: z.string().max(500).optional() }).strict(),
  z.object({ op: z.literal('add_widget'), widget: WidgetSpec }).strict(),
  z.object({ op: z.literal('remove_widget'), widgetId: z.string() }).strict(),
  z.object({ op: z.literal('set_widget_title'), ...WidgetTarget, title: z.string().min(1).max(120) }).strict()
]);
export type DashboardPatchOp = z.infer<typeof DashboardPatchOp>;

export const DashboardPatch = z.object({ ops: z.array(DashboardPatchOp).min(1).max(10) }).strict();
export type DashboardPatch = z.infer<typeof DashboardPatch>;

/** Resultado de dados de um widget, sempre com proveniência e estado de atualização. */
export interface WidgetDataPoint {
  label: string;
  /** chave da série → valor numérico */
  values: Record<string, number | null>;
}
export interface WidgetData {
  widgetId: string;
  status: 'ok' | 'forbidden' | 'source_unavailable' | 'error';
  message?: string;
  series: { key: string; label: string; unit: string; isComparison?: boolean }[];
  points: WidgetDataPoint[];
  provenance: Provenance;
}
export interface Provenance {
  sources: string[];
  unitIds: number[];
  filters: unknown[];
  queriedAt: string;
  fromCache: boolean;
  cacheAgeSeconds: number;
  synthetic: boolean;
  limitations: string[];
}
