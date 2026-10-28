import { lazy, Suspense, useState } from 'react';
import type { DashboardSpec, WidgetData, WidgetSpec } from '@ada/contracts';
import { formatDateTime, formatMetricValue, formatPercent } from '@ada/domain/format';
import { pointLabelSafe } from './labels.ts';
import { useApp } from '../app-context.ts';

const Chart = lazy(() => import('./Chart.tsx'));

const STATUS_TEXT: Record<string, string> = {
  forbidden: 'Sem permissão para este indicador',
  source_unavailable: 'Fonte indisponível',
  error: 'Falha ao consultar'
};

function Provenance({ d }: { d: WidgetData }) {
  const { me } = useApp();
  const p = d.provenance;
  const unitNames = p.unitIds.map((u) => me.units.find((x) => x.id === u)?.name ?? `Unidade ${u}`);
  const stale = p.limitations.some((l) => l.startsWith('DADOS DESATUALIZADOS'));
  return (
    <div className="widget-foot">
      {p.synthetic && <span className="badge synthetic" title="Dados fictícios de demonstração">SINTÉTICO</span>}
      <span>Fonte: {p.sources.join(', ') || '—'}</span>
      <span>Unidade: {unitNames.join(', ')}</span>
      <span className={stale ? 'stale' : ''}>
        Consultado em {formatDateTime(p.queriedAt)}
        {p.fromCache && !stale ? ` (cache de ${p.cacheAgeSeconds}s)` : ''}
      </span>
      {p.limitations
        .filter((l) => !l.startsWith('Dados SINTÉTICOS'))
        .map((l) => (
          <span key={l} className={l.startsWith('DADOS DESATUALIZADOS') ? 'stale' : ''} role={l.startsWith('DADOS DESATUALIZADOS') ? 'alert' : undefined}>
            ⚠ {l}
          </span>
        ))}
    </div>
  );
}

function DataTable({ spec, d }: { spec: WidgetSpec; d: WidgetData }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: 320 }}>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{spec.groupBy.length ? 'Rótulo' : 'Indicador'}</th>
            {d.series.map((s) => (
              <th scope="col" key={s.key} style={{ textAlign: 'right' }}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.points.map((p) => (
            <tr key={p.label}>
              <td>{pointLabelSafe(p.label, spec)}</td>
              {d.series.map((s) => (
                <td key={s.key} className="num">{formatMetricValue(p.values[s.key] ?? null, s.unit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ d }: { d: WidgetData }) {
  const main = d.series.find((s) => !s.isComparison);
  const cmp = d.series.find((s) => s.isComparison);
  if (!main) return null;
  const total = d.points.reduce((s, p) => s + (p.values[main.key] ?? 0), 0);
  const cmpTotal = cmp ? d.points.reduce((s, p) => s + (p.values[cmp.key] ?? 0), 0) : null;
  return (
    <div className="kpi">
      <div className="value tabular">{formatMetricValue(total, main.unit)}</div>
      <div className="sub">{main.label}</div>
      {cmp && cmpTotal ? (
        <div className="sub">
          {cmp.label}: {formatMetricValue(cmpTotal, cmp.unit)} · realizado {formatPercent(total / cmpTotal)}
        </div>
      ) : null}
    </div>
  );
}

function Widget({ spec, d, theme }: { spec: WidgetSpec; d?: WidgetData; theme: string }) {
  const [asTable, setAsTable] = useState(false);
  const span = Math.min(spec.span ?? 2, 4);
  if (!d) {
    return (
      <section className="widget" style={{ gridColumn: `span ${span}` }} aria-busy="true">
        <h3>{spec.title}</h3>
        <div className="skeleton" style={{ height: 240, marginTop: 10 }} />
      </section>
    );
  }
  const main = d.series.filter((s) => !s.isComparison);
  const showLegend = d.series.length >= 2 && !['pie', 'donut', 'kpi', 'table'].includes(spec.type);
  return (
    <section className="widget" style={{ gridColumn: `span ${span}` }} aria-label={spec.title}>
      <div className="row">
        <h3 className="grow">{spec.title}</h3>
        {d.status === 'ok' && !['table', 'kpi'].includes(spec.type) && (
          <button className="btn ghost sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        )}
      </div>
      {d.status !== 'ok' ? (
        <div className="note-box" role="status" style={{ marginTop: 10 }}>
          <strong>{STATUS_TEXT[d.status]}.</strong> {d.message}
        </div>
      ) : d.points.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>
          <strong>Sem registros</strong>Nenhum dado para o período e filtros escolhidos.
        </div>
      ) : spec.type === 'kpi' ? (
        <Kpi d={d} />
      ) : spec.type === 'table' || asTable ? (
        <DataTable spec={spec} d={d} />
      ) : (
        <>
          {showLegend && (
            <div className="legend" aria-label="Legenda">
              {main.map((s, i) => (
                <span key={s.key} style={{ ['--c' as string]: i < 8 ? `var(--series-${i + 1})` : 'var(--ink-muted)' }}>{s.label}</span>
              ))}
              {d.series.filter((s) => s.isComparison).map((s) => (
                <span key={s.key} className="dashed" style={{ ['--c' as string]: 'var(--ink-2)' }}>{s.label} (comparação)</span>
              ))}
            </div>
          )}
          <Suspense fallback={<div className="skeleton" style={{ height: 280 }} />}>
            <Chart spec={spec} data={d} theme={theme} />
          </Suspense>
        </>
      )}
      <Provenance d={d} />
    </section>
  );
}

export function DashboardCanvas({ spec, data, theme, loading }: { spec: DashboardSpec; data: WidgetData[] | null; theme: string; loading?: boolean }) {
  return (
    <div className="dash-grid" aria-busy={loading ? 'true' : 'false'}>
      {spec.widgets.map((w) => (
        <Widget key={w.id} spec={w} d={loading ? undefined : data?.find((x) => x.widgetId === w.id)} theme={theme} />
      ))}
    </div>
  );
}
