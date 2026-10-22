// XLSX mínimo em formato Office Open XML; ZIP sem compressão, sem bibliotecas externas.
// Exporta SOMENTE os dados já autorizados exibidos no quadro.
const encoder=new TextEncoder();
const escapeXml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const column=index=>{
  let x=index+1,name='';
  while(x){x--;name=String.fromCharCode(65+x%26)+name;x=Math.floor(x/26);}
  return name;
};
const crcTable=Array.from({length:256},(_,n)=>{
  let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc32(bytes){
  let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function zipStore(files){
  const locals=[],centers=[];let offset=0;
  for(const [filename,content] of files){
    const name=encoder.encode(filename),bytes=encoder.encode(content);
    const crc=crc32(bytes);
    const local=new Uint8Array(30+name.length+bytes.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);
    lv.setUint16(6,0x0800,true); // nomes UTF-8
    lv.setUint16(8,0,true);lv.setUint32(14,crc,true);
    lv.setUint32(18,bytes.length,true);lv.setUint32(22,bytes.length,true);
    lv.setUint16(26,name.length,true);
    local.set(name,30);local.set(bytes,30+name.length);
    const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
    cv.setUint16(8,0x0800,true);cv.setUint16(10,0,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,bytes.length,true);
    cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);
    central.set(name,46);
    locals.push(local);centers.push(central);offset+=local.length;
  }
  const size=centers.reduce((n,x)=>n+x.length,0),tail=new Uint8Array(22),v=new DataView(tail.buffer);
  v.setUint32(0,0x06054b50,true);
  v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);
  v.setUint32(12,size,true);v.setUint32(16,offset,true);
  return new Blob([...locals,...centers,tail],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
export function createXlsx(rows){
  const sheetData=rows.map((row,i)=>{
    const cells=row.map((value,j)=>{
      const ref=column(j)+(i+1);
      // Escrever números puros na coluna Valor (índice 3), sem perder as outras strings.
      if(j===3 && i>0 && /^-?\d+(?:[.,]\d+)?$/.test(String(value)) &&
        String(value).length<16){
        const n=Number(String(value).replace(/\./g,'').replace(',','.'));
        if(Number.isFinite(n))return '<c r="'+ref+'"><v>'+n+'</v></c>';
      }
      return '<c r="'+ref+'" t="inlineStr"><is><t>'+escapeXml(value)+'</t></is></c>';
    }).join('');
    return '<row r="'+(i+1)+'">'+cells+'</row>';
  }).join('');
  const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
    sheetData+'</sheetData></worksheet>';
  const files=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
      '</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
      '</Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheets><sheet name="Consultas" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+
      '</Relationships>'],
    ['xl/worksheets/sheet1.xml',sheet]
  ];
  return zipStore(files);
}
