# 输出层：桥接推送 + 账本镜像，不直连各家 agent 协议

**状态**：accepted（2026-10-29）

## 背景与问题

桌面要做的形态是 Claude Code / Codex 桌面端那种**活的会话面**：正文流式滚、工具调用成卡片、
权限在对话里内联确认、能发消息能中断。平台能力面先给出了三条硬约束（均已核对真源）：

- 前端被 eslint 静态锁禁止 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` /
  `@tauri-apps/plugin-http`（`docs/FRONTEND.md` §4）——结构化流只能走 Rust guest。
- `host-http.fetch(request-json) -> result<option<string>>` 是**整包一次性**返回
  （`wasmnest-lib/wasmnest-server-http/wit/http.wit`），吃不到 opencode 的 SSE `/event`；
  `host-websocket` 只接受 `ws://`，与 SSE 不同协议。
- `host-fs.read(path) -> option<string>` 整文件读，**无 offset / 无 stat / 无 watch**
  （`wasmnest-lib/wasmnest-wasm-core/wit/core.wit:134`）。
- PTY 输出是宿主有界环 + 游标拉取（`ring-fetch`，单次 16 KiB），但有
  `<owner>::pty:output` **50 ms 限频唤醒**可当推送信号（`rust/src/ws_terminal.rs` 模块头）。

另有一条已存在且在生产跑的通道：注入到项目目录的 agent 原生扩展（`scripts/pi_task_hook.ts`、
`opencode_task_hook.ts`）在 agent 进程内收事件，POST 到 `127.0.0.1:<port>/api/plugin/
com.wasmnest.bedcode/task-status`（`auth: none`，回环免凭证，`http_routes.rs` 有白名单先例）。

## 决定

1. **三条通道分工，互不替代**：
   - **PTY 字节**：终端页签，永远渲染同一条 PTY 的真实字节，原生 TUI 不经任何中间层。
   - **桥接（bridge）**：事件上行（扩展 POST 到回环路由）+ 命令下行（扩展长轮询取命令并调用
     本家 API）。主通道。
   - **账本镜像（ledger mirror）**：只读轮询 agent 自己的账本（pi JSONL 整读 + 行水位；
     opencode SQLite 按 `(time_updated, id)` keyset 增量）。兜底三类场景：未适配 agent、
     用户在外部终端跑的会话、桥接失效时的降级。
2. **不直连 agent server，不起副进程。** opencode `/event` 是 SSE 吃不到；pi 的
   `--mode json` 子进程是**第二条会话**，会与 TUI 那条打架。
3. **桥接复用既有机制，不新增平台能力**：沿用 `WASMNEST_SESSION_ID` 注入 + `auth: none`
   回环路由白名单，把现有两份任务 hook **合并成一份 `wasmnest_bridge`**，任务状态成为它的
   一种事件。不并存两份扩展——模板版本与事件订阅会互相抢（`task/hooks.rs` 的重部署机制
   按模板版本比对，两份扩展会各写各的）。
4. **写入统一走桥接命令队列**；中断保留 PTY 直写 `\x03` 作为永远可用的兜底；opencode 的
   REST 直连只作为桥接不可用时的第二选择。
5. **权限只代传、不代裁**：仅当 agent 提供程序化 reply 才在桌面内联批准/拒绝，否则显性降级
   为「需到终端确认」（不渲染成可点的按钮）；每次代传落审计（何时、批了什么命令）。
6. **失败语义**：桥接失效只降级视图（界面标「镜像模式」），不停 agent、不阻塞终端；未知
   事件类型丢弃并计数，不静默。
7. **流式粒度按驱动声明**：opencode 的 `part` 近 token 级，pi 为消息级。UI 不承诺统一粒度，
   没有 token 流时显示生成态，不假装逐字。

## 后果

- rust 侧新增运行事件账本（`run_events`，唯一索引 `(run_id, seq)`，每条运行保留最近
  20000 条、超出按 seq 淘汰并置 `runs.truncated`）与权限审计（`permission_audit`，存命令
  原文 + 决定 + 时间 + 来源）；前端只读账本渲染，不做通道分支（通道差异在驱动层消化，
  界面只认归一事件）。
- 注入模板从「任务状态推送器」升级为「桥接」，`task/hooks.rs` 的模板版本与自动重部署机制
  继续使用，模板版本号 +1。
- 平台零改动：无新权限、无新 WIT、无新能力域。
- **核查结果**（2026-10-29，外部文档 + 本机数据核对；仍须在本机实测的标「待测」）：
  1. **opencode 程序化回复权限：存在。** `POST /permission/{requestID}/reply`，body
     `{ reply: "once" | "always" | "reject", message?: string }`；另有 `GET /permission`
     列跨会话待处理。桥接扩展在 opencode 进程内可直接经其 client 调用，**不需要 BedCode
     自己够到 opencode 的 HTTP 面**。→ 内联批准可行，权限卡可给按钮。
  2. **pi 发送：走扩展的自定义消息 API。**（2026-10-30 本机 pi 1.4.0 实测口径）入口在
     扩展 `ExtensionAPI`：`pi.sendUserMessage(content, { deliverAs: "steer" | "followUp",
     expandPromptTemplates? })` **总是起一个 turn**，流式中用 `deliverAs` 排队；
     `pi.sendMessage(custom, { triggerTurn?, deliverAs: "steer" | "followUp" | "nextTurn" })`
     发自定义消息。→ 「发送」走桥接命令队列，按键注入只作兜底。
  3. **pi 恢复会话：`--session <文件|id>`**（另有 `-c` 续最近、`-r` 选择、`--fork` 分叉、
     `--name` 命名）。→ 恢复可在启动参数上表达，不需要交互。注意 pi 会话是**树结构**
     （entry 有 id/parentId，可 in-place 分叉）——这印证了「fork/branch 划出范围」是对的：
     它的分支模型与线性 `run_event` 不同构，要做就得重设计账本。
  4. **pi 扩展能拿到的最细事件粒度：part（token 级）。**（2026-10-30 本机 pi 1.4.0 核实）
     扩展事件 `message_update` 携带 `assistantMessageEvent`，其中含 `text_delta` /
     `thinking_delta` / `toolcall_delta`（`pi-agent-core/dist/types.d.ts`），扩展文档的
     消息生命周期也列出 `message_start` / `message_update` / `message_end`。→ `caps.stream`
     按 `part` 声明，不再降级成消息级。
  5. **pi 单会话整读耗时：约 70 ms（冷读）。**（2026-10-30 本机实测）最大会话
     `9,156,048 B / 270 行`：`readFileSync` 48.8 ms + 逐行 `JSON.parse` 13.8 ms =
     68.4 ms。→ 镜像轮询按 1 s 起步余量充足，暂不需要自适应节奏；会话数增长后再评估。
  6. **pi 项目扩展受 project trust 约束（M3 必须处理）。** pi 的项目级配置（`<cwd>/.pi/**`）
     在授予项目信任后才加载（文档 `security.md#understand-project-trust`，信任状态存
     `~/.pi/agent/trust.json`）；BedCode 注入的 `.pi/extensions/pi_task_hook.ts` 与后续
     `wasmnest_bridge` 都属于项目扩展。→ 未授信项目里桥接不会加载：运行必须仍可用、界面
     显性标「镜像模式 / 需在终端授予项目信任」，不得把「点了没反应」留给用户。
- 未适配 agent（claude / codex）本轮走镜像模式：只读、无写入、无内联权限。
