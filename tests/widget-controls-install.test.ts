import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('node:child_process',()=>({spawnSync:vi.fn(()=>({status:0}))}));
// @ts-expect-error Instalador JavaScript independente do painel.
import {installWidgetControls} from '../scripts/deploy/install-widget-controls.mjs';
const folders:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const folder of folders){if(!folder.startsWith(os.tmpdir()+path.sep))throw Error('Fixture fora do temporário');fs.rmSync(folder,{recursive:true,force:true});}folders.length=0;});
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'widget-controls-'));folders.push(directory);
 const root=path.join(directory,'web'),backups=path.join(directory,'backups');
 for(const folder of ['app/custom','app/templates/theme-builder','app/routes','ada'])fs.mkdirSync(path.join(root,folder),{recursive:true});
 const contents:Record<string,string>={'init.php':'<?php','ada-assistant.php':'<?php // ponte atual','app/custom/AdaAssistantBridge.php':'<?php // autorização atual','app/custom/AdaIntegrationService.php':'<?php function adaUrl(){} function issueTicketForCurrentSession(){}','app/routes/api.php':'<?php // rotas intocadas','ada/possebon-assistant.js':'// versão com voz intocada','app/templates/theme-builder/libraries_user.html':'<!-- biblioteca anterior -->\r\n<script defer src="/ada/possebon-assistant.js?v=old" data-base="/ada/" data-bridge="ada-assistant.php"></script>\r\n<!-- biblioteca seguinte -->'};
 for(const [file,bytes] of Object.entries(contents)){fs.writeFileSync(path.join(root,file),bytes);fs.chmodSync(path.join(root,file),0o644);}
 vi.stubEnv('ADA_WIDGET_BACKUPS',backups);
 return {root,backups,contents,layout:path.join(root,'app/templates/theme-builder/libraries_user.html')};
}
it('simula sem alterar e troca somente o script do botão, preservando voz, PHP, rotas e bibliotecas',()=>{
 const f=fixture();installWidgetControls([f.root,'check']);expect(fs.existsSync(f.backups)).toBe(false);
 installWidgetControls([f.root,'apply']);
 for(const [file,bytes] of Object.entries(f.contents))if(!file.endsWith('libraries_user.html'))expect(fs.readFileSync(path.join(f.root,file),'utf8')).toBe(bytes);
 const layout=fs.readFileSync(f.layout,'utf8');expect(layout).toContain('/possebon-assistant-global.js?v=');expect(layout).toContain('<!-- biblioteca anterior -->\r\n');expect(layout).toContain('\r\n<!-- biblioteca seguinte -->');expect(layout).not.toContain('/ada/possebon-assistant.js');
 const backup=path.join(f.backups,fs.readdirSync(f.backups)[0]!);installWidgetControls([f.root,'rollback',backup]);
 expect(fs.readFileSync(f.layout,'utf8')).toBe(f.contents['app/templates/theme-builder/libraries_user.html']);expect(fs.existsSync(path.join(f.root,'possebon-assistant-global.js'))).toBe(false);
});
it('recusa layout ambíguo antes de escrever qualquer arquivo',()=>{
 const f=fixture();fs.appendFileSync(f.layout,'<script src="/ada/possebon-assistant.js"></script>');
 expect(()=>installWidgetControls([f.root,'apply'])).toThrow(/uma inclusão/);expect(fs.existsSync(path.join(f.root,'possebon-assistant-global.js'))).toBe(false);expect(fs.existsSync(f.backups)).toBe(false);
});
it('não reverte sobre alterações posteriores e não aceita sobrescrever arquivo desconhecido',()=>{
 const f=fixture();fs.writeFileSync(path.join(f.root,'possebon-assistant-global.js'),'arquivo externo');expect(()=>installWidgetControls([f.root,'apply'])).toThrow(/não reconhecido/);
 fs.unlinkSync(path.join(f.root,'possebon-assistant-global.js'));installWidgetControls([f.root,'apply']);const backup=path.join(f.backups,fs.readdirSync(f.backups)[0]!);fs.appendFileSync(f.layout,'<!-- export posterior -->');expect(()=>installWidgetControls([f.root,'rollback',backup])).toThrow(/mudou após/);expect(fs.readFileSync(f.layout,'utf8')).toContain('export posterior');
});
