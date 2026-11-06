import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadConfig} from '../config.ts';
import {createDeps} from '../core.ts';
import {prepare} from '../boot.ts';
import {importSystemSource} from '../services/system-source-import.ts';
const file=process.argv[2],expected=process.argv[3],user=Number(process.argv[4]??230),unit=Number(process.argv[5]??3);
if(!file||!expected||!/^[a-f0-9]{64}$/.test(expected)||!Number.isInteger(user)||!Number.isInteger(unit))throw new Error('Uso: import-system-source.mjs PACOTE.json.gz SHA256 USUARIO UNIDADE');
const bytes=await readFile(file);if(bytes.length>20_000_000||createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Pacote excede o tamanho permitido ou SHA-256 diverge.');
const pack:unknown=JSON.parse(gunzipSync(bytes,{maxOutputLength:60_000_000}).toString('utf8'));
// Configuração carregada pelo root via --env-file; código de aplicação roda como ada.
if(process.getuid?.()===0){process.setgroups!([]);process.setgid!('ada');process.setuid!('ada');}
const config=loadConfig();if(config.db.driver!=='pg'||config.devLogin||config.demoData)throw new Error('Importação no servidor exige PostgreSQL real, sem login de desenvolvimento ou demonstração.');
const d=await createDeps(config);try{await prepare(d,config);const ctx=await d.sessions.resolveContext(user,unit,'system-source-import',{force:true});if(ctx.identitySource!=='possebon')throw new Error('Identidade POSSEBON real obrigatória.');const result=await importSystemSource(d,ctx,pack);console.log(JSON.stringify({...result,conflicts:result.conflicts.length},null,2));}finally{await d.db.close();}
