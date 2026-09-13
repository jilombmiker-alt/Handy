const { selectSigningIdentity, signingEnvironment } = require('./signing-policy');
exports.default = async ({ electronPlatformName }) => {
  if (electronPlatformName !== 'darwin') return;
  require('../scripts/build-modifier-shortcut').build();
  const { adhoc } = selectSigningIdentity(signingEnvironment());
  if (adhoc) console.warn('  ⚠ 本次已明确选择临时签名；每次新构建可能使旧权限失效。');
};
