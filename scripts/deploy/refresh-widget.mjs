import fs from 'node:fs';
import path from 'node:path';
const [mode, web, backup] = process.argv.slice(2);
if (!['apply', 'rollback'].includes(mode) || !web || !backup) throw new Error('Argumentos inválidos');
const root = path.resolve(web, 'app/templates');
const manifest = path.join(backup, 'widget-layouts.json');
if (mode === 'rollback') {
  if (fs.existsSync(manifest)) for (const item of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
    const dest = path.resolve(root, item.relative);
    if (!dest.startsWith(root + path.sep)) throw new Error('Layout fora da raiz');
    fs.copyFileSync(path.join(backup, item.saved), dest);
  }
} else {
  const changes = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.html$/.test(entry.name)) {
        const old = fs.readFileSync(file, 'utf8');
        const next = old.replace(/possebon-assistant-global\.js(?:\?[^"'\s<>]*)?/g, 'possebon-assistant-global.js?v=20261111-chat1');
        if (old !== next) changes.push({file, next, relative:path.relative(root,file), saved:'widget-layout-' + changes.length + '.html'});
      }
    }
  }
  visit(root);
  for (const item of changes) fs.copyFileSync(item.file, path.join(backup,item.saved));
  fs.writeFileSync(manifest, JSON.stringify(changes.map(({relative,saved})=>({relative,saved}))));
  for (const item of changes) fs.writeFileSync(item.file,item.next);
  console.log('Referências do widget atualizadas em ' + changes.length + ' layouts.');
}
