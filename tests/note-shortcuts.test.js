const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../renderer/domain');
test('clipboard source digest survives note normalization; invalid metadata and legacy content stay independent',()=>{
  const digest='a'.repeat(64),raw={id:'n',title:'test',content:'  原文\n',createdAt:1,updatedAt:2,sourceClipboardKey:digest};
  const note=D.normalizeNoteArchive([raw])[0];assert.equal(note.sourceClipboardKey,digest);assert.equal(note.content,raw.content);
  assert.equal(D.normalizeNoteArchive([{...note,content:'人工修改',updatedAt:3}])[0].sourceClipboardKey,digest);
  for(const bad of ['private text','a'.repeat(65),null,{}])assert.equal(D.normalizeNoteArchive([{...raw,sourceClipboardKey:bad}])[0].sourceClipboardKey,undefined);
  assert.equal(D.normalizeNoteArchive([{id:'old',content:raw.content}])[0].sourceClipboardKey,undefined);
});
