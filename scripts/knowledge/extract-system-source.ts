import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {extractSystemSource} from '../../apps/api/src/services/system-source-extract.ts';
export {extractSystemSource, literalItems, parseModel, parseScreen} from '../../apps/api/src/services/system-source-extract.ts';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=process.argv[2],output=process.argv[3];if(!root||!output)throw new Error('Uso: extract-system-source.ts DIRETORIO_POSSEBON ARQUIVO.json.gz');
 const pack=await extractSystemSource(root);const buffer=gzipSync(Buffer.from(JSON.stringify(pack)));await writeFile(output,buffer,{mode:0o600});
 console.log(JSON.stringify({models:pack.models.length,queries:pack.queries.length,modules:pack.modules.length,screens:pack.screens.length,definitions:pack.screens.reduce((n,s)=>n+s.definitions.length,0),bytes:buffer.length,sha256:sha(buffer)}));
}
