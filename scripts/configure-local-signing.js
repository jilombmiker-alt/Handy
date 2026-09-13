'use strict';
// Persist only a public fingerprint outside the repository. Never export keys.
const fs = require('node:fs');
const path = require('node:path');
const { selectSigningIdentity, localConfigPath } = require('../build/signing-policy');
const identity = process.argv[2];
if (!identity) throw Error('用法：node scripts/configure-local-signing.js <证书 SHA-1 指纹>');
const signing = selectSigningIdentity({PANEL_LOCAL_SIGNING_IDENTITY:identity});
const file = localConfigPath();
if (fs.existsSync(file)) {
  const old = JSON.parse(fs.readFileSync(file,'utf8'));
  if (String(old.identity).toLowerCase() !== signing.identity.toLowerCase()) throw Error('已有其他固定签名配置，拒绝自动更换；需要单独迁移身份。');
} else {
  fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
  fs.writeFileSync(file,JSON.stringify({identity:signing.identity},null,2)+'\n',{mode:0o600,flag:'wx'});
}
console.log('已固定本机证书；后续 npm run build 自动复用。私钥未导出，GitHub/CI 不读取此配置。');
