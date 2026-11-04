import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config.ts';

describe('Limites configuráveis de investigação', () => {
  it('não impõe teto diário ou por minuto por padrão', () => {
    const config = loadConfig({ ADA_ENV: 'test' });
    expect(config.ai.dailyRequestsPerUser).toBe(0);
    expect(config.ai.chatPerMinute).toBe(0);
  });
  it('permite configurar limites explícitos para ambientes com controle de capacidade', () => {
    const config = loadConfig({ ADA_ENV: 'test', ADA_AI_DAILY_REQUESTS_PER_USER: '250', ADA_CHAT_PER_MINUTE: '30' });
    expect(config.ai.dailyRequestsPerUser).toBe(250);
    expect(config.ai.chatPerMinute).toBe(30);
  });
  it('rejeita limites negativos', () => {
    expect(() => loadConfig({ ADA_ENV: 'test', ADA_AI_DAILY_REQUESTS_PER_USER: '-1' })).toThrow();
  });
});
