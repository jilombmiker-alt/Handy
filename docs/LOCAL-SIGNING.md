# 免费本机固定签名与社区构建

## 本机使用

无需付费 Apple 开发者账号。在系统钥匙串的证书助理创建一次自签名「代码签名」证书，使用专用名称，例如 `Handy Local Code Signing`，保存到登录钥匙串。只用于本机开发测试，不代表 Apple 认证或公证。不要导出或分享私钥，不要每次打包重新创建证书。

证书扩展仅选择代码签名。若需要设置信任，只设置该证书的代码签名用途；不要把 SSL、邮件等用途全部改为信任，不关闭 Gatekeeper 或 SIP。系统密码、钥匙串访问确认由用户在系统界面处理。

用 `security find-identity -v -p codesigning` 读取证书指纹，再运行：

```sh
node scripts/configure-local-signing.js <证书的40位SHA-1指纹>
npm run build
node scripts/install-local.js --check
```

配置只保存公共指纹到本机 `Library/Application Support/Handy Signing/identity.json`，不在仓库中。后续 `npm run build` 自动使用该身份；证书找不到或无效时中止，不退回临时签名。

首次从 ad-hoc 迁移可能需要重新确认已有隐私权限。先核对当前安装包的 `codesign --display -r - /Applications/Handy.app` 输出，再正常退出应用并执行：

```sh
PANEL_MIGRATE_FROM_CDHASH=<当前安装包的40位CDHash> node scripts/install-local.js --migrate-local-signing
```

该迁移只接受明确旧临时签名哈希和已配置的新证书；不能用来更换其他证书或降级回临时签名。正常更新不带迁移参数，仍必须满足已安装版本的签名身份。备份和用户数据保留。

签名连续性检查不是 TCC 权限保留的完整证明。需用同一证书签两个不同构建，验证一次授权后的覆盖不会重新提示。新增权限、用户撤销、系统策略变化等不在保证范围内。

## GitHub 与他人构建

仓库只提供源码、通用构建脚本和说明，不放维护者私钥、钥匙串或本机配置。不要上传本机固定签名的 DMG 作为社区包。

下载者可以自行创建本机固定证书，或明确选择无需个人证书的临时签名：

```sh
npm ci
PANEL_ALLOW_ADHOC_SIGNING=1 npm run build
```

后者依然是 ad-hoc 签名，不是「完全无签名」，不提供跨构建身份稳定性或 Apple 公证。macOS 可能拦截来自互联网的安装包；不得以关闭系统安全机制作为通用安装要求。

GitHub Actions 不读取维护者本机配置，也拒绝显式传入本机私人签名模式。现有手动社区构建仍使用 ad-hoc，不需要上传证书 secret。本说明不触发推送或发布。

参考：[Apple 自签名证书与代码签名](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)。
