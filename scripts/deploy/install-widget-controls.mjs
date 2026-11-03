#!/usr/bin/env node
// Instala apenas a ponte e uma inclusão no layout; não altera login, banco, .env ou SSO existente.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = '<!-- POSSEBON GLOBAL ASSISTANT v1 -->';
const destinations = ['possebon-assistant-global.js'];
const sourceFiles = ['integration/possebon-web/public/possebon-assistant-global.js'];

function inside(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..')) throw new Error('Caminho inválido.');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Caminho fora do sistema.');
  let parent = target;
  while (parent !== root) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Arquivo ou pasta é link simbólico: ' + relative);
    parent = path.dirname(parent);
  }
  return target;
}
function lint(file) {
  const result = spawnSync(process.env.PHP_BIN || 'php', ['-l', file], {encoding:'utf8'});
  if (result.error || result.status !== 0) throw new Error('Validação PHP falhou: ' + file + '\n' + (result.stderr || result.error?.message || result.stdout));
}
function writeAtomic(file, bytes, metadata) {
  const temporary = file + '.possebon-assistant-stage';
  if (fs.existsSync(temporary)) throw new Error('Arquivo temporário já existe: ' + temporary);
  const fd = fs.openSync(temporary, 'wx', metadata.mode & 0o777);
  try {
    fs.writeFileSync(fd, bytes);
    if (process.getuid?.() === 0) fs.fchownSync(fd, metadata.uid, metadata.gid);
    // O bootstrap usa umask 077. open(mode) sozinho reduziria 0644 para 0600 e impediria o PHP de ler a ponte.
    fs.fchmodSync(fd, metadata.mode & 0o777);
  }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); } catch (e) { fs.unlinkSync(temporary); throw e; }
}
function rollback(root, backup) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));
  if (manifest.root !== root || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Backup não pertence a este sistema.');
  // Confere TODOS os arquivos antes de reverter: nunca sobrescreve atualização posterior.
  for (const entry of manifest.files) {
    const target = inside(root, entry.path);
    if (!fs.existsSync(target) || sha(fs.readFileSync(target)) !== entry.installedSha) throw new Error('Arquivo mudou após a instalação: ' + entry.path);
    if (entry.existed && sha(fs.readFileSync(inside(backup, entry.path))) !== entry.originalSha) throw new Error('Backup inconsistente.');
  }
  for (const entry of [...manifest.files].reverse()) {
    const target = inside(root, entry.path);
    if (entry.existed) writeAtomic(target, fs.readFileSync(inside(backup, entry.path)), entry);
    else fs.unlinkSync(target);
  }
  console.log('Botão global removido; arquivos anteriores restaurados. Backup preservado: ' + backup);
}
export function installWidgetControls(args) {
  const [directory, mode = 'check', restore] = args;
  if (!directory || !['check','apply','rollback'].includes(mode)) throw new Error('Uso: node install-global-assistant.mjs PASTA_POSSEBON check|apply|rollback [BACKUP]');
  const root = fs.realpathSync(directory);
  if (!fs.existsSync(inside(root, 'init.php')) || !fs.existsSync(inside(root, 'app/custom/AdaIntegrationService.php'))) throw new Error('Não é a pasta do POSSEBON com SSO já instalado.');
  if (mode === 'rollback') { if (!restore) throw new Error('Informe a pasta do backup.'); rollback(root, fs.realpathSync(restore)); return; }
  const service = fs.readFileSync(inside(root, 'app/custom/AdaIntegrationService.php'), 'utf8');
  for (const method of ['adaUrl','issueTicketForCurrentSession']) if (!service.includes('function ' + method + '(')) throw new Error('SSO existente incompatível: ' + method);
  const entries = destinations.map((relative, i) => {
    const file = inside(root, relative);
    if (fs.existsSync(file) && !fs.readFileSync(file,'utf8').startsWith('/* POSSEBON GLOBAL WIDGET v2.')) throw new Error('Arquivo existente não reconhecido: ' + relative);
    return {path:relative, bytes:fs.readFileSync(path.join(repo, sourceFiles[i])), existed:fs.existsSync(file)};
  });
  for(const bridge of ['ada-assistant.php','app/custom/AdaAssistantBridge.php']) { const file=inside(root,bridge); if(!fs.existsSync(file) || !(fs.statSync(file).mode & 0o004)) throw new Error('Ponte existente ausente ou ilegível: '+bridge); lint(file); }
  const digest = sha(entries[0].bytes).slice(0,16);
  const tag = `\n${marker}\n<script defer src="/possebon-assistant-global.js?v=${digest}" data-base="/ada/" data-bridge="ada-assistant.php"></script>\n<!-- /POSSEBON GLOBAL ASSISTANT -->\n`;
  const templates = inside(root, 'app/templates');
  for (const theme of fs.readdirSync(templates, {withFileTypes:true})) {
    if (!theme.isDirectory()) continue;
    const relative = 'app/templates/' + theme.name + '/libraries_user.html';
    const file = inside(root, relative);
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file);
    const text=original.toString('utf8');
    const pattern=/<script\b[^>]*\bsrc=["']\/(?:ada\/possebon-assistant|possebon-assistant-global)\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi;
    const matches=[...text.matchAll(pattern)];
    if(matches.length!==1) throw new Error('Esperada uma inclusão do botão no layout: '+relative);
    const updated=text.replace(pattern,tag.trim().replace(/<!--[^]*?-->/g,'').trim());
    entries.push({path:relative, bytes:Buffer.from(updated), existed:true});
  }
  if (entries.length === 1) throw new Error('Nenhum layout libraries_user.html encontrado.');
  // Backups ficam fora da raiz publicada pelo servidor web.
  const backupParent = process.env.ADA_WIDGET_BACKUPS || '/var/backups/ada/possebon-global-assistant';
  const resolvedParent = path.resolve(backupParent);
  if (resolvedParent === root || resolvedParent.startsWith(root + path.sep)) throw new Error('Backup deve ficar fora da pasta publicada.');
  const inherited = fs.statSync(inside(root, 'app/custom/AdaIntegrationService.php'));
  for (const entry of entries) {
    const target = inside(root, entry.path);
    const stat = entry.existed ? fs.statSync(target) : inherited;
    Object.assign(entry, {uid:stat.uid,gid:stat.gid,mode:entry.existed?stat.mode:0o644,
      originalSha:entry.existed?sha(fs.readFileSync(target)):null, installedSha:sha(entry.bytes)});
  }
  console.log('Pasta validada: ' + root + '\nArquivo do botão: 1; layouts: ' + (entries.length - 1));
  if (mode === 'check') { console.log('SIMULAÇÃO OK. Nenhum arquivo do POSSEBON alterado.'); return; }
  fs.mkdirSync(resolvedParent, {recursive:true,mode:0o700});
  const backup = fs.mkdtempSync(path.join(resolvedParent, new Date().toISOString().replace(/[:.]/g,'-') + '-'));
  fs.chmodSync(backup,0o700);
  // O pacote de instalação pode ser temporário; a reversão precisa sobreviver à sua remoção.
  const rollbackTool = path.join(backup,'installer.mjs');
  fs.copyFileSync(fileURLToPath(import.meta.url),rollbackTool);
  fs.chmodSync(rollbackTool,0o600);
  for (const entry of entries) if (entry.existed) {
    const destination = inside(backup,entry.path);
    fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
    fs.copyFileSync(inside(root,entry.path),destination);
  }
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({root,files:entries.map(({bytes:_bytes,...entry})=>entry)},null,2),{mode:0o600});
  const installed = [];
  try {
    for (const entry of entries) {
      const target = inside(root,entry.path);
      if (entry.existed ? sha(fs.readFileSync(target)) !== entry.originalSha : fs.existsSync(target)) throw new Error('Arquivo mudou durante a preparação: ' + entry.path);
      writeAtomic(target,entry.bytes,entry); installed.push(entry);
    }
    // Somente JavaScript do botão e sua inclusão. PHP, /ada, serviços e banco intocados.
  } catch (error) {
    for (const entry of installed.reverse()) {
      const target=inside(root,entry.path);
      if (sha(fs.readFileSync(target)) !== entry.installedSha) throw new Error('Falha e alteração concorrente; restauração manual necessária. Backup: ' + backup, {cause:error});
      if (entry.existed) writeAtomic(target,fs.readFileSync(inside(backup,entry.path)),entry); else fs.unlinkSync(target);
    }
    throw error;
  }
  console.log('Botão global instalado. Backup: ' + backup);
  console.log('Reversão: node ' + JSON.stringify(rollbackTool) + ' ' + JSON.stringify(root) + ' rollback ' + JSON.stringify(backup));
  console.log('Os próximos exports do MAD Builder devem preservar a inclusão em libraries_user.html.');
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { installWidgetControls(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode=1; }
}
