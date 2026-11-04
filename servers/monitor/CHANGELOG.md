# Changelog

本文件记录 **Monitor**（`com.wasmnest.monitor`）的版本变更。桌面与移动端共用同一版本号与发布 tag。

- 版本真源：`servers/monitor/{desktop,mobile}/plugin.json` 的 `version`，双端必须一致。
- 发布 tag：`monitor-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

### 新增

- 平台总览（桌面 / 移动）：全部 wasm 的内存 / 计算负载合计，桌面附内存占用前三。
- 阈值预警（桌面）：平台与单插件内存、插件状态、Trap 增量、计算负载、任务池背压；`monitor.notify` 可经宿主投递系统通知。
- 宿主进程（WebView）面板（桌面）：宿主主进程 + WebView 子进程的 PSS / RSS / CPU 与进程树合计，与 wasm 指标分开、不可相加；宿主未装配该段时显式标注「未提供」。
- 移动端宿主进程卡片：本进程 PSS / RSS / CPU 与进程树合计，附 WebView 自报 JS 堆；WebView 渲染进程为独立 uid，显式标注「不可归属」。
- 应用内检查更新：双端接入宿主 `appUpdate`，`plugin.json` 声明 GitHub Release 更新源。

### 变更

- 宿主进程段前移到平台总览之后、预警置尾；桌面改为横排布局。

### 修复

- 刷新按钮不再随每秒轮询改变状态，只随手动刷新触发。

### 安全

- i18n 消息改为构建期预编译，移除运行时编译与 CSP `unsafe-eval` 前提（安全审查 #50）。

## [0.0.1] - 2026-10-27

### 新增

- 只读查看所有已加载 wasm 应用的运行时指标：内存当前 / 峰值与上限、调用次数与在飞、平均 / 最大耗时、燃料消耗、trap 原因分布、生命周期计数、授权决策、总线背压、配额上限。
- 提供方面板：整页页签查看各应用指标，页签快速切换时丢弃晚到的旧实例（装载代次守卫）。
- 页面每秒自动刷新；`metrics:read` 由随包信任域按 manifest 自动授予，授权被拒或宿主未装配指标源时显示明确错误。
- 桌面 + 移动双端发布；桌面端支持多任务卡片只读预览（`mountPreview`）。
