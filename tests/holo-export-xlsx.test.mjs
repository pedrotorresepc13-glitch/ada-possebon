import assert from 'node:assert/strict';
import {createXlsx} from '../studio/export-xlsx.mjs';
const rows=[
  ['Pergunta','Painel','Indicador','Valor','Resposta','Fonte'],
  ['Quantas pessoas?','EPC13','Pessoas distintas','1.087','Em 21/10/2026','possebon_app.colaborador'],
  ['Equipe TI?','Sem consulta','Nomes','','Não confirmado','']
];
const blob=createXlsx(rows);
assert.ok(blob.size>500);
assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const b=new Uint8Array(await blob.arrayBuffer());
assert.equal(new DataView(b.buffer).getUint32(0,true),0x04034b50,'ZIP local signature');
assert.equal(new DataView(b.buffer).getUint32(b.length-22,true),0x06054b50,'ZIP end signature');
const text=new TextDecoder().decode(b);
assert.ok(text.includes('xl/worksheets/sheet1.xml'));
assert.ok(text.includes('possebon_app.colaborador'));
assert.ok(text.includes('<v>1087</v>'),'numeric values stored as numbers');
assert.ok(text.includes('Não confirmado'),'unverified queries never get fake metrics');
console.log('Planilha XLSX gerada com células e fonte verificável.');
