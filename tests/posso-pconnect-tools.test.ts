import { describe, expect, it } from 'vitest';
import { ChatService } from '../apps/api/src/services/chat.ts';

/** The model may discover this tool, but the executor independently enforces admin role and unit. */
describe('POSSO PConnect model tools', () => {
  it('exposes the live PConnect catalog as a read-only tool', () => {
    const service = new ChatService({} as ConstructorParameters<typeof ChatService>[0]);
    const specs = (service as unknown as { tools(): Array<{ name: string; description: string }> }).tools();
    const tool = specs.find(t => t.name === 'listar_integracoes_pconnect');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('administradores');
    expect(tool!.description).toContain('MAD Builder');
    expect(specs.filter(t => t.name === 'listar_integracoes_pconnect')).toHaveLength(1);
  });
});
