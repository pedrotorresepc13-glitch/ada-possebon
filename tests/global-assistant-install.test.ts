import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('node:child_process',()=>({spawnSync:vi.fn(()=>({status:0}))}));
// @ts-expect-error O instalador é JavaScript executado pelo Node do servidor.
import {installGlobalAssistant} from '../scripts/deploy/install-global-assistant.mjs';
const directories:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const directory of directories.splice(0)){if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Fixture fora da pasta temporária.');fs.rmSync(directory,{recursive:true,force:true});}});
function fixture(){
 const outer=fs.mkdtempSync(path.join(os.tmpdir(),'possebon-widget-test-'));directories.push(outer);
 const root=path.join(outer,'web');const backups=path.join(outer,'backups');
 fs.mkdirSync(path.join(root,'app/custom'),{recursive:true});
 fs.mkdirSync(path.join(root,'app/templates/theme4'),{recursive:true});
 fs.writeFileSync(path.join(root,'init.php'),'<?php // fixture isolada');
 fs.writeFileSync(path.join(root,'app/custom/AdaIntegrationService.php'),'<?php function adaUrl(){} function issueTicketForCurrentSession(){}');
 const layout=path.join(root,'app/templates/theme4/libraries_user.html');fs.writeFileSync(layout,'<!-- Biblioteca existente -->\r\n');
 vi.stubEnv('ADA_WIDGET_BACKUPS',backups);return {root,backups,layout};
}
it('simula sem alterar, instala preservando layout e restaura backup',()=>{
 const {root,backups,layout}=fixture();const original=fs.readFileSync(layout);
 installGlobalAssistant([root,'check']);expect(fs.readFileSync(layout)).toEqual(original);expect(fs.existsSync(backups)).toBe(false);
 installGlobalAssistant([root,'apply']);
 expect(fs.readFileSync(layout,'utf8')).toContain('possebon-assistant.js');
 expect(fs.readFileSync(layout).subarray(0,original.length)).toEqual(original);
 expect(fs.existsSync(path.join(root,'ada-assistant.php'))).toBe(true);
 const backup=path.join(backups,fs.readdirSync(backups)[0]!);
 installGlobalAssistant([root,'rollback',backup]);
 expect(fs.readFileSync(layout)).toEqual(original);expect(fs.existsSync(path.join(root,'ada-assistant.php'))).toBe(false);
});
it('não sobrescreve instalação existente nem reverte alteração posterior',()=>{
 const {root,backups,layout}=fixture();installGlobalAssistant([root,'apply']);
 expect(()=>installGlobalAssistant([root,'apply'])).toThrow(/já existe/);
 fs.appendFileSync(layout,'<!-- mudança posterior -->');
 const backup=path.join(backups,fs.readdirSync(backups)[0]!);
 expect(()=>installGlobalAssistant([root,'rollback',backup])).toThrow(/mudou após/);
 expect(fs.existsSync(path.join(root,'ada-assistant.php'))).toBe(true);
 expect(fs.readFileSync(layout,'utf8')).toContain('mudança posterior');
});
