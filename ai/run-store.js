const fs = require('fs');
const path = require('path');
const { RUN_STATUSES } = require('./run-state');

const STORE_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isStoredRun(run) {
  return Boolean(run && typeof run === 'object' && !Array.isArray(run)
    && String(run.id || '').trim()
    && Number.isFinite(run.createdAt)
    && Number.isFinite(run.updatedAt)
    && RUN_STATUSES.has(run.status)
    && run.source && typeof run.source === 'object'
    && ['text', 'voice_transcript'].includes(run.source.type)
    && typeof run.source.text === 'string');
}

class AiRunStore {
  constructor(options = {}) {
    if (!options.filePath || !path.isAbsolute(options.filePath)) throw new TypeError('absolute_store_path_required');
    this.filePath = options.filePath;
    this.fs = options.fsModule || fs;
    this.maxRuns = Math.max(1, Math.min(1000, Number(options.maxRuns) || 200));
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  empty() {
    return { schemaVersion: STORE_VERSION, updatedAt: this.now(), runs: [] };
  }

  read() {
    let source;
    try {
      source = this.fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return this.empty();
      throw error;
    }
    try {
      const parsed = JSON.parse(source);
      if (!parsed || parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.runs)
        || !parsed.runs.every(isStoredRun)) throw new TypeError('invalid_ai_run_store');
      return clone(parsed);
    } catch (error) {
      const backup = this.backupCorruptFile();
      if (!backup) throw error;
      const fresh = this.empty();
      this.write(fresh);
      return fresh;
    }
  }

  backupCorruptFile() {
    try {
      if (!this.fs.existsSync(this.filePath)) return '';
      const backup = `${this.filePath}.corrupt-${this.now()}`;
      this.fs.renameSync(this.filePath, backup);
      return backup;
    } catch (error) {
      return '';
    }
  }

  write(value) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const payload = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024) throw new TypeError('ai_run_store_too_large');
    try {
      this.fs.mkdirSync(directory, { recursive: true });
      this.fs.writeFileSync(temporaryPath, payload, { mode: 0o600 });
      this.fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try { this.fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
      throw error;
    }
    return clone(value);
  }

  list() {
    return this.read().runs;
  }

  get(id) {
    return this.list().find((run) => run.id === id) || null;
  }

  upsert(run) {
    if (!run || typeof run !== 'object' || !String(run.id || '').trim()) throw new TypeError('invalid_run');
    const store = this.read();
    const runs = store.runs.filter((item) => item && item.id !== run.id);
    runs.unshift(clone(run));
    return this.write({ schemaVersion: STORE_VERSION, updatedAt: this.now(), runs: runs.slice(0, this.maxRuns) }).runs[0];
  }
}

module.exports = { STORE_VERSION, isStoredRun, AiRunStore };
