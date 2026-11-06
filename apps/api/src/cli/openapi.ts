import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ChatRequest, DashboardPatch, DashboardSpec, MemoryInput, NormalizedEvent, PreferenceInput, RuleDefinition, ShareInput } from '@ada/contracts';
import { REPO_ROOT } from '../config.ts';
import { EmailAccountInput } from '../services/email.ts';
import { SourceInput } from '../services/knowledge.ts';

/** Gera docs/openapi-ada.json a partir dos esquemas Zod reais usados na validação. */
type Auth = 'sessao' | 'admin' | 'nenhuma' | 'hmac';
interface Op {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  auth: Auth;
  body?: z.ZodType;
  example?: unknown;
}
const js = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

const ops: Op[] = [
  { method: 'post', path: '/session/exchange', summary: 'Troca ticket SSO (uso único, ≤60 s) por sessão (cookie HttpOnly). Aceita JSON ou formulário.', auth: 'nenhuma', body: z.object({ ticket: z.string() }) },
  { method: 'post', path: '/dev/login', summary: 'Login com identidade SINTÉTICA (somente desenvolvimento; 404 em produção).', auth: 'nenhuma', body: z.object({ login: z.string(), unitId: z.number().optional() }) },
  { method: 'get', path: '/session', summary: 'Estado da sessão (não exige autenticação).', auth: 'nenhuma' },
  { method: 'get', path: '/me', summary: 'Identidade, unidade ativa, papéis e token CSRF.', auth: 'sessao' },
  { method: 'post', path: '/session/unit', summary: 'Troca a unidade ativa (somente unidades permitidas).', auth: 'sessao', body: z.object({ unitId: z.number().int() }) },
  { method: 'post', path: '/session/logout', summary: 'Encerra a sessão.', auth: 'sessao' },
  { method: 'post', path: '/internal/revoke', summary: 'POSSEBON → ADA: revoga sessões de um usuário (HMAC).', auth: 'hmac', body: z.object({ system_user_id: z.number().int(), reason: z.string().optional() }) },
  { method: 'post', path: '/internal/events', summary: 'POSSEBON → ADA: evento normalizado (outbox/webhook), idempotente por eventId (HMAC).', auth: 'hmac', body: NormalizedEvent },
  { method: 'get', path: '/conversations', summary: 'Minhas conversas (busca por título com ?q=).', auth: 'sessao' },
  { method: 'post', path: '/conversations', summary: 'Nova conversa.', auth: 'sessao' },
  { method: 'get', path: '/conversations/{id}', summary: 'Conversa (mensagens decifradas, rascunho de dashboard).', auth: 'sessao' },
  { method: 'patch', path: '/conversations/{id}', summary: 'Renomear.', auth: 'sessao', body: z.object({ title: z.string() }) },
  { method: 'delete', path: '/conversations/{id}', summary: 'Excluir conversa e mensagens.', auth: 'sessao' },
  { method: 'post', path: '/conversations/{id}/undo', summary: 'Desfaz a última alteração do rascunho de dashboard.', auth: 'sessao' },
  { method: 'post', path: '/chat', summary: 'Mensagem para a ADA (IA com ferramentas ou interpretador determinístico).', auth: 'sessao', body: ChatRequest, example: { message: 'cria efetivo por equipe nos últimos seis meses' } },
  { method: 'get', path: '/memory', summary: 'Minhas memórias.', auth: 'sessao' },
  { method: 'post', path: '/memory', summary: 'Registrar memória.', auth: 'sessao', body: MemoryInput },
  { method: 'delete', path: '/memory/{id}', summary: 'Esquecer memória.', auth: 'sessao' },
  { method: 'get', path: '/preferences', summary: 'Preferências.', auth: 'sessao' },
  { method: 'put', path: '/preferences', summary: 'Atualizar preferências.', auth: 'sessao', body: PreferenceInput },
  { method: 'get', path: '/me/export', summary: 'Exportação LGPD dos próprios dados.', auth: 'sessao' },
  { method: 'get', path: '/knowledge/search', summary: 'Busca em documentos aprovados e autorizados (?q=).', auth: 'sessao' },
  { method: 'get', path: '/metrics', summary: 'Métricas do catálogo que o usuário pode usar.', auth: 'sessao' },
  { method: 'get', path: '/dimensions', summary: 'Dimensões do catálogo.', auth: 'sessao' },
  { method: 'get', path: '/dashboards', summary: 'Dashboards próprios e compartilhados (unidade ativa).', auth: 'sessao' },
  { method: 'post', path: '/dashboards', summary: 'Criar dashboard (spec declarativa validada).', auth: 'sessao', body: z.object({ spec: DashboardSpec, title: z.string().optional() }) },
  { method: 'post', path: '/dashboards/preview', summary: 'Dados de uma spec (rascunho), com permissões reaplicadas.', auth: 'sessao', body: z.object({ spec: DashboardSpec, refresh: z.boolean().optional() }) },
  { method: 'get', path: '/dashboards/{id}', summary: 'Dashboard (spec, revisão, acesso).', auth: 'sessao' },
  { method: 'put', path: '/dashboards/{id}', summary: 'Nova revisão por spec completa ou patch.', auth: 'sessao', body: z.union([z.object({ spec: DashboardSpec }), DashboardPatch]) },
  { method: 'delete', path: '/dashboards/{id}', summary: 'Excluir (dono).', auth: 'sessao' },
  { method: 'get', path: '/dashboards/{id}/data', summary: 'Valores atuais (?refresh=1, ?filters=[...]) com proveniência e estado de cache.', auth: 'sessao' },
  { method: 'get', path: '/dashboards/{id}/filter-values', summary: 'Valores de um controle de filtro (?dimension=).', auth: 'sessao' },
  { method: 'get', path: '/dashboards/{id}/revisions', summary: 'Histórico de revisões.', auth: 'sessao' },
  { method: 'post', path: '/dashboards/{id}/revert', summary: 'Restaurar revisão.', auth: 'sessao', body: z.object({ revision: z.number().int() }) },
  { method: 'post', path: '/dashboards/{id}/share', summary: 'Publicar (gestor/admin). Destinatário precisa de permissão em cada métrica.', auth: 'sessao', body: ShareInput },
  { method: 'delete', path: '/dashboards/{id}/share', summary: 'Tornar privado.', auth: 'sessao' },
  { method: 'get', path: '/dashboards/{id}/export.csv', summary: 'Exportação CSV (pt-BR, ;) com proveniência e neutralização de fórmulas.', auth: 'sessao' },
  { method: 'get', path: '/monitors', summary: 'Meus acompanhamentos.', auth: 'sessao' },
  { method: 'post', path: '/monitors/preview', summary: 'Validar e simular regra (não grava).', auth: 'sessao', body: z.object({ definition: RuleDefinition }) },
  { method: 'post', path: '/monitors', summary: 'Criar regra (rascunho); activate=true = confirmação explícita do usuário.', auth: 'sessao', body: z.object({ definition: RuleDefinition, activate: z.boolean().optional(), dashboardId: z.uuid().optional() }) },
  { method: 'get', path: '/monitors/{id}', summary: 'Regra.', auth: 'sessao' },
  { method: 'put', path: '/monitors/{id}', summary: 'Editar (nova revisão; histórico preservado).', auth: 'sessao', body: z.object({ definition: RuleDefinition }) },
  { method: 'get', path: '/monitors/{id}/preview', summary: 'Prévia/simulação da regra atual.', auth: 'sessao' },
  { method: 'post', path: '/monitors/{id}/activate', summary: 'Ativar.', auth: 'sessao' },
  { method: 'post', path: '/monitors/{id}/resume', summary: 'Retomar.', auth: 'sessao' },
  { method: 'post', path: '/monitors/{id}/pause', summary: 'Pausar.', auth: 'sessao' },
  { method: 'post', path: '/monitors/{id}/test', summary: 'Testar (simulação sem notificar).', auth: 'sessao' },
  { method: 'get', path: '/monitors/{id}/history', summary: 'Execuções, ocorrências e revisões.', auth: 'sessao' },
  { method: 'delete', path: '/monitors/{id}', summary: 'Excluir.', auth: 'sessao' },
  { method: 'get', path: '/notifications', summary: 'Notificações (?unread=1, ?severity=).', auth: 'sessao' },
  { method: 'get', path: '/notifications/count', summary: 'Contagem de não lidas.', auth: 'sessao' },
  { method: 'get', path: '/notifications/stream', summary: 'SSE: contagem em tempo real (revalida a sessão a cada ciclo).', auth: 'sessao' },
  { method: 'post', path: '/notifications/{id}/read', summary: 'Marcar como lida.', auth: 'sessao' },
  { method: 'post', path: '/notifications/{id}/ack', summary: 'Confirmar.', auth: 'sessao' },
  { method: 'post', path: '/notifications/read-all', summary: 'Marcar todas como lidas.', auth: 'sessao' },
  { method: 'get', path: '/admin/health', summary: 'Saúde: banco, worker, filas, IA, identidade.', auth: 'admin' },
  { method: 'get', path: '/admin/connectors', summary: 'Conectores e estado honesto.', auth: 'admin' },
  { method: 'post', path: '/admin/connectors/{id}/status', summary: 'Desabilitar/restaurar conector.', auth: 'admin', body: z.object({ status: z.enum(['desabilitado', 'demonstracao', 'nao_configurado']) }) },
  { method: 'post', path: '/admin/connectors/{id}/test', summary: 'Testar conector.', auth: 'admin' },
  { method: 'get', path: '/admin/knowledge/sources', summary: 'Fontes de conhecimento.', auth: 'admin' },
  { method: 'post', path: '/admin/knowledge/sources', summary: 'Criar fonte.', auth: 'admin', body: SourceInput },
  { method: 'post', path: '/admin/knowledge/sources/{id}/upload', summary: 'Upload em lote (multipart).', auth: 'admin' },
  { method: 'post', path: '/admin/knowledge/sources/{id}/url', summary: 'Importar URL (SSRF bloqueado, robots.txt).', auth: 'admin', body: z.object({ url: z.string() }) },
  { method: 'get', path: '/admin/knowledge/documents', summary: 'Fila de estudo (?status=).', auth: 'admin' },
  { method: 'get', path: '/admin/knowledge/documents/{id}', summary: 'Documento com texto extraído e alertas.', auth: 'admin' },
  { method: 'post', path: '/admin/knowledge/documents/{id}/review', summary: 'Aprovar/rejeitar.', auth: 'admin', body: z.object({ decision: z.enum(['aprovar', 'rejeitar']), note: z.string().optional() }) },
  { method: 'post', path: '/admin/knowledge/documents/{id}/reprocess', summary: 'Reprocessar.', auth: 'admin' },
  { method: 'get', path: '/admin/knowledge/coverage', summary: 'Cobertura por status/área.', auth: 'admin' },
  { method: 'get', path: '/admin/email/accounts', summary: 'Contas de e-mail (sem credenciais).', auth: 'admin' },
  { method: 'post', path: '/admin/email/accounts', summary: 'Registrar conta (segredo cifrado, nunca retornado).', auth: 'admin', body: EmailAccountInput },
  { method: 'post', path: '/admin/email/accounts/{id}/test', summary: 'Testar conexão IMAP.', auth: 'admin' },
  { method: 'delete', path: '/admin/email/accounts/{id}', summary: 'Remover conta e credencial.', auth: 'admin' },
  { method: 'get', path: '/admin/ai', summary: 'Configuração de IA (somente leitura).', auth: 'admin' },
  { method: 'get', path: '/admin/ai/usage', summary: 'Uso/custos de IA (30 dias).', auth: 'admin' },
  { method: 'get', path: '/admin/policies', summary: 'Políticas efetivas e mapeamento de permissões.', auth: 'admin' },
  { method: 'get', path: '/admin/audit', summary: 'Trilha de auditoria (?action=, ?limit=).', auth: 'admin' }
];

