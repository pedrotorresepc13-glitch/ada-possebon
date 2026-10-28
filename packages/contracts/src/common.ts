import { z } from 'zod';

/** Identificador de catálogo: métrica, dimensão, fonte ou campo. Nunca SQL. */
export const CatalogId = z.string().regex(/^[a-z][a-z0-9_.]{1,80}$/, 'Identificador de catálogo inválido');
export type CatalogId = z.infer<typeof CatalogId>;

export const FieldName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'Nome de campo inválido');

export const ScalarValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
export type ScalarValue = z.infer<typeof ScalarValue>;

/** Formato padrão de erro da API da ADA. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCodes = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CSRF: 'CSRF',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL'
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Classificação de sensibilidade aplicada a documentos, métricas e memórias. */
export const Sensitivity = z.enum(['publico', 'interno', 'restrito', 'confidencial']);
export type Sensitivity = z.infer<typeof Sensitivity>;

/** Estado honesto de uma integração. Nunca "ativo" sem prova. */
export const IntegrationStatus = z.enum([
  'nao_configurado',
  'configurado_nao_validado',
  'ativo',
  'degradado',
  'erro',
  'desabilitado',
  'demonstracao'
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;
