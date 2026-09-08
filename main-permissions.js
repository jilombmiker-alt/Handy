'use strict';

const path = require('node:path');

function applicationLocation(app, executable = process.execPath, platform = process.platform) {
  // Resolve from the running executable, never from a renderer-supplied path.
  const bundlePath = platform === 'darwin' && app.isPackaged && /\.app\/Contents\/MacOS\/[^/]+$/.test(executable)
    ? path.resolve(executable, '../../..') : null;
  let installed = false;
  try { installed = Boolean(bundlePath && app.isInApplicationsFolder()); } catch {}
  return { bundlePath, installed, packaged: app.isPackaged };
}

function shouldShowOnLaunch({ packaged, testRuntime, openedAtLogin }) {
  return packaged && !testRuntime && !openedAtLogin;
}

function createPermissionRequest(preferences, openSettings, platform = process.platform) {
  let pending = false;
  return async (kind) => {
    if (!['accessibility', 'screen-recording', 'microphone', 'camera'].includes(kind)) return { ok:false, error:'invalid_permission' };
    if (platform !== 'darwin') return { ok:false, error:'unsupported' };
    if (pending) return { ok:false, error:'busy' };
    pending = true;
    try {
      const status = readPermissionSnapshot(preferences, platform)[kind];
      if (status === 'granted') return { ok:true, status, message:'系统报告已授权，无需重复申请。' };
      if (status === 'restricted') return { ok:false, error:'restricted', message:'此权限受设备管理策略限制，反复重启无效。请联系设备管理员。' };
      if (kind === 'accessibility') {
        const granted = preferences.isTrustedAccessibilityClient(true);
        return { ok:true, status:granted ? 'granted' : 'denied', message:granted ? '系统报告辅助功能已授权。' : '已向系统请求辅助功能许可。请在系统提示中打开设置并允许 Handy；没有弹窗可点“打开设置”。' };
      }
      if (kind === 'screen-recording' || status === 'denied') {
        const opened = await openSettings(kind);
        return opened
          ? { ok:true, status, message:'已打开系统设置。请允许 Handy；列表中没有时，用下方“在访达定位当前应用”找到授权对象，再从设置的“＋”添加。系统要求退出时，选择“退出并重新打开”。' }
          : { ok:false, error:'settings_failed', message:'未能打开系统设置。请手动进入“系统设置 → 隐私与安全性”，再选择此权限。' };
      }
      const granted = await preferences.askForMediaAccess(kind);
      return { ok:true, status:granted ? 'granted' : 'denied', message:granted ? '已允许此权限，没有开始录音或打开摄像头。' : '未获得许可，其他工具仍可使用。需要时点“打开设置”允许，再重新检测。' };
    } catch {
      return { ok:false, error:'request_failed', message:'系统权限请求未完成。可重试或打开设置检查，不必清除已有授权。' };
    } finally { pending = false; }
  };
}

function normalizeStatus(value) {
  return ['granted', 'denied', 'restricted', 'not-determined'].includes(value) ? value : 'unknown';
}

function readPermissionSnapshot(preferences, platform = process.platform) {
  const read = (fn) => { try { return normalizeStatus(fn()); } catch { return 'unknown'; } };
  return {
    platform,
    accessibility: platform === 'darwin' ? read(() => preferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied') : 'unknown',
    'screen-recording': platform === 'darwin' ? read(() => preferences.getMediaAccessStatus('screen')) : 'unknown',
    microphone: platform === 'darwin' ? read(() => preferences.getMediaAccessStatus('microphone')) : 'unknown',
    camera: platform === 'darwin' ? read(() => preferences.getMediaAccessStatus('camera')) : 'unknown',
  };
}

function permissionMessage(snapshot) {
  const labels = { accessibility: '辅助功能', 'screen-recording': '屏幕与系统录音', microphone: '麦克风', camera: '摄像头' };
  const denied = [], restricted = [], unknown = [], optional = [];
  for (const [key, label] of Object.entries(labels)) {
    const status = normalizeStatus(snapshot?.[key]);
    if (status === 'denied') denied.push(label);
    if (status === 'restricted') restricted.push(label);
    if (status === 'unknown') unknown.push(label);
    if (status === 'not-determined') optional.push(label);
  }
  const parts = [];
  if (denied.length) parts.push(`尚未授权：${denied.join('、')}。仅在使用对应功能时开启；若系统中已开启，请核对当前应用路径，不要反复重启。`);
  if (restricted.length) parts.push(`受系统策略限制：${restricted.join('、')}。重启不能解除，请检查设备管理限制。`);
  if (unknown.length) parts.push(`暂时无法确认：${unknown.join('、')}。可重新检测，不代表已拒绝。`);
  if (optional.length) parts.push(`尚未申请：${optional.join('、')}。不用的功能无需授权。`);
  if (!parts.length) parts.push('系统报告四项权限均已授权；若某项功能仍失败，请查看该功能的具体错误。');
  return parts.join(' ');
}

function windowScanFailure(error, accessibility) {
  if (accessibility === 'denied') return 'accessibility_permission_required';
  const detail = String(error?.stderr || error?.message || '');
  if (/-1743\b/.test(detail)) return 'automation_permission_required';
  if (error?.killed || error?.code === 'ETIMEDOUT') return 'window_scan_timeout';
  return 'window_scan_failed';
}

function createPermissionRelaunch(app, schedule = setTimeout) {
  let requested = false;
  return () => {
    if (requested) return true;
    try {
      app.relaunch();
      requested = true;
      schedule(() => app.quit(), 80);
      return true;
    } catch { requested = false; return false; }
  };
}

module.exports = { normalizeStatus, readPermissionSnapshot, permissionMessage, windowScanFailure, createPermissionRelaunch, applicationLocation, shouldShowOnLaunch, createPermissionRequest };
