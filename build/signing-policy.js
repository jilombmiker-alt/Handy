'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const localConfigPath = () => path.join(os.homedir(), 'Library/Application Support/Handy Signing/identity.json');
function signingEnvironment(env = process.env) {
  if (env.PANEL_DEVELOPER_ID || env.PANEL_LOCAL_SIGNING_IDENTITY || env.PANEL_ALLOW_ADHOC_SIGNING === '1' || env.CI || env.GITHUB_ACTIONS) return env;
  const file = localConfigPath();
  if (!fs.existsSync(file)) return env;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^[a-f0-9]{40}$/i.test(config.identity || '')) throw Error('本机签名配置无效，不会退回临时签名。');
  return {...env, PANEL_LOCAL_SIGNING_IDENTITY:config.identity};
}

function selectSigningIdentity(env = process.env, listIdentities = () => execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })) {
  const requested = String(env.PANEL_DEVELOPER_ID || '').trim();
  const local = String(env.PANEL_LOCAL_SIGNING_IDENTITY || '').trim();
  if (requested && local) throw Error('不能同时指定本机证书与 Developer ID。');
  if (local) {
    if (env.CI || env.GITHUB_ACTIONS) throw Error('本机私人签名不可用于 CI 或 GitHub 构建。');
    if (!/^[a-f0-9]{40}$/i.test(local)) throw Error('本机固定签名必须指定证书 SHA-1 指纹，不按同名证书猜测。');
    const entries = [...listIdentities().matchAll(/\b([A-Fa-f0-9]{40})\s+"([^"\r\n]+)"/g)];
    const matches = entries.filter(([,hash])=>hash.toLowerCase()===local.toLowerCase());
    if (matches.length !== 1) throw Error('本机固定签名证书不可用或不唯一，不会退回临时签名。');
    return {identity:matches[0][1], adhoc:false, local:true};
  }
  if (requested) {
    const entries = [...listIdentities().matchAll(/\b([A-Fa-f0-9]{40})\s+"(Developer ID Application:[^"\r\n]+)"/g)];
    const matches = entries.filter(([, hash, name]) => hash.toLowerCase() === requested.toLowerCase() || name === requested);
    if (matches.length !== 1) throw new Error('指定 Developer ID 不可用或不唯一；构建已停止，不会退回临时签名。');
    return { identity: matches[0][1], adhoc: false };
  }
  if (env.PANEL_ALLOW_ADHOC_SIGNING === '1') return { identity: '-', adhoc: true };
  throw new Error('缺少稳定签名身份。请设置 PANEL_DEVELOPER_ID；仅临时试用可明确设置 PANEL_ALLOW_ADHOC_SIGNING=1（覆盖安装可能要求重新授权）。');
}

module.exports = { selectSigningIdentity, signingEnvironment, localConfigPath };
