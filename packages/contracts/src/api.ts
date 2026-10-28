import { z } from 'zod';
import { Sensitivity } from './common.ts';

/** Contexto de identidade/autorização resolvido NO SERVIDOR. Nunca aceito do browser. */
export interface AuthContext {
  sessionId: string;
  systemUserId: number;
  login: string;
  displayName: string;
  activeUnitId: number;
  allowedUnitIds: number[];
  units: { id: number; name: string }[];
  groups: { id: number; name: string }[];
  /** controller do POSSEBON → ações permitidas */
  programs: Record<string, string[]>;
  roles: AdaRole[];
  /** Unidades em que o usuário tem escopo gerencial (pode ver dados agregados da equipe). */
  managerUnitIds: number[];
  /** Se a sessão autoriza consolidar dados entre unidades distintas. */
  crossUnit: boolean;
  permissionsVersion: string;
  resolvedAt: string;
  identitySource: 'possebon' | 'dev_synthetic';
}
export type AdaRole = 'user' | 'manager' | 'admin';

export interface MeResponse {
  user: { systemUserId: number; login: string; displayName: string };
  activeUnit: { id: number; name: string };
  units: { id: number; name: string }[];
  roles: AdaRole[];
  isAdmin: boolean;
  identitySource: AuthContext['identitySource'];
  csrfToken: string;
  ai: { configured: boolean; provider: string; mode: 'openai' | 'deterministico' };
  demoData: boolean;
}

export const ChatRequest = z
  .object({
    conversationId: z.uuid().optional(),
    message: z.string().trim().min(1).max(4000),
    dashboardId: z.uuid().optional()
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequest>;

export const MemoryInput = z
  .object({
    content: z.string().trim().min(1).max(2000),
    kind: z.enum(['preferencia', 'fato_pessoal', 'resumo']).default('preferencia'),
    sensitivity: Sensitivity.default('interno')
  })
  .strict();

export const PreferenceInput = z
  .object({
    theme: z.enum(['auto', 'dark', 'light']).optional(),
    remember_conversations: z.boolean().optional(),
    quiet_hours: z
      .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
      .strict()
      .nullable()
      .optional(),
    retention_days: z.number().int().min(7).max(3650).optional()
  })
  .strict();
export type PreferenceInput = z.infer<typeof PreferenceInput>;

export interface NotificationDto {
  id: string;
  severity: 'info' | 'aviso' | 'critico';
  title: string;
  body: string;
  source: string | null;
  monitorId: string | null;
  dashboardId: string | null;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  evidence: unknown;
}

export const ShareInput = z
  .object({
    targetType: z.enum(['unit', 'group', 'user']),
    targetId: z.number().int().positive()
  })
  .strict();
