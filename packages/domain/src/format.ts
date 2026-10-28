/**
 * Formatação de apresentação pt-BR. Persistência sempre em UTC; conversão só na exibição.
 * Este módulo não importa APIs de Node e pode ser usado no navegador.
 */
export const TIMEZONE = 'America/Sao_Paulo';
export const LOCALE = 'pt-BR';

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const currencyFmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL' });
const numberFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const percentFmt = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 });

function toDate(v: Date | string | number): Date {
  if (v instanceof Date) return v;
  // Datas puras (AAAA-MM-DD) representam um dia civil, não um instante: ancoradas ao meio-dia UTC.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00Z');
  return new Date(v);
}

/** DD/MM/AAAA no fuso de São Paulo. */
export function formatDate(v: Date | string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

/** DD/MM/AAAA HH:mm no fuso de São Paulo. */
export function formatDateTime(v: Date | string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d).replace(',', '');
}

export function formatCurrency(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : currencyFmt.format(v);
}

export function formatNumber(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : numberFmt.format(v);
}

export function formatPercent(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined || !Number.isFinite(ratio) ? '—' : percentFmt.format(ratio);
}

export type MetricUnit = 'pessoas' | 'quantidade' | 'BRL' | 'percentual' | 'horas';

export function formatMetricValue(v: number | null | undefined, unit: MetricUnit | string): string {
  if (unit === 'BRL') return formatCurrency(v);
  if (unit === 'percentual') return formatPercent(v);
  if (unit === 'horas') return v === null || v === undefined ? '—' : formatNumber(v) + ' h';
  return formatNumber(v);
}

const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Rótulo de período para eixos: mês "out/2026", semana/dia "27/10/2026". */
export function formatPeriodLabel(isoDate: string, grain: 'day' | 'week' | 'month'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  if (grain === 'month') return `${monthNames[Number(m[2]) - 1]}/${m[1]}`;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Data civil (AAAA-MM-DD) atual em São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}
