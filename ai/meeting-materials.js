const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const EXTENSIONS = ['txt', 'md', 'markdown', 'docx', 'doc', 'pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 24000;
const fail = (code) => Object.assign(new Error(code), { code });

// Native parsers run out of process, without networking or inherited API keys.
function nativeText(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', command, ...args], {
      timeout: options.timeoutMs || 15000, maxBuffer: 512 * 1024,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    }, (error, stdout, stderr) => {
      if (error) return reject(fail(error.killed ? 'import_timeout'
        : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'materials_too_large' : 'file_unreadable'));
      // textutil can report conversion failures while exiting with status zero.
      if (!stdout.trim() && stderr.trim()) return reject(fail('file_unreadable'));
      resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function extractFile(file, options = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw fail('unsupported_file');
  if (!(await fs.stat(file)).isFile()) throw fail('unsupported_file');
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw fail('unsupported_file');
    const limit = ['txt', 'md', 'markdown'].includes(ext) ? 120000 : MAX_BYTES;
    if (stat.size > limit) throw fail('file_too_large');
    // Bounded read even if the selected file grows during import.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw fail('file_too_large');
    bytes = buffer.subarray(0, length);
  } finally { await handle.close(); }
  let text;
  if (['doc', 'docx', 'pdf'].includes(ext)) {
    if (process.platform !== 'darwin') throw fail('parser_unavailable');
    if (ext === 'pdf') {
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw fail('file_unreadable');
      const raw = await nativeText('/usr/bin/osascript', ['-l', 'JavaScript', path.join(__dirname, 'pdf-text.jxa.js')], bytes, options);
      let result;
      try { result = JSON.parse(raw); } catch { throw fail('file_unreadable'); }
      if (!result.ok) throw fail(['pdf_encrypted', 'pdf_too_many_pages', 'materials_too_large', 'no_text'].includes(result.error) ? result.error : 'file_unreadable');
      text = result.text;
    } else {
      text = await nativeText('/usr/bin/textutil', ['-convert', 'txt', '-format', ext, '-stdin', '-stdout', '-encoding', 'UTF-8', '-noload', '-nostore'], bytes, options);
    }
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('unsupported_encoding'); }
  }
  if (typeof text !== 'string' || text.includes('\u0000')) throw fail('unsupported_file');
  if (!text.trim()) throw fail('no_text');
  if (text.length > MAX_CHARS) throw fail('materials_too_large');
  return { name: path.basename(file), text };
}

async function importMaterials(paths, options) {
  if (!Array.isArray(paths) || paths.length > 5) return { ok: false, error: 'materials_too_large' };
  const files = [];
  for (const file of paths) {
    try {
      files.push(await extractFile(file, options));
      if (files.reduce((count, item) => count + item.text.length, 0) > MAX_CHARS) throw fail('materials_too_large');
    } catch (error) {
      const known = ['unsupported_file', 'file_too_large', 'import_timeout', 'materials_too_large', 'file_unreadable', 'parser_unavailable', 'pdf_encrypted', 'pdf_too_many_pages', 'no_text', 'unsupported_encoding'];
      return { ok: false, error: known.includes(error.code) ? error.code : 'file_unreadable', name: typeof file === 'string' ? path.basename(file) : '' };
    }
  }
  return { ok: true, files };
}
module.exports = { EXTENSIONS, MAX_BYTES, MAX_CHARS, importMaterials, nativeText };
