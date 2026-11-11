import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const file = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('POSSO compacto: experiência consistente entre conversa e acompanhamentos', () => {
  it('considera os dois tipos de acompanhamento antes de exibir o estado vazio', () => {
    const monitors = file('../apps/web/src/views/Monitors.tsx');
    const records = file('../apps/web/src/components/RecordWatches.tsx');
    expect(monitors).toContain('<RecordWatches onCountChange={setRecordWatchCount}/>');
    expect(monitors).toContain('recordWatchCount === 0');
    expect(monitors).not.toContain('Criar pela conversa');
    expect(records).toContain('onCountChange?.(watches.length)');
  });

  it('abre o chat pelo ícone no cabeçalho, sem botões de retorno dentro do painel', () => {
    const compact = file('../apps/web/src/views/CompactChat.tsx');
    const personal = file('../apps/web/src/views/PersonalExperience.tsx');
    const widget = file('../integration/possebon-web/public/possebon-assistant-global.js');
    const assistant = file('../apps/web/src/components/CompactAssistant.tsx');
    for (const view of [compact, personal]) {
      expect(view).toContain("if (next === 'chat') { setPanel(null); return; }");
      expect(view).not.toContain('personal-panel-close');
    }
    expect(widget).toContain("addAction('Conversa'");
    expect(widget).toContain("showPanel('chat')");
    expect(assistant).toContain("onClick={()=>showPanel('chat')}");
  });

  it('oferece ditado separado da conversa por voz, sem envio automático', () => {
    const chat = file('../apps/web/src/views/Chat.tsx');
    const dictation = file('../apps/web/src/components/VoiceDictation.tsx');
    const live = file('../apps/web/src/components/LiveVoice.tsx');
    expect(chat).toContain('rows={3}');
    expect(chat).toContain('<VoiceDictation value={input} onChange={setInput} />');
    expect(chat.indexOf('<LiveVoice')).toBeGreaterThan(chat.indexOf('className="composer-actions"'));
    expect(chat).toContain('className="btn primary composer-send"');
    expect(dictation).toContain('instance.lang = \'pt-BR\'');
    expect(dictation).toContain('onChange((prefix + spoken).slice(0, 4000))');
    expect(dictation).not.toContain("api('/chat'");
    expect(live).toContain('className={status === \'parado\' ? \'voice-launch\'');
    expect(live).not.toContain('Conversar por voz');
  });

  it('renova o widget do MAD Builder sem mexer nas cotas por padrão', () => {
    const refresh = file('../scripts/deploy/refresh-widget.mjs');
    const deploy = file('../scripts/deploy/update.sh');
    expect(refresh).toContain('possebon-assistant-global.js?v=20261111-chat1');
    expect(deploy).toContain('${POSSO_REFRESH_WIDGET:-0}');
    expect(deploy).toContain('if [[ "${POSSO_REPAIR_PANELS:-0}" == 1 ]]; then');
  });
});
