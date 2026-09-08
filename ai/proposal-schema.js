const net = require('net');

const TARGETS = new Set(['todo', 'note', 'link', 'unknown']);
const TOP_LEVEL_KEYS = new Set(['version', 'target', 'confidence', 'needsUserEdit', 'fields', 'explanation']);
const FIELD_KEYS = {
  todo: new Set(['title', 'dueAt', 'category']),
  note: new Set(['title', 'content']),
  link: new Set(['title', 'url', 'category']),
  unknown: new Set([]),
};

function cleanText(value, maxLength) {
  return Array.from(String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, maxLength).join('');
}

function hasTimezone(value) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
    if (net.isIP(hostname)) {
      if (hostname === '::' || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')
        || /^fe[89ab]/.test(hostname) || hostname.startsWith('ff')) return false;
      if (net.isIP(hostname) === 4) {
        const [a, b] = hostname.split('.').map(Number);
        if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
          || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function invalid(details) {
  return { ok: false, error: 'invalid_proposal', details };
}

function normalizeProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(['proposal_must_be_object']);
  const extra = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (extra.length) return invalid(extra.map((key) => `unknown_key:${key}`));
  // OpenAI-compatible models sometimes serialize the protocol marker as "1" or
  // "1.0" even when instructed to emit a JSON number. Accept only those exact
  // representations and canonicalize them back to numeric version 1; every
  // other protocol version remains rejected.
  const version = value.version === 1 || value.version === '1' || value.version === '1.0' ? 1 : null;
  if (version !== 1) return invalid(['invalid_version']);
  if (!TARGETS.has(value.target)) return invalid(['invalid_target']);
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) {
    return invalid(['invalid_confidence']);
  }
  if (typeof value.needsUserEdit !== 'boolean') return invalid(['invalid_needs_user_edit']);
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) return invalid(['invalid_fields']);
  const unknownFields = Object.keys(value.fields).filter((key) => !FIELD_KEYS[value.target].has(key));
  if (unknownFields.length) return invalid(unknownFields.map((key) => `unknown_field:${key}`));

  let target = value.target;
  let needsUserEdit = value.needsUserEdit;
  let explanation = cleanText(value.explanation, 240);
  const fields = {};
  if (target === 'todo') {
    fields.title = cleanText(value.fields.title, 160);
    if (!fields.title) return invalid(['todo_title_required']);
    const dueAt = String(value.fields.dueAt || '').trim();
    if (dueAt) {
      if (!hasTimezone(dueAt) || !Number.isFinite(Date.parse(dueAt))) return invalid(['invalid_due_at']);
      fields.dueAt = new Date(Date.parse(dueAt)).toISOString();
    } else {
      // Missing deadlines can never proceed as a ready-to-write todo, even if
      // the model incorrectly claims that no user edit is needed.
      needsUserEdit = true;
      explanation = '待办缺少明确截止时间，需要用户补充';
    }
    const category = cleanText(value.fields.category, 40);
    if (category) fields.category = category;
  }
  if (target === 'note') {
    fields.title = cleanText(value.fields.title, 160);
    fields.content = String(value.fields.content || '').replace(/\u0000/g, '').trim().slice(0, 12000);
    if (!fields.content) return invalid(['note_content_required']);
  }
  if (target === 'link') {
    fields.title = cleanText(value.fields.title, 160);
    const url = String(value.fields.url || '').trim();
    if (!isPublicHttpUrl(url)) {
      // A private or malformed URL must never reach save_link. Demote it to an
      // editable unknown proposal instead of turning a safe refusal into a
      // generic model failure.
      target = 'unknown';
      needsUserEdit = true;
      explanation = '链接不是公开 http/https 地址，需要用户修改';
      for (const key of Object.keys(fields)) delete fields[key];
    } else {
      fields.url = new URL(url).toString();
      const category = cleanText(value.fields.category, 40);
      if (category) fields.category = category;
    }
  }
  if (target === 'unknown' && !needsUserEdit) return invalid(['unknown_requires_edit']);

  return {
    ok: true,
    value: {
      version,
      target,
      confidence: value.confidence,
      needsUserEdit,
      fields,
      explanation,
    },
  };
}

function parseProposalResponse(value) {
  if (value && typeof value === 'object') return normalizeProposal(value);
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return normalizeProposal(JSON.parse(source));
  } catch (error) {
    return invalid(['response_is_not_json']);
  }
}

module.exports = { TARGETS, cleanText, isPublicHttpUrl, normalizeProposal, parseProposalResponse };
