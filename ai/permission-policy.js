const crypto = require('crypto');

const TARGET_TO_TOOL = {
  todo: 'create_todo',
  note: 'save_note',
  link: 'save_link',
};

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function proposalFingerprint(proposal) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(proposal))).digest('hex');
}

function authorizeTool(input = {}) {
  if (input.confirmed !== true) return { ok: false, error: 'confirmation_required' };
  if (!input.run || input.run.status !== 'waiting_user') return { ok: false, error: 'run_not_waiting' };
  const expectedTool = TARGET_TO_TOOL[input.proposal && input.proposal.target];
  if (!expectedTool) return { ok: false, error: 'tool_not_allowed' };
  if (input.toolName !== expectedTool) return { ok: false, error: 'tool_target_mismatch' };
  return {
    ok: true,
    toolName: expectedTool,
    idempotencyKey: `${input.run.id}:${proposalFingerprint(input.proposal)}`,
  };
}

module.exports = { TARGET_TO_TOOL, proposalFingerprint, authorizeTool };
