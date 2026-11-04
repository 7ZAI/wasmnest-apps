# Changelog

本文件记录 **BedCode**（`com.wasmnest.bedcode`）的版本变更。桌面与移动端共用同一版本号与发布 tag。

- 版本真源：`apps/bedcode/{desktop,mobile}/plugin.json` 的 `version`，双端必须一致。
- 发布 tag：`bedcode-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

### 新增

- 项目容器与工作台：项目以「本地目录 + 执行环境」为身份，新增项目列表 / 工作台（运行列表 + 终端主面 + 检查器）与 `project.*` / `run.*` 命令面；`sessions` 账本迁移为 `runs`，旧「终端会话」入口保留并存。
- 项目工作台检查器：文件树（懒加载、只读查看）与 Git 提交图（分支 DAG、提交历史、引用徽标；打开页签才读取）。
- 移动端项目页：底栏「会话」改为「项目」，项目列表 → 运行 → Agent 启动；新增项目 / 运行 / Agent 读面与 `start-run` 写面。
- Agent 管理域（原 agent-hub 并入）：Node.js 环境引导 / 移除、CLI 探测 / 安装 / 更新 / 卸载、供应商预设导入与下发、用量统计、Skill 扫描 / 导入 / 编辑 / 分发；安装卡片可直达会话配置。
- 应用内检查更新：双端接入宿主 `appUpdate`，`plugin.json` 声明 GitHub Release 更新源。
- 移动端终端内置 Sarasa Mono SC 等宽字体。

### 变更

- 终端输入条结构重构，显示设置拆为独立 store（issue #19）。
- 链路加密策略改为按应用设置：应用设置页决定不要求（off）/ 尽量加密（preferred）/ 强制加密（required），宿主只执行与只读审计，未设置 = 明文（端点注册不再声明 encryption）。WS 升级期协商（客户端提案 + 101 策略/密钥回执）已接线，`required` 同时覆盖 HTTP 与 WS 帧级加密；旧宿主（能力 `wsSession=false`）仍禁用 `required` 并显性说明。
- Agent 展示顺序改为 pi → opencode → codex → claude，四家 Agent 使用各自 TUI 强调色。
- 移动端设置步进器随视口流式缩放并去掉按钮底板。

### 修复

- 终端重放起点对齐与尾部窗口裁剪（issue #1 F3 / F6）。

### 安全

- i18n 消息改为构建期预编译，移除运行时编译与 CSP `unsafe-eval` 前提（安全审查 #50）。

## [0.0.1] - 2026-10-27

### 新增

- 配对与信任：配对码 / QR token 生命周期、首连确认、可信设备与撤销、链路加密。
- 设备中心与连接历史：已配对设备管理、历史连接记录。
- 会话中心：会话配置与生命周期编排，创建会话时自动注入项目 hooks 同步任务状态。
- 任务队列：终端工具栏任务队列与任务历史；移动端提供预设任务入口与定时任务 / 任务记录的只读投影。
- 移动端终端流：订阅回放 + 实时输出，断线自动重连并补齐环窗口，渲染背压 ack，输出风暴期自动驻留。
- 移动端输入：可打印文本与特殊键（Ctrl+C / 方向键 / 功能键）直达桌面 PTY；支持扫码 / 配对码与生物识别解锁。
- 认证角色外迁：认证中心由 `servers/auth-center` 承担（K4 单中心），设备中心 / consent / 连接记录经互调消费；BedCode 不再注册为认证中心。
- 设置：配对码 TTL、QR 有效期、hooks 等业务分组；平台设置留在宿主系统页。
- 桌面 + 移动双端发布；桌面端支持多任务卡片只读预览（`mountPreview`）。
