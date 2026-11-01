import {WorkspaceBriefService} from './services/workspace-brief.ts';
import {CorporateFoundationService} from './services/corporate-foundation.ts';
import {BusinessDictionaryService} from './services/business-dictionary.ts';
import {InstitutionalStudyService} from './services/institutional-study.ts';
import type { AdaConfig } from './config.ts';
import { Cipher } from './crypto.ts';
import { createDb, type Db } from './db.ts';
import { DevIdentityProvider, PossebonIdentityProvider, type IdentityProvider } from './identity.ts';
import { createLogger, type Logger } from './logger.ts';
import { DisabledProvider, type AiProvider } from './ai/provider.ts';
import { OpenAIResponsesProvider } from './ai/openai.ts';
import { CatalogService } from './services/catalog.ts';
import { SessionService } from './services/session.ts';
import { DashboardService } from './services/dashboards.ts';
import { MonitorRunner, MonitorService } from './services/monitors.ts';
import { NotificationService } from './services/notifications.ts';
import { ConversationService } from './services/conversations.ts';
import { KnowledgeService } from './services/knowledge.ts';
import { EmailService } from './services/email.ts';
import { ChatService } from './services/chat.ts';
import { PossebonBrainClient } from './services/brain.ts';
import { AdminService } from './services/admin.ts';
import { AiSettingsService } from './services/ai-settings.ts';
import { BrandingService } from './services/branding.ts';
import { OperationalAccessService } from './services/operational-access.ts';
import { OperationalWatchService } from './services/operational-watches.ts';
import { WorkspaceService } from './services/workspace.ts';
import { InitialStudyService } from './services/initial-study.ts';
import { CorporateMemoryService } from './services/corporate-memory.ts';
import { OperationalQueryService } from './services/operational-query.ts';
import { OperationalBoardService } from './services/operational-boards.ts';

/** Dependências compartilhadas pela API e pelo worker. */
export interface Deps {
  config: AdaConfig;
  db: Db;
  cipher: Cipher;
  identity: IdentityProvider;
  ai: AiProvider;
  log: Logger;
  now: () => Date;
  catalog: CatalogService;
  sessions: SessionService;
  dashboards: DashboardService;
  monitors: MonitorService;
  runner: MonitorRunner;
  notifications: NotificationService;
  conversations: ConversationService;
  knowledge: KnowledgeService;
  brain: PossebonBrainClient;
  email: EmailService;
  chat: ChatService;
  admin: AdminService;
  aiSettings: AiSettingsService;
  branding: BrandingService;
  operationalAccess: OperationalAccessService;
  watches: OperationalWatchService;
  workspace: WorkspaceService;
  workspaceBrief: WorkspaceBriefService;
  corporateFoundation: CorporateFoundationService;
  businessDictionary: BusinessDictionaryService;
  institutionalStudy: InstitutionalStudyService;
  study: InitialStudyService;
  corporateMemory: CorporateMemoryService;
  operational: OperationalQueryService;
  liveBoards: OperationalBoardService;
}

export interface DepsOverrides {
  db?: Db;
  identity?: IdentityProvider;
  ai?: AiProvider;
  now?: () => Date;
  log?: Logger;
}

export function selectIdentityProvider(config: AdaConfig): IdentityProvider {
  // Identidades sintéticas só existem com login de desenvolvimento explícito fora de produção.
  if (config.devLogin && !config.isProduction) return new DevIdentityProvider();
  return new PossebonIdentityProvider(config.possebon);
}

export function selectAiProvider(config: AdaConfig): AiProvider {
  if (config.ai.apiKey && config.ai.model) {
    return new OpenAIResponsesProvider({ apiKey: config.ai.apiKey, model: config.ai.model, baseUrl: config.ai.baseUrl, timeoutMs: config.ai.timeoutMs, maxOutputTokens: config.ai.maxOutputTokens });
  }
  return new DisabledProvider();
}

export async function createDeps(config: AdaConfig, o: DepsOverrides = {}): Promise<Deps> {
  const d = {
    config,
    db: o.db ?? (await createDb(config)),
    cipher: new Cipher(config.encryptionKey),
    identity: o.identity ?? selectIdentityProvider(config),
    ai: o.ai ?? selectAiProvider(config),
    log: o.log ?? createLogger(config.logLevel, 'ada'),
    now: o.now ?? (() => new Date())
  } as Deps;
  d.catalog = new CatalogService(d);
  d.operationalAccess = new OperationalAccessService(d);
  d.corporateFoundation=new CorporateFoundationService(d);
  d.businessDictionary=new BusinessDictionaryService(d);
  d.operational = new OperationalQueryService((unitId) => d.catalog.operationalSource(unitId),ctx=>d.operationalAccess.policy(ctx),ctx=>d.businessDictionary.read(ctx));
  d.liveBoards = new OperationalBoardService(d);
  d.watches = new OperationalWatchService(d);
  d.sessions = new SessionService(d);
  d.dashboards = new DashboardService(d);
  d.monitors = new MonitorService(d);
  d.runner = new MonitorRunner(d);
  d.notifications = new NotificationService(d);
  d.conversations = new ConversationService(d);
  d.knowledge = new KnowledgeService(d);
  d.brain = new PossebonBrainClient(config.brain, config.possebon.serviceToken);
  d.email = new EmailService(d);
  d.chat = new ChatService(d);
  d.aiSettings = new AiSettingsService(d, Boolean(o.ai));
  d.branding = new BrandingService(d);
  d.study = new InitialStudyService(d);
  d.corporateMemory = new CorporateMemoryService(d);
  d.admin = new AdminService(d);
  d.workspaceBrief = new WorkspaceBriefService(d);
  d.workspace = new WorkspaceService(d);
  d.institutionalStudy = new InstitutionalStudyService(d);
  return d;
}

export { migrateUp, migrateDown } from './migrate.ts';
export { loadConfig } from './config.ts';
