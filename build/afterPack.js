// electron-builder afterPack hook
// Signing is owned by this hook; never silently fall back from Developer ID to ad-hoc.
const { selectSigningIdentity, signingEnvironment } = require('./signing-policy');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const signing = selectSigningIdentity(signingEnvironment());

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const projectRoot = path.resolve(__dirname, '..');
  const macOSDirectory = path.join(appPath, 'Contents', 'MacOS');
  const electronExecutablePath = path.join(macOSDirectory, context.packager.appInfo.productFilename);
  const modifierAddon = path.join(appPath, 'Contents', 'Resources', 'app', 'native', '.build', 'modifier-shortcut.node');
  if (!fs.existsSync(modifierAddon)) throw new Error('打包缺少原生快捷键组件，已停止签名和分发。');
  const clipboardAddon = path.join(appPath, 'Contents', 'Resources', 'app', 'native', '.build', 'clipboard-bridge.node');
  if (!fs.existsSync(clipboardAddon)) throw new Error('打包缺少原生剪贴板组件，已停止签名和分发。');
  const musicAddon = path.join(appPath, 'Contents', 'Resources', 'app', 'native', '.build', 'music-bridge.node');
  if (!fs.existsSync(musicAddon)) throw new Error('打包缺少原生音乐组件，已停止签名和分发。');
  const desktopAddon = path.join(appPath, 'Contents', 'Resources', 'app', 'native', '.build', 'desktop-bridge.node');
  if (!fs.existsSync(desktopAddon)) throw new Error('打包缺少原生应用清单组件，已停止签名和分发。');

  if (!fs.existsSync(electronExecutablePath)) {
    throw new Error(`找不到 Electron 主程序：${electronExecutablePath}`);
  }

  console.log(`  • ${signing.adhoc ? '临时 ad-hoc' : signing.local ? '本机固定证书（非 Apple 认证）' : 'Developer ID'} 签名 ${appPath}`);

  // 依次签：所有 dylib → Framework 内 Helpers → Framework binary → Helper apps → Frameworks → 主 bundle
  const entitlementsPath = path.join(projectRoot, 'build', 'entitlements.mac.plist');
  // 逐文件失败先记录不抛：最终的 --verify --deep --strict 才是判定标准，
  // 个别无害告警不该中断构建，真正坏掉的签名会在下面的校验里被拦住。
  const signFailures = [];
  const cs = (file, executable = false) => {
    try {
      const args = ['--force', '--sign', signing.identity, signing.adhoc || signing.local ? '--timestamp=none' : '--timestamp'];
      if (executable) args.push('--options', 'runtime', '--entitlements', entitlementsPath);
      args.push(file);
      execFileSync('codesign', args, { stdio: 'pipe' });
    } catch (e) {
      signFailures.push(`${file}: ${e.message}`);
      console.warn(`    codesign 失败 ${file}: ${e.message}`);
    }
  };

  const walk = (dir, predicate, cb) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.endsWith('.app') && !entry.name.endsWith('.framework')) {
        walk(full, predicate, cb);
      } else if (entry.isFile() && predicate(entry.name, full)) {
        cb(full);
      }
    }
  };

  const fwDir = path.join(appPath, 'Contents', 'Frameworks');

  // 1) 所有 dylib
  walk(path.join(appPath, 'Contents', 'Resources', 'app', 'native'), (n) => n.endsWith('.node'), cs);
  walk(fwDir, (n) => n.endsWith('.dylib'), cs);

  // 2) Electron Framework 内部的 Helpers (chrome_crashpad_handler 等)
  const efw = path.join(fwDir, 'Electron Framework.framework', 'Versions', 'A', 'Helpers');
  if (fs.existsSync(efw)) {
    for (const f of fs.readdirSync(efw)) cs(path.join(efw, f), true);
  }

  // 3) Electron Framework 主 binary
  const efwBin = path.join(fwDir, 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework');
  if (fs.existsSync(efwBin)) cs(efwBin);

  // 4) 每个 Helper.app 的内部 binary
  for (const entry of fs.readdirSync(fwDir)) {
    if (entry.endsWith('.app')) {
      const macosDir = path.join(fwDir, entry, 'Contents', 'MacOS');
      if (fs.existsSync(macosDir)) {
        for (const f of fs.readdirSync(macosDir)) cs(path.join(macosDir, f), true);
      }
    }
  }

  // 5) 每个 Helper.app 整体
  for (const entry of fs.readdirSync(fwDir)) {
      if (entry.endsWith('.app')) cs(path.join(fwDir, entry), true);
  }

  // 6) 每个 Framework 整体
  for (const entry of fs.readdirSync(fwDir)) {
    if (entry.endsWith('.framework')) cs(path.join(fwDir, entry));
  }

  // 7) Electron 主程序（Contents/MacOS 下唯一的可执行文件）
  cs(electronExecutablePath, true);

  // 8) 主 bundle
  cs(appPath, true);

  // 校验：失败必须中断构建，否则本地会拿到一个签名已坏、却看起来构建成功的 DMG。
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log(`  ✓ 签名校验通过`);
  } catch (e) {
    if (signFailures.length) {
      console.error(`  ✗ 期间有 ${signFailures.length} 个文件签名失败：`);
      for (const failure of signFailures) console.error(`      ${failure}`);
    }
    throw new Error(`签名校验失败，产物不可分发：${e.message}`);
  }
};
