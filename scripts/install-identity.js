'use strict';
const { spawnSync } = require('node:child_process');

// Ask macOS whether the candidate satisfies the installed app's identity.
// Comparing only the name, version or bundle ID does not preserve privacy grants.
function assertSigningContinuity(installed, candidate, run = spawnSync, migration = null) {
  const current = run('/usr/bin/codesign', ['--display', '-r', '-', installed], { encoding:'utf8' });
  const requirement = `${current.stdout || ''}\n${current.stderr || ''}`.match(/^\s*#?\s*designated => (.+)$/m)?.[1];
  if (current.status !== 0 || !requirement) throw Error('无法读取已安装应用的签名身份；未覆盖应用或修改权限。');
  // codesign treats -R as a file unless the requirement starts with '='.
  const verified = run('/usr/bin/codesign', ['--verify', '--strict', '-R', `=${requirement}`, candidate], { encoding:'utf8' });
  if (verified.status !== 0) {
    // Explicit, one-time migration only from an exact ad-hoc build to an exact
    // certificate. Never permit arbitrary signer replacement or a downgrade.
    const oldHash = requirement.match(/^cdhash H"([a-f0-9]{40})"$/i)?.[1];
    if (oldHash && /^[a-f0-9]{40}$/i.test(migration?.fromAdhocHash || '') &&
        oldHash.toLowerCase() === migration.fromAdhocHash.toLowerCase() &&
        /^[a-f0-9]{40}$/i.test(migration?.toCertificate || '')) {
      const check = run('/usr/bin/codesign', ['--verify','--strict','-R',`=identifier "com.dynamicpanel.app" and certificate leaf = H"${migration.toCertificate}"`,candidate], {encoding:'utf8'});
      if (check.status === 0) return {compatible:false, migration:true, identityKind:'explicit-adhoc-to-local-certificate'};
    }
    throw Error('新构建不符合已安装应用的签名身份，覆盖可能使已有权限失效，已停止安装。请使用固定签名；首次迁移签名需要单独安排一次授权，不能静默覆盖。');
  }
  return { compatible:true, identityKind:/^cdhash\b/.test(requirement) ? 'adhoc-build-specific' : 'signed-requirement' };
}

module.exports = { assertSigningContinuity };