const errorResp = (d: string) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } });
const paths: Record<string, Record<string, unknown>> = {};
for (const o of ops) {
  const security = o.auth === 'nenhuma' ? [] : o.auth === 'hmac' ? [{ hmac: [] }] : [{ sessao: [], csrf: [] }];
  paths[o.path] ??= {};
  paths[o.path]![o.method] = {
    summary: o.summary,
    tags: [o.path.split('/')[1]],
    security,
    parameters: o.path.includes('{id}') ? [id] : undefined,
    requestBody: o.body ? { required: true, content: { 'application/json': { schema: js(o.body), ...(o.example ? { example: o.example } : {}) } } } : undefined,
    responses: {
      '200': { description: 'Sucesso' },
      '204': { description: 'Sucesso sem corpo' },
      '400': errorResp('VALIDATION — dados inválidos'),
      '401': errorResp('UNAUTHENTICATED — sessão ausente/expirada ou assinatura inválida'),
      '403': errorResp(o.auth === 'admin' ? 'FORBIDDEN — exige papel admin (auditado)' : 'FORBIDDEN/CSRF — sem permissão ou CSRF/origem inválidos'),
      '404': errorResp('NOT_FOUND — inexistente OU sem acesso (respostas idênticas)'),
      '429': errorResp('RATE_LIMITED'),
      '503': errorResp('SOURCE_UNAVAILABLE / NOT_CONFIGURED')
    }
  };
}
const doc = {
  openapi: '3.1.0',
  info: { title: 'ADA POSSEBON API', version: '1.0.0', description: 'API same-origin da ADA. Base: /ada/api/ada. Gerado por apps/api/src/cli/openapi.ts a partir dos esquemas de validação.' },
  servers: [{ url: '/ada/api/ada' }],
  components: {
    securitySchemes: {
      sessao: { type: 'apiKey', in: 'cookie', name: 'ada_sid', description: 'Cookie HttpOnly emitido na troca do ticket SSO.' },
      csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Obrigatório em métodos mutáveis; obtido em GET /me.' },
      hmac: { type: 'apiKey', in: 'header', name: 'X-ADA-Signature', description: 'sha256=HMAC(segredo, `${X-ADA-Timestamp}.${corpo}`), janela de 5 min.' }
    },
    schemas: {
      Erro: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } } },
      DashboardSpec: js(DashboardSpec),
      RuleDefinition: js(RuleDefinition),
      NormalizedEvent: js(NormalizedEvent)
    }
  },
  paths
};
const out = path.join(REPO_ROOT, 'docs/openapi-ada.json');
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`OpenAPI gerado: ${out} (${ops.length} operações)`);
