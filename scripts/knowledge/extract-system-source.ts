import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {SystemSourcePack,type SourcePack} from '../../apps/api/src/services/source-pack-schema.ts';
import {isProtectedTable} from '../../apps/api/src/services/unit-path.ts';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const protectedField=/(senha|password|token|secret|credential|chave_privada|api_key|session)/i;
const literal=String.raw`(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")`;
const decoded=(a:string|undefined,b:string|undefined)=>{const value=a??b??'';if(b!==undefined&&/(?<!\\)\$/.test(value))return null;return value.replace(/\\(['"\\])/g,'$1');};
const withoutComments=(s:string)=>s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/g,(match,quoted:string|undefined)=>quoted??match.replace(/[^\n]/g,' '));
/** Aceita apenas pares literais completos; nunca eval/PHP, concatenações ou expressões. */
export function literalItems(text:string){
 const re=new RegExp('\\s*'+literal+'\\s*=>\\s*'+literal+'\\s*(?:,|$)','gy');let at=0;const items:{code:string;label:string}[]=[];
 while(at<text.length){re.lastIndex=at;const m=re.exec(text);if(!m)return null;at=re.lastIndex;const code=decoded(m[1],m[2]),label=decoded(m[3],m[4]);
  if(code===null||label===null||!/^[A-Za-z0-9_.-]{1,12}$/.test(code)||!label||label.length>120||/[<>\r\n]|https?:|@/.test(label))return null;
  items.push({code,label});if(items.length>40)return null;
 }return items;
}
export function parseModel(content:string,relative:string):SourcePack['models'][number]|null{
 const sourceText=content;content=withoutComments(content);
 const model=/class\s+([A-Za-z_][A-Za-z0-9_]*)\s+extends\s+/.exec(content)?.[1];
 const table=/const\s+TABLENAME\s*=\s*['"]([a-z][a-z0-9_]*)['"]/.exec(content)?.[1];
 if(!model||!table||isProtectedTable(table))return null;
 const fields=[...content.matchAll(/parent::addAttribute\(\s*['"]([a-z][a-z0-9_]*)['"]\s*\)/g)].map(m=>m[1]!).filter(f=>!protectedField.test(f));
 const primary=/const\s+PRIMARYKEY\s*=\s*['"]([a-z][a-z0-9_]*)['"]/.exec(content)?.[1]??'id';
 return {name:model,table,fields:[...new Set([primary,...fields])],source:{path:relative,sha256:sha(sourceText)}};
}
export function parseScreen(content:string,relative:string,models:SourcePack['models']):SourcePack['screens'][number]|null{
 const sourceText=content;content=withoutComments(content);
 const name=/class\s+([A-Za-z_][A-Za-z0-9_]*)\s+extends\s+/.exec(content)?.[1];if(!name)return null;
 const active=/\$activeRecord\s*=\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/.exec(content)?.[1];const model=models.find(m=>m.name===active);
 // Títulos são texto literal de interface; nenhum HTML, registro ou corpo de método é copiado.
 const titleMatch=new RegExp('setFormTitle\\(\\s*'+literal+'\\s*\\)').exec(content);
 const title=(titleMatch?decoded(titleMatch[1],titleMatch[2]):null)?.replace(/<[^>]*>/g,'').trim().slice(0,200)||name;
 const widgets=new Map<string,string>();
 for(const m of content.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+T[A-Za-z0-9_]+\(\s*['"]([a-z][a-z0-9_]*)['"]/g))if(!protectedField.test(m[2]!))widgets.set(m[1]!,m[2]!);
 const definitions:SourcePack['screens'][number]['definitions']=[];
 const optionLists:SourcePack['screens'][number]['optionLists']=[];
 for(const m of content.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)->addItems\(\s*\[([^\]]*)\]\s*\)/g)){
  const field=widgets.get(m[1]!);if(!field||/_id$/.test(field)||!/status|situacao|tipo|turno|flag|local|lideranca|jovem_aprendiz|controle_ponto|autonomia_renda|contrato|modalidade|prioridade|categoria|origem|periodo/.test(field))continue;
  const items=literalItems(m[2]!.trim());if(items){if(model?.fields.includes(field))definitions.push(...items.map(i=>({field,...i})));else optionLists.push({field,values:items});}
 }
 const defaults:SourcePack['screens'][number]['defaults']=[];
 const defaultRe=new RegExp('\\$([A-Za-z_][A-Za-z0-9_]*)->setValue\\(\\s*'+literal+'\\s*\\)','g');
 for(const m of content.matchAll(defaultRe)){const field=widgets.get(m[1]!),value=decoded(m[2],m[3]);if(field&&/^(tipo|origem|status|situacao|turno|categoria|.*_tipo|.*_status)$/.test(field)&&model?.fields.includes(field)&&value!==null&&/^[A-Za-z0-9_.-]{0,20}$/.test(value))defaults.push({field,value});}
 return {name,title,area:relative.split('/')[2]??'outros',table:model?.table??null,fields:[...new Set(widgets.values())],definitions,optionLists,defaults,source:{path:relative,sha256:sha(sourceText)}};
}
async function files(root:string,folder:string):Promise<string[]>{
 const out:string[]=[];for(const item of await readdir(path.join(root,folder),{withFileTypes:true})){
  const relative=folder+'/'+item.name;if(item.isSymbolicLink())continue;if(item.isDirectory())out.push(...await files(root,relative));else if(item.name.endsWith('.php'))out.push(relative);
 }return out.sort();
}
export async function extractSystemSource(root:string):Promise<SourcePack>{
 root=path.resolve(root);await stat(path.join(root,'app/model'));await stat(path.join(root,'app/control'));
 const models:SourcePack['models']=[],queries:SourcePack['queries']=[];
 for(const file of await files(root,'app/model')){const content=await readFile(path.join(root,file),'utf8');const m=parseModel(content,file);if(m)models.push(m);else{
  const name=/class\s+([A-Za-z_][A-Za-z0-9_]*)\s+extends\s+DBQuery/.exec(content)?.[1];if(name){
   const fields=[...new Set([...content.matchAll(/\bAS\s+["']?([a-z][a-z0-9_]*)["']?/gi)].map(m=>m[1]!.toLowerCase()).filter(f=>!protectedField.test(f)))];
   const candidateTables=[...new Set([...content.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)/gi)].map(m=>m[1]!.toLowerCase()).filter(t=>!isProtectedTable(t)))];
   queries.push({name,fields,candidateTables,source:{path:file,sha256:sha(content)}});
  }
 }}
 const screens:SourcePack['screens']=[];for(const file of await files(root,'app/control')){const s=parseScreen(await readFile(path.join(root,file),'utf8'),file,models);if(s)screens.push(s);}
 const modules:SourcePack['modules']=[];
 for(const folder of ['app/custom','app/service']){if(!await stat(path.join(root,folder)).catch(()=>null))continue;for(const file of await files(root,folder)){
  const content=await readFile(path.join(root,file),'utf8');const name=/(?:class|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(content)?.[1]??path.basename(file,'.php');
  if(/auth|credential|token|password|session/i.test(name))continue;
  const methods=[...new Set([...content.matchAll(/(?:public\s+)?(?:static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(m=>m[1]!).filter(n=>!protectedField.test(n)))];
  modules.push({name,methods,source:{path:file,sha256:sha(content)}});
 }}
 return SystemSourcePack.parse({format:'possebon-system-source-v1',classification:'interno-restrito',snapshot:new Date().toISOString(),models,queries,modules,screens});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=process.argv[2],output=process.argv[3];if(!root||!output)throw new Error('Uso: extract-system-source.ts DIRETORIO_POSSEBON ARQUIVO.json.gz');
 const pack=await extractSystemSource(root);const buffer=gzipSync(Buffer.from(JSON.stringify(pack)));await writeFile(output,buffer,{mode:0o600});
 console.log(JSON.stringify({models:pack.models.length,queries:pack.queries.length,modules:pack.modules.length,screens:pack.screens.length,definitions:pack.screens.reduce((n,s)=>n+s.definitions.length,0),bytes:buffer.length,sha256:sha(buffer)}));
}
