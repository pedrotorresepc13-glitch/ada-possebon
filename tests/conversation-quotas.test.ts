import { expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config.ts';
import { ChatService } from '../apps/api/src/services/chat.ts';

it('zero desativa cotas diárias e por minuto sem consultar consumo', async () => {
  const config = loadConfig({ ADA_ENV: 'test', ADA_CHAT_PER_MINUTE: '0', ADA_AI_DAILY_REQUESTS_PER_USER: '0', ADA_AI_MONTHLY_TOKENS_PER_USER: '0' });
  expect(config.ai.monthlyTokensPerUser).toBe(0);
  // Exercita as decisões de cota isoladamente; nenhuma conexão deve ser necessária.
  const service = new ChatService({ config } as ConstructorParameters<typeof ChatService>[0]);
  const quota = service as unknown as { checkRate(id: number): void; aiQuotaAvailable(ctx: unknown): Promise<boolean> };
  for (let i = 0; i < 1000; i++) quota.checkRate(230);
  expect(await quota.aiQuotaAvailable({ systemUserId: 230 })).toBe(true);
});

it('mantém limite explícito quando configurado e rejeita valores negativos', () => {
  const config = loadConfig({ ADA_ENV: 'test', ADA_CHAT_PER_MINUTE: '1' });
  const service = new ChatService({ config } as ConstructorParameters<typeof ChatService>[0]);
  const quota = service as unknown as { checkRate(id: number): void };
  quota.checkRate(93482);
  expect(() => quota.checkRate(93482)).toThrow('Muitas mensagens');
  expect(() => loadConfig({ ADA_ENV: 'test', ADA_CHAT_PER_MINUTE: '-1' })).toThrow();
});
