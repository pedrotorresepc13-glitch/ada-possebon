import type { WidgetSpec } from '@ada/contracts';
import { formatPeriodLabel } from '@ada/domain/format';

/** Rótulo pt-BR para pontos do eixo (períodos viram "out/2026" ou DD/MM/AAAA). */
export function pointLabelSafe(label: string, spec: WidgetSpec): string {
  return spec.groupBy[0] === 'periodo' ? formatPeriodLabel(label, spec.timeGrain ?? 'month') : label;
}
