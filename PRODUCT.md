# Handy 产品约束

<!-- impeccable:product-schema 1 -->

本文只为设计工具提供上下文；产品行为的唯一事实来源仍是 [README.md](README.md)。冲突时以 README 为准。

## Platform

web

Electron 内嵌 HTML/CSS/JavaScript，运行于 macOS 桌面，不是移动网站。本轮用户已确认只改桌面 UI，官网不在范围内。

## Users

Mac 上需要随手记录、切换窗口与管理本地工作资料的使用者；本轮直接服务现有用户。

## Product Purpose

通过菜单栏入口或快捷键从底部唤出工具启动器，选择工具后直接在同一面板使用。产品定位是便捷使用，先满足临时和日常需求，不替代完整办公软件。

## Capabilities and Constraints

- 保留现有全部页面、功能、数据结构与权限恢复流程。
- 折叠时只保留 Tray；不以中央窗口压住其他应用。
- 同一主窗口承载工具，默认 8 个常用入口与搜索；更多功能按需进入，不弹多个独立小窗。
- 图片主体无遮挡；画廊操作静置隐藏且支持键盘聚焦，实时镜子为主动开启。
- 麦克风、摄像头不得自动启动；不修改 TCC。
- 不得把概念图或模拟服务测试当成真实服务验收。

## Brand Commitments

Handy，随手即用。中文产品语言，简约、干净，纯白与黑曜石主题；应用身份和历史数据目录保持兼容。

## Evidence on Hand

README、renderer 源码、现有 Electron 流程测试；隔离测试窗口截图不含用户个人内容。
