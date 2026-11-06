import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { WidgetData, WidgetSpec } from '@ada/contracts';
import { formatMetricValue } from '@ada/domain/format';
import { pointLabelSafe as pointLabel } from './labels.ts';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Cores categóricas em ordem fixa por entidade (série), nunca por ranking. */
export function seriesColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i < 8 ? cssVar(`--series-${i + 1}`) : cssVar('--ink-muted')));
}

/** Converte dados autorizados em opções de componentes conhecidos (sem HTML/JS arbitrário). */
function buildOption(spec: WidgetSpec, data: WidgetData) {
  const ink2 = cssVar('--ink-2');
  const muted = cssVar('--ink-muted');
  const grid = cssVar('--grid');
  const axis = cssVar('--axis');
  const surface = cssVar('--surface-1');
  const main = data.series.filter((s) => !s.isComparison);
  const colors = seriesColors(main.length);
  const labels = data.points.map((p) => pointLabel(p.label, spec));
  const unit = data.series[0]?.unit ?? 'quantidade';
  const fmt = (v: unknown) => formatMetricValue(typeof v === 'number' ? v : null, unit);
  const tooltip = {
    trigger: spec.type === 'pie' || spec.type === 'donut' ? 'item' : 'axis',
    axisPointer: { type: spec.type === 'line' || spec.type === 'area' ? 'line' : 'shadow', lineStyle: { color: muted } },
    backgroundColor: surface,
    borderColor: axis,
    textStyle: { color: cssVar('--ink'), fontSize: 12 },
    valueFormatter: fmt
  };
  if (spec.type === 'pie' || spec.type === 'donut') {
    const s = main[0]!;
    return {
      aria: { enabled: true },
      tooltip,
      color: seriesColors(data.points.length),
      series: [{
        type: 'pie', radius: spec.type === 'donut' ? ['48%', '72%'] : ['0%', '72%'],
        itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 },
        label: { color: ink2, formatter: '{b}: {d}%' },
        data: data.points.map((p, i) => ({ name: labels[i], value: p.values[s.key] ?? 0 }))
      }]
    };
  }
  const horizontal = spec.type === 'distribution';
  const catAxis = { type: 'category', data: labels, axisLine: { lineStyle: { color: axis } }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 11, hideOverlap: true } };
  const valAxis = { type: 'value', splitLine: { lineStyle: { color: grid } }, axisLabel: { color: muted, fontSize: 11, formatter: (v: number) => formatMetricValue(v, unit === 'BRL' ? 'BRL' : 'quantidade') } };
  const series: object[] = main.map((s, i) => {
    const values = data.points.map((p) => p.values[s.key] ?? null);
    if (spec.type === 'line' || spec.type === 'area') {
      return { name: s.label, type: 'line', data: values, symbolSize: 8, showSymbol: values.length < 24, lineStyle: { width: 2 }, itemStyle: { color: colors[i] }, areaStyle: spec.type === 'area' ? { opacity: 0.18 } : undefined };
    }
    return {
      name: s.label, type: 'bar', data: values, stack: spec.type === 'stacked_bar' ? 'total' : undefined, barMaxWidth: 36,
      itemStyle: { color: colors[i], borderRadius: spec.type === 'stacked_bar' ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], borderColor: surface, borderWidth: spec.type === 'stacked_bar' ? 1 : 0 }
    };
  });
  const temporal = spec.groupBy[0] === 'periodo';
  for (const s of data.series.filter((x) => x.isComparison)) {
    const values = data.points.map((p) => p.values[s.key] ?? null);
    series.push(
      temporal
        ? // série temporal: linha tracejada de referência
          { name: s.label, type: 'line', data: values, symbolSize: 8, showSymbol: values.length < 24, lineStyle: { width: 2, type: 'dashed', color: ink2 }, itemStyle: { color: ink2 }, z: 5 }
        : // categorias: marcador de meta por categoria (sem linha ligando categorias independentes)
          { name: s.label, type: 'line', data: values, symbol: 'rect', symbolSize: horizontal ? [3, 28] : [28, 3], lineStyle: { opacity: 0 }, itemStyle: { color: ink2 }, z: 5 }
    );
  }
  return {
    aria: { enabled: true },
    tooltip,
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
    series
  };
}

export default function Chart({ spec, data, theme }: { spec: WidgetSpec; data: WidgetData; theme: string }) {
  const el = useRef<HTMLDivElement>(null);
  // Tema do sistema pode mudar com a página aberta (modo "auto"): recalcula as cores lidas dos tokens CSS.
  const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setOsDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const option = useMemo(() => (void theme, void osDark, buildOption(spec, data)), [spec, data, theme, osDark]);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: 'svg' });
    chart.setOption(option as never);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div ref={el} className="chart" role="img" aria-label={`Gráfico: ${spec.title}`} />;
}
