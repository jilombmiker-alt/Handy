// Invoked only by the main-process importer. Read supplied bytes, never file URLs.
ObjC.import('Foundation');
ObjC.import('PDFKit');
function run() {
  try {
    var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    var document = $.PDFDocument.alloc.initWithData(data);
    if (document.isNil()) return JSON.stringify({ ok: false, error: 'file_unreadable' });
    if (document.isEncrypted || document.isLocked) return JSON.stringify({ ok: false, error: 'pdf_encrypted' });
    if (document.pageCount > 100) return JSON.stringify({ ok: false, error: 'pdf_too_many_pages' });
    var pages = [], length = 0;
    for (var index = 0; index < document.pageCount; index++) {
      var value = document.pageAtIndex(index).string;
      var text = value.isNil() ? '' : ObjC.unwrap(value);
      length += text.length + (index ? 2 : 0);
      if (length > 24000) return JSON.stringify({ ok: false, error: 'materials_too_large' });
      pages.push(text);
    }
    var result = pages.join('\n\n');
    return JSON.stringify(result.trim() ? { ok: true, text: result } : { ok: false, error: 'no_text' });
  } catch (_) { return JSON.stringify({ ok: false, error: 'file_unreadable' }); }
}
