# 助手代抓保持显式未实现，只暴露反向工具面

**状态**：accepted（2026-11-18）

## 背景与问题

需求里有一条「也支持通过 AI agent 执行爬虫」。直觉方案是新闻应用调用系统 AI 助手（Nest），把 URL 交给它抓取并拿回结构化结果。

但 Nest 当前的接入方向是反的：

- `servers/assistant/desktop/plugin.json` **没有 `api` 数组**，Rust 侧也没有 `#[plugin_api]`（分支 `feat/nest-assistant-m1`）。
- 宿主提供的是 `AppControlAPI`：助手拥有 `apps:control` 权限，按目标应用声明的 `contributes.assistantTools` 白名单调用其命令（桌面实现 `wasmnest-desktop/src/shell/mount/appControlBridge.ts`，含 `argsSchema` 校验与审计）。
- 也就是说：**助手能调应用，应用不能调助手**。宿主的 `host-api-call` 只能在「被调方声明了 api」时成立，而 Nest 没有声明。

同时，这套机制目前只在 `feat/nest-assistant-m1`（平台 worktree `wasmnest-nest` + 应用 worktree `wasmnest-apps-feat-nest-m1`）成立，`uat` 主树上没有消费方。

## 决定

1. **正向面（可交付）**：`news` 在 `plugin.json` 声明 `contributes.assistantTools`（今日摘要、搜索条目、刷新源、添加源），让助手能调用新闻应用。风险分级 `read` / `write`，参数 schema 明确。
2. **反向面（预留）**：`rust/core` 定义 `AssistantBridge` 端口 `request_fetch(url, expected_schema)`，`rust/plugin` 的实现固定返回 `PortError::new("assistant.fetch-unavailable")`；界面上的「用助手抓取」入口在调用时显示该错误，不做静默回退。
3. **不伪造能力**：在 Nest 补出对外 `api` 之前，应用不尝试任何跨应用调用 Nest 的路径，也不把「助手代抓」写进 v1 的成功判据。

## 后果

1. `uat` 主树上这些工具声明会被清单保留，但没有宿主消费；分支合入后自动生效，无需改应用代码。这一点必须在实现 PR 中写明，避免被误判为「声明无效」。
2. 核心抓取不依赖助手状态：助手未安装、未激活、分支未合入时，内置引擎照常工作。
3. 用户若在界面上点「用助手抓取」，会看到一条明确的「当前宿主助手未提供该能力」，而不是空结果或假装在跑。
4. 将来 Nest 补 `api` 后，只需替换 `AssistantBridge` 的实现与一处声明，动不到抓取主链。

## 替代方案

- **等 Nest 补 api 再开工**：会让整个应用的交付被另一个分支阻塞，且内置抓取本来就不需要它。否决。
- **跨应用调用 bedcode 的 agent 池代抓**：移动端不存在 CLI agent，桌面端又要求 bedcode 处于激活态；核心功能会随另一个应用的状态飘。否决。
- **在应用内跑浏览器自动化**：宿主没有浏览器 / webview 给插件用，wasm 也无法驱动外部进程。做不到。