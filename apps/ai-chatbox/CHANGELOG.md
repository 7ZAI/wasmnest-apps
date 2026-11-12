# Changelog

本文件记录 **AI Chatbox**（`com.wasmnest.ai-chatbox`）的版本变更。桌面与移动端共用同一版本号与发布 tag。

- 版本真源：`apps/ai-chatbox/{desktop,mobile}/plugin.json` 的 `version`，双端必须一致。
- 发布 tag：`ai-chatbox-v<X.Y.Z>`；发布流程见 [`docs/CI.md`](../../docs/CI.md) §2。
- 结构参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
- 发布时把 `[Unreleased]` 收为 `## [<version>] - <YYYY-MM-DD>`，与版本号、tag 同一批提交。

## [Unreleased]

### 新增

- 应用内检查更新：双端接入宿主 `appUpdate`，`plugin.json` 声明 GitHub Release 更新源。

### 变更

- 桌面后端由 Rust 切换为 Go（TinyGo wasip2）试点，命令面与存储布局保持不变；Go 工具链缺失时构建跳过后端并沿用上一份产物（wasmnest-apps#21）。
- 设置页「版本更新」固定在最后，并在检查前显示当前版本号（取自随包 `plugin.json`）。

### 安全

- i18n 消息改为构建期预编译，移除运行时编译与 CSP `unsafe-eval` 前提（安全审查 #50）。

## [0.0.1] - 2026-10-27

### 新增

- 多供应商对话：OpenAI / Anthropic / Gemini / 自定义（OpenAI 兼容），Base URL、API Key、模型均可配置。
- 流式对话：SSE 增量渲染，思考内容可与正文分离展示，推理强度可调。
- 限流自动重试：429 / 503 / 529 与显式 rate limit 文本触发指数退避，最大次数与首 / 上限等待可配（0 = 关闭）。
- 多会话管理：新建 / 切换 / 重命名 / 删除，消息与 token 用量随会话落盘。
- 对话日志：JSONL 追加写，可追溯审计。
- Markdown 渲染 + 代码高亮；代码字号、行距、高亮主题可调。
- 设置页集中管理供应商、代码渲染、思考模式与限流重试。
- 桌面 + 移动双端发布；移动端使用 Shiki 高亮引擎。
- 桌面端支持多任务卡片只读预览（`mountPreview`）。
