# Changelog

本文件记录 **Auth Center**（`com.wasmnest.auth-center`）的版本变更。

- 版本真源：`servers/auth-center/desktop/plugin.json` 的 `version`。
- 发布 tag：`auth-center-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

### 安全

- i18n 消息改为构建期预编译，移除运行时编译与 CSP `unsafe-eval` 前提（安全审查 #50）。

## [0.0.1] - 2026-10-27

### 新增

- 认证中心抽为 `servers/auth-center` 独立服务，作为本机入站连接的唯一裁决者（K4 单中心）。
- 六域能力：配对码 / QR / 信任 / 首连确认 / 认证策略 / 生物凭证，附认证记录库与互调 api 面。
- 页面显示中心就位三态、支持的认证方式、接入应用（消费方与宿主运行态）与入场密钥代次；配对码 / QR、可信设备与连接历史不设页面，命令与互调 api 面保留。
- `activate` 末尾注册为本机认证中心；注册失败时 fail-closed（入站全拒），页面如实显示 `not_ready` 与原因。
- BedCode 同批去注册，设备中心与 file-transfer 的 consent / 信任面改为经互调消费本插件。
- 桌面端发布；支持多任务卡片只读预览（`mountPreview`）。
