import type { IntegrationStatus, Sensitivity } from '@ada/contracts';
import type { MetricUnit } from './format.ts';

/**
 * Catálogo semântico. Fórmulas, tabelas e joins são definidos EM CÓDIGO revisado,
 * nunca pelo modelo de IA nem por texto vindo do navegador.
 */
export type SourceKind = 'synthetic' | 'possebon_rest' | 'postgres_readonly' | 'possebon_brain';

export interface MonitorField {
  name: string;
  label: string;
  type: 'number' | 'string' | 'date' | 'timestamp';
}

export interface SourceDef {
  id: string;
  label: string;
  kind: SourceKind;
  /** Status padrão do código. O status operacional real é registrado em ada.source_connector. */
  defaultStatus: IntegrationStatus;
  synthetic: boolean;
  requiredPrograms: string[];
  synonyms: string[];
  monitor?: {
    table: string;
    keyField: string;
    updatedAtField: string;
    createdAtField?: string;
    statusField?: string;
    closedStatuses: string[];
    fields: MonitorField[];
    minCheckMinutes: number;
    /** Nome humano de um registro, ex.: "OS". */
    recordLabel: string;
    titleField?: string;
  };
}

export interface DimensionBinding {
  /** Expressão SQL fixa (em código) para a dimensão. */
  expr: string;
  /** Join fixo com escopo de unidade embutido. */
  join?: string;
}

export interface DimensionDef {
  id: string;
  label: string;
  kind: 'time' | 'category';
  synonyms: string[];
}

export interface MetricDef {
  id: string;
  label: string;
  description: string;
  /** Fórmula aprovada em linguagem humana. */
  formula: string;
  source: string;
  unit: MetricUnit;
  table: string;
  timeColumn: string;
  timeColumnType: 'date' | 'timestamptz';
  aggregate: { fn: 'count' | 'sum' | 'avg' | 'count_distinct'; column?: string };
  /** Restrição fixa adicional (em código). */
  where?: string;
  dimensions: Record<string, DimensionBinding>;
  comparableWith: string[];
  requiredPrograms: string[];
  /** 'gerencial' exige escopo gerencial na unidade. */
  scopeLevel: 'unidade' | 'gerencial';
  sensitivity: Sensitivity;
  status: 'validado' | 'sintetico' | 'rascunho_nao_validado';
  refresh: string;
  synonyms: string[];
  defaultChart: 'bar' | 'line' | 'kpi';
}

export interface Catalog {
  sources: Record<string, SourceDef>;
  metrics: Record<string, MetricDef>;
  dimensions: Record<string, DimensionDef>;
}

export const DIMENSIONS: Record<string, DimensionDef> = {
  periodo: { id: 'periodo', label: 'Período', kind: 'time', synonyms: ['mes', 'meses', 'periodo', 'tempo', 'dia', 'semana', 'evolucao'] },
  equipe: { id: 'equipe', label: 'Equipe', kind: 'category', synonyms: ['equipe', 'equipes', 'time'] },
  gerencia: { id: 'gerencia', label: 'Gerência', kind: 'category', synonyms: ['gerencia', 'gerencias'] },
  status: { id: 'status', label: 'Status', kind: 'category', synonyms: ['status', 'situacao'] },
  categoria: { id: 'categoria', label: 'Categoria', kind: 'category', synonyms: ['categoria', 'categorias', 'tipo'] }
};

const equipeJoin = 'JOIN ada_demo.equipe eq ON eq.id = f.equipe_id AND eq.unit_id = f.unit_id';

/**
 * Catálogo SINTÉTICO de demonstração (schema ada_demo). Habilitado somente fora de produção.
 * Os nomes de programas são fictícios e servem apenas aos testes de autorização.
 */
