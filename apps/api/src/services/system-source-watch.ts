import { createHash } from 'node:crypto';
import type { Deps } from '../core.ts';
import { extractSystemSource } from './system-source-extract.ts';
import { importSystemSource } from './system-source-import.ts';

export const sourceControlKey = (unitId: number) => 'system_source_control:' + unitId;

/** Examina uma publicação autorizada do MAD Builder, sem executar PHP nem chamar o modelo. */
export class SystemSourceWatch {
  private nextCheckAt = 0;

  constructor(private readonly d: Deps) {}

  async tick() {
    const source = this.d.config.systemSource;
    if (!source || Date.now() < this.nextCheckAt) return;
    this.nextCheckAt = Date.now() + 5 * 60_000;
    const control = await this.d.db.query<{value:{paused?:boolean}}>(
      'SELECT value FROM ada.app_setting WHERE key=$1', [sourceControlKey(source.unitId)]
    );
    if (control.rows[0]?.value.paused) return;
    const paused = await this.d.db.query(
      "SELECT 1 FROM ada.knowledge_source WHERE config->>'bootstrap_key'=$1 AND status <> 'ativo'",
      ['system_source_pack:' + source.unitId]
    );
    if (paused.rowCount) return;
    const ctx = await this.d.sessions.resolveContext(source.userId, source.unitId, 'system-source-watch', { force: true });
    if (ctx.identitySource !== 'possebon' || !ctx.programs.AdaAdministracao) {
      throw new Error('A sincronização exige administração POSSEBON na unidade configurada.');
    }
    const pack = await extractSystemSource(source.root);
    const { snapshot, ...inventory } = pack;
    const digest = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    const key = 'system_source_watch:' + source.unitId;
    const previous = await this.d.db.query<{ value: { digest?: string } }>(
      'SELECT value FROM ada.app_setting WHERE key=$1', [key]
    );
    if (previous.rows[0]?.value.digest === digest) return;
    const result = await importSystemSource(this.d, ctx, pack);
    await this.d.db.query(
      `INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [key, { digest, snapshot, inserted: result.inserted, updated: result.updated, modelCalls: 0 }, ctx.systemUserId]
    );
  }
}
