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
import { InitialStudyService } from './services/initial-study.ts';

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
  study: InitialStudyService;
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
  d.study = new InitialStudyService(d);
  d.admin = new AdminService(d);
  return d;
}

export { migrateUp, migrateDown } from './migrate.ts';
export { loadConfig } from './config.ts';