export const DEMO_CATALOG: Catalog = {
  dimensions: DIMENSIONS,
  sources: {
    'demo.efetivo': {
      id: 'demo.efetivo', label: 'Efetivo diário (sintético)', kind: 'synthetic', defaultStatus: 'demonstracao', synthetic: true,
      requiredPrograms: ['DemoEfetivoList'], synonyms: ['efetivo']
    },
    'demo.treinamentos': {
      id: 'demo.treinamentos', label: 'Treinamentos (sintético)', kind: 'synthetic', defaultStatus: 'demonstracao', synthetic: true,
      requiredPrograms: ['DemoTreinamentoList'], synonyms: ['treinamento', 'treinamentos']
    },
    'demo.compras': {
      id: 'demo.compras', label: 'Solicitações de compra (sintético)', kind: 'synthetic', defaultStatus: 'demonstracao', synthetic: true,
      requiredPrograms: ['DemoCompraList'], synonyms: ['compra', 'compras', 'solicitacao de compra', 'solicitacoes de compra']
    },
    'demo.os': {
      id: 'demo.os', label: 'Ordens de serviço (sintético)', kind: 'synthetic', defaultStatus: 'demonstracao', synthetic: true,
      requiredPrograms: ['DemoOsList'], synonyms: ['os', 'ordem de servico', 'ordens de servico'],
      monitor: {
        table: 'ada_demo.os', keyField: 'os_id', updatedAtField: 'updated_at', createdAtField: 'created_at', statusField: 'status',
        closedStatuses: ['concluida', 'cancelada'], minCheckMinutes: 5, recordLabel: 'OS', titleField: 'titulo',
        fields: [
          { name: 'os_id', label: 'Número da OS', type: 'number' },
          { name: 'titulo', label: 'Título', type: 'string' },
          { name: 'status', label: 'Status', type: 'string' },
          { name: 'prazo_previsto', label: 'Prazo previsto', type: 'timestamp' },
          { name: 'responsavel', label: 'Responsável', type: 'string' },
          { name: 'percentual_concluido', label: 'Percentual concluído', type: 'number' },
          { name: 'updated_at', label: 'Última atualização', type: 'timestamp' },
          { name: 'created_at', label: 'Criação', type: 'timestamp' }
        ]
      }
    }
  },
  metrics: {
    'demo.efetivo.presentes': {
      id: 'demo.efetivo.presentes', label: 'Efetivo presente', description: 'Soma diária de colaboradores presentes por equipe (dados sintéticos).',
      formula: 'SOMA(presentes) no período', source: 'demo.efetivo', unit: 'pessoas', table: 'ada_demo.efetivo_diario', timeColumn: 'data', timeColumnType: 'date',
      aggregate: { fn: 'sum', column: 'presentes' },
      dimensions: { periodo: { expr: '' }, equipe: { expr: 'eq.nome', join: equipeJoin }, gerencia: { expr: 'eq.gerencia', join: equipeJoin } },
      comparableWith: ['demo.efetivo.previsto'], requiredPrograms: ['DemoEfetivoList'], scopeLevel: 'gerencial', sensitivity: 'interno',
      status: 'sintetico', refresh: 'diário', synonyms: ['efetivo', 'presentes', 'presenca', 'mao de obra'], defaultChart: 'bar'
    },
    'demo.efetivo.previsto': {
      id: 'demo.efetivo.previsto', label: 'Efetivo previsto', description: 'Soma diária do efetivo planejado por equipe (dados sintéticos).',
      formula: 'SOMA(previsto) no período', source: 'demo.efetivo', unit: 'pessoas', table: 'ada_demo.efetivo_diario', timeColumn: 'data', timeColumnType: 'date',
      aggregate: { fn: 'sum', column: 'previsto' },
      dimensions: { periodo: { expr: '' }, equipe: { expr: 'eq.nome', join: equipeJoin }, gerencia: { expr: 'eq.gerencia', join: equipeJoin } },
      comparableWith: ['demo.efetivo.presentes'], requiredPrograms: ['DemoEfetivoList'], scopeLevel: 'gerencial', sensitivity: 'interno',
      status: 'sintetico', refresh: 'diário', synonyms: ['previsto', 'planejado', 'meta de efetivo'], defaultChart: 'bar'
    },
    'demo.treinamentos.concluidos': {
      id: 'demo.treinamentos.concluidos', label: 'Treinamentos concluídos', description: 'Quantidade de treinamentos concluídos (dados sintéticos).',
      formula: 'CONTAGEM(treinamento) com status = concluido', source: 'demo.treinamentos', unit: 'quantidade', table: 'ada_demo.treinamento',
      timeColumn: 'data_conclusao', timeColumnType: 'date', aggregate: { fn: 'count' }, where: "f.status = 'concluido'",
      dimensions: { periodo: { expr: '' }, equipe: { expr: 'eq.nome', join: equipeJoin }, gerencia: { expr: 'eq.gerencia', join: equipeJoin } },
      comparableWith: [], requiredPrograms: ['DemoTreinamentoList'], scopeLevel: 'unidade', sensitivity: 'interno',
      status: 'sintetico', refresh: 'diário', synonyms: ['treinamento', 'treinamentos', 'capacitacao'], defaultChart: 'bar'
    },
    'demo.os.total': {
      id: 'demo.os.total', label: 'Ordens de serviço', description: 'Quantidade de OS abertas no período (dados sintéticos).',
      formula: 'CONTAGEM(os) por data de criação', source: 'demo.os', unit: 'quantidade', table: 'ada_demo.os',
      timeColumn: 'created_at', timeColumnType: 'timestamptz', aggregate: { fn: 'count' },
      dimensions: { periodo: { expr: '' }, status: { expr: 'f.status' } },
      comparableWith: [], requiredPrograms: ['DemoOsList'], scopeLevel: 'unidade', sensitivity: 'interno',
      status: 'sintetico', refresh: 'contínuo', synonyms: ['os', 'ordem de servico', 'ordens de servico'], defaultChart: 'bar'
    },
    'demo.os.atrasadas': {
      id: 'demo.os.atrasadas', label: 'OS com prazo vencido', description: 'OS não concluídas com prazo previsto anterior ao momento da consulta (dados sintéticos).',
      formula: "CONTAGEM(os) com prazo_previsto < agora e status fora de ('concluida','cancelada')", source: 'demo.os', unit: 'quantidade',
      table: 'ada_demo.os', timeColumn: 'created_at', timeColumnType: 'timestamptz', aggregate: { fn: 'count' },
      where: "f.prazo_previsto < now() AND f.status NOT IN ('concluida','cancelada')",
      dimensions: { periodo: { expr: '' }, status: { expr: 'f.status' } },
      comparableWith: [], requiredPrograms: ['DemoOsList'], scopeLevel: 'unidade', sensitivity: 'interno',
      status: 'sintetico', refresh: 'contínuo', synonyms: ['os atrasada', 'os atrasadas', 'os vencidas', 'prazo vencido', 'atrasadas'], defaultChart: 'kpi'
    },
    'demo.compras.solicitacoes': {
      id: 'demo.compras.solicitacoes', label: 'Solicitações de compra', description: 'Quantidade de solicitações de compra (dados sintéticos).',
      formula: 'CONTAGEM(solicitacao_compra) por data', source: 'demo.compras', unit: 'quantidade', table: 'ada_demo.solicitacao_compra',
      timeColumn: 'data', timeColumnType: 'date', aggregate: { fn: 'count' },
      dimensions: { periodo: { expr: '' }, status: { expr: 'f.status' }, categoria: { expr: 'f.categoria' } },
      comparableWith: [], requiredPrograms: ['DemoCompraList'], scopeLevel: 'unidade', sensitivity: 'interno',
      status: 'sintetico', refresh: 'contínuo', synonyms: ['solicitacao de compra', 'solicitacoes de compra', 'compras', 'compra'], defaultChart: 'bar'
    },
    'demo.compras.valor': {
      id: 'demo.compras.valor', label: 'Valor solicitado em compras', description: 'Soma do valor estimado das solicitações (dados sintéticos).',
      formula: 'SOMA(valor) das solicitações', source: 'demo.compras', unit: 'BRL', table: 'ada_demo.solicitacao_compra',
      timeColumn: 'data', timeColumnType: 'date', aggregate: { fn: 'sum', column: 'valor' },
      dimensions: { periodo: { expr: '' }, status: { expr: 'f.status' }, categoria: { expr: 'f.categoria' } },
      comparableWith: [], requiredPrograms: ['DemoCompraList'], scopeLevel: 'gerencial', sensitivity: 'restrito',
      status: 'sintetico', refresh: 'contínuo', synonyms: ['valor de compras', 'gasto', 'gastos', 'valor'], defaultChart: 'bar'
    }
  }
};

/** Catálogo vazio usado em produção até que métricas reais sejam validadas. */
export const EMPTY_CATALOG: Catalog = { dimensions: DIMENSIONS, sources: {}, metrics: {} };

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
