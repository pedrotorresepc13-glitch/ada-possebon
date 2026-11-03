import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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
it('simula sem alterar, instala preservando layout e restaura pela ferramenta persistida no backup',async()=>{
 const {root,backups,layout}=fixture();const original=fs.readFileSync(layout);
 installGlobalAssistant([root,'check']);expect(fs.readFileSync(layout)).toEqual(original);expect(fs.existsSync(backups)).toBe(false);
 installGlobalAssistant([root,'apply']);
 expect(fs.readFileSync(layout,'utf8')).toContain('possebon-assistant.js');
 expect(fs.readFileSync(layout).subarray(0,original.length)).toEqual(original);
 expect(fs.existsSync(path.join(root,'ada-assistant.php'))).toBe(true);
 const backup=path.join(backups,fs.readdirSync(backups)[0]!);
 const rollbackTool=path.join(backup,'installer.mjs');expect(fs.existsSync(rollbackTool)).toBe(true);
 const {spawnSync:spawnReal}=await vi.importActual<typeof import('node:child_process')>('node:child_process');
 const rollback=spawnReal(process.execPath,[rollbackTool,root,'rollback',backup],{encoding:'utf8'});
 expect(rollback.status,rollback.stderr).toBe(0);expect(rollback.stdout).toContain('arquivos anteriores restaurados');
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
it('executa a entrada CLI quando chamada pelo link current do release',async()=>{
 const outer=fs.mkdtempSync(path.join(os.tmpdir(),'possebon-widget-test-'));directories.push(outer);
 const release=path.join(outer,'release');fs.mkdirSync(release);
 const realFile=path.join(release,'install-global-assistant.mjs');
 fs.copyFileSync(fileURLToPath(new URL('../scripts/deploy/install-global-assistant.mjs',import.meta.url)),realFile);
 const current=path.join(outer,'current');fs.symlinkSync(release,current,'junction');
 try{
  const {spawnSync:spawnReal}=await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const result=spawnReal(process.execPath,[path.join(current,'install-global-assistant.mjs')],{encoding:'utf8'});
  // Sem argumentos, executar a CLI deve retornar o erro de uso; pular a CLI retornaria sucesso vazio.
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);expect(result.stderr).toContain('Uso:');
 }finally{fs.unlinkSync(current);}
});
