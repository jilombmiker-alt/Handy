const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { importMaterials, MAX_BYTES, nativeText } = require('../ai/meeting-materials');
const exec = promisify(execFile);

// Minimal deterministic PDF bytes for parser tests, not a user document.
function pdf(text = 'Meeting scope', pages = 1) {
  const content = text ? `BT /F1 12 Tf 30 700 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${5+i} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...Array.from({length:pages},()=> '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>')];
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj,i)=> { offsets.push(Buffer.byteLength(result)); result += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return result;
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-materials-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return async (name, content) => { const file = path.join(dir,name); await fs.writeFile(file,content); return file; };
}
test('text imports preserve content, expose no path, and reject invalid encodings', async (t)=> {
  const make=await fixture(t), file=await make('会议.md','# 中文会议\n讨论范围');
  assert.deepEqual(await importMaterials([file]),{ok:true,files:[{name:'会议.md',text:'# 中文会议\n讨论范围'}]});
  assert.equal((await importMaterials([await make('bad.txt',Buffer.from([0xff]))])).error,'unsupported_encoding');
  assert.equal((await importMaterials([await make('empty.txt','  ')])).error,'no_text');
  assert.equal((await importMaterials([await make('binary.txt','a\0b')])).error,'unsupported_file');
  assert.equal((await importMaterials([await make('other.html','<b>not allowed</b>')])).error,'unsupported_file');
});
test('batch, bytes and extracted text limits reject atomically without truncation', async (t)=> {
  const make=await fixture(t), good=await make('one.txt','A'.repeat(13000));
  assert.equal((await importMaterials(Array(6).fill(good))).error,'materials_too_large');
  assert.equal((await importMaterials([good,good])).error,'materials_too_large');
  assert.equal((await importMaterials([await make('long.txt','A'.repeat(24001))])).error,'materials_too_large');
  assert.equal((await importMaterials([await make('large.pdf',Buffer.alloc(MAX_BYTES+1))])).error,'file_too_large');
  assert.deepEqual(await importMaterials([]),{ok:true,files:[]});
  const failed=await importMaterials([good,`${good}.missing.txt`]);
  assert.equal(failed.ok,false); assert.equal(failed.files,undefined); assert.equal(failed.error,'file_unreadable');
});
test('native Word DOCX and DOC parse Chinese text and preserve source bytes', {skip:process.platform!=='darwin'}, async(t)=> {
  const make=await fixture(t), source=await make('source.txt','合成会议材料\n确认首批笔记与录音功能。');
  for(const format of ['docx','doc']) {
    const file=path.join(path.dirname(source),`quoted ' ; 测试.${format}`);
    await exec('/usr/bin/textutil',['-convert',format,'-output',file,source]);
    const before=await fs.readFile(file), result=await importMaterials([file]);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.match(result.files[0].text,/确认首批笔记与录音功能/);
    assert.deepEqual(await fs.readFile(file),before);
  }
  assert.equal((await importMaterials([await make('broken.docx','not a zip')])).error,'file_unreadable');
});
test('native PDF extracts multiple pages and rejects scans, damage and page limit', {skip:process.platform!=='darwin'}, async(t)=> {
  const make=await fixture(t), file=await make('meeting.pdf',pdf('Synthetic agenda',2));
  const result=await importMaterials([file]);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.files[0].text.match(/Synthetic agenda/g).length,2);
  assert.equal((await importMaterials([await make('scan.pdf',pdf(''))])).error,'no_text');
  assert.equal((await importMaterials([await make('long.pdf',pdf('page',101))])).error,'pdf_too_many_pages');
  assert.equal((await importMaterials([await make('broken.pdf','%PDF-1.4\ninvalid')])).error,'file_unreadable');
});
test('native parser timeout is bounded and does not block the next import', {skip:process.platform!=='darwin'}, async(t)=> {
  await assert.rejects(nativeText('/bin/sleep',['1'],Buffer.alloc(0),{timeoutMs:20}),{code:'import_timeout'});
  const make=await fixture(t);
  assert.equal((await importMaterials([await make('again.txt','still usable')])).ok,true);
});
test('encrypted PDF is rejected without attempting passwords', {skip:process.platform!=='darwin'}, async(t)=> {
  const make=await fixture(t), original=await make('original.pdf',pdf());
  const encrypted=path.join(path.dirname(original),'locked.pdf');
  await exec('/usr/bin/osascript',['-l','JavaScript','-e',
    `ObjC.import('Foundation');ObjC.import('PDFKit');function run(args){var doc=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(args[0]));var options=$.NSMutableDictionary.alloc.init;options.setObjectForKey('synthetic-owner',$.PDFDocumentOwnerPasswordOption);options.setObjectForKey('synthetic-password',$.PDFDocumentUserPasswordOption);return doc.writeToFileWithOptions(args[1],options);}`,original,encrypted]);
  assert.match((await fs.readFile(encrypted)).toString('latin1'),/\/Encrypt/);
  const result=await importMaterials([encrypted]);
  assert.equal(result.error,'pdf_encrypted',JSON.stringify(result));
});
