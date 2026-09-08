'use strict';
const { execFileSync } = require('node:child_process');

function selectSigningIdentity(env = process.env, listIdentities = () => execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })) {
  const requested = String(env.PANEL_DEVELOPER_ID || '').trim();
  if (requested) {
    const entries = [...listIdentities().matchAll(/\b([A-Fa-f0-9]{40})\s+"(Developer ID Application:[^"\r\n]+)"/g)];
    const matches = entries.filter(([, hash, name]) => hash.toLowerCase() === requested.toLowerCase() || name === requested);
    if (matches.length !== 1) throw new Error('指定 Developer ID 不可用或不唯一；构建已停止，不会退回临时签名。');
    return { identity: matches[0][1], adhoc: false };
  }
  if (env.PANEL_ALLOW_ADHOC_SIGNING === '1') return { identity: '-', adhoc: true };
  throw new Error('缺少稳定签名身份。请设置 PANEL_DEVELOPER_ID；仅临时试用可明确设置 PANEL_ALLOW_ADHOC_SIGNING=1（覆盖安装可能要求重新授权）。');
}

module.exports = { selectSigningIdentity };
