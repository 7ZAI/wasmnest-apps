# Orca 自动化与 Agent 状态监控实现参考（WasmNest 优化借鉴）

> **目的**：Orca（stablyai/orca，Electron IDE，并行 agentic 开发）在"agent 定时任务 + 任务完成监控"上的实现，是经过大量线上事故打磨的成熟模式。本文提炼其可借鉴的实现，对照 WasmNest（含 bedcode 插件）现状给出优化建议，供后续迭代参考。
>
> **依据**：Orca 源码（`src/main/automations/`、`src/shared/automations/`、`src/renderer/src/store/slices/agent-status/`）；WasmNest 现状分析（`apps/bedcode/desktop/rust/src/task/` 与 `wasmnest-lib/wasmnest-pty-engine/wit/pty.wit`）。
>
> **日期**：2026-11

---

## 0. 一句话总结

Orca 的核心思想：**"先写库再派发 + 双通道完成判定 + 每 run 独立观察 + 启动对账"**。
WasmNest 现状是：**"hook 自报 + 会话级看门狗"**。借鉴的关键不是照搬代码，而是把"监控的权威状态机"从"agent 自报事件流"升级为"插件持有的每任务观察器"。

---

## 1. Orca 关键实现模式清单

### 1.1 调度引擎：tick 轮询 + nextRunAt 前瞻 + 宽限补跑

**位置**：`src/main/automations/service.ts`

- 固定节拍轮询（默认 60s，`DEFAULT_TICK_MS`），非 cron 守护：
  ```
  setInterval(() => { evaluateDueRuns(); retention.sweep() }, tickMs)
  ```
- `evaluateDueRuns`：遍历 `enabled && nextRunAt <= now` 的自动化，逐个评估。
- **错过判定 `missedBeyondGrace`**（`dispatch-refusal.ts`）：
  ```
  now - scheduledFor > graceMs + tickMs * 2
  ```
  宽限期内照跑（补跑），超出 + 两个 tick 抖动余量才记 `skipped_missed`。
  → 借鉴：宽限内补跑语义（WasmNest 目前是"超过 120s 直接 missed 不补跑"，宽限语义弱）。
- **先写库再派发**：先 `createRun` 落 `pending` 行，再推进 `nextRunAt`，最后在独立 lane 派发。
  崩溃/重启后"已写行"是恢复锚点。
- **串行 lane**：`runKeyedSerializedOperation` —— 同一 automation 的派发串行、不同 automation 并行。
- **dispatchGeneration**：每次 stop/restart 递增，旧回调/旧 Promise 自动失效，防止停止后幽灵派发。

### 1.2 调度表达式：cron + RRULE 双语法 + 逐分钟扫描 + 时区/DST 正确

**位置**：`src/shared/automations/scheduling/`

- 同时支持标准 5 段 cron 与 RRULE（`FREQ=HOURLY/DAILY/WEEKLY;BYHOUR;BYMINUTE;BYDAY`）。
- 发生时刻计算：cron/HOURLY 逐分钟扫描（上限 9×366 天，覆盖闰年极端表达式）；
  按**本地日 + setHours()** 扫描 ±370 天，正确处理 DST 回退小时。
- 校验分两档：新建输入拒绝超大步长，已存/远端表达式宽松解析（避免历史任务被迫重写）。
- 表达式分类展示：hourly/daily/weekdays/weekly/custom/invalid（UI 可读）。
- **调度漂移报告** `schedule-drift-report.ts`：启动时报告长期未触发的自动化。

> 说明：WasmNest 定时任务是"指定时刻一次性触发"（`trigger_at`），无 recurring 需求，本条仅作将来扩展参考。

### 1.3 Run 状态机与终态语义

**位置**：`src/shared/automations/history/automation-run.ts`

- 状态：`pending → dispatching → dispatched → completed | dispatch_failed | skipped_precheck | skipped_missed | skipped_unavailable | skipped_needs_interactive_auth`
- `isFinalAutomationRunStatus()` 判定终态；只有终态行参与保留淘汰。
- **跳过折叠（skip coalescing）**：连续相同拒绝合并为一行，`occurrenceCount`/`lastOccurrenceAt` 递增，避免历史被拒绝记录刷屏。
- **幂等创建**：同一 `automationId + scheduledFor` 已存在则返回原行（崩溃重放安全）。
- **runNumber**：按保留序列递增（历史裁剪后不重号）。

### 1.4 完成监控：观察器模式（核心）

**位置**：`src/main/automations/run-completion-watcher.ts`

```
AutomationRunCompletionWatcher
├── watch(run)     —— dispatched 后挂上观察（Map<runId, AbortController>）
├── forget(runId)  —— 终态即摘除
├── finalize()     —— 观察结果回写（重复终态保护）
└── 启动对账       —— reconcileRetainedRuns：pending 直接 strand，
                      dispatched/dispatching 尝试重新 attach 到存活终端
                      （markTerminalSurfaceReady 给渲染窗口接管留宽限）
```

- 观察句柄解析：chat 用 `automation:<runId>` 伪句柄；terminal 用 paneKey → PTY handle。
- 每个 watch 一个 `AbortController`，`dispose()` 统一 abort。

### 1.5 双通道完成判定：hooks 证据 + 终端屏幕

**位置**：`src/main/automations/runtime-terminal-run-observer.ts`、`automation-run-agent-evidence.ts`

**通道一（权威）**：agent hooks 事件流（`captureRunAgentTurn`）—— 捕获 turn 级证据（思考/工具调用），用 busy→idle 转换判定。

**通道二（兜底/验证）**：终端屏幕 —— `runtime.waitForTerminal(handle, { condition: 'tui-idle' })`。

关键参数与策略（均为经验值）：

| 参数 | 值 | 作用 |
|---|---|---|
| `AGENT_EVIDENCE_POLL_INTERVAL_MS` | 1s | 证据轮询 |
| `AGENT_START_POLL_INTERVAL_MS` | 250ms | agent 启动轮询 |
| `AGENT_START_PROBE_TIMEOUT_MS` | 250ms | 单次 idle 探测（低于宿主 2s 回退） |
| `AGENT_START_DEADLINE_MS` | 2min | 启动确认截止；一直 idle → `agentNeverStarted` |
| `HELD_DONE_SETTLE_MS` | 30s | hooks 的 `done` 需稳定 30s 才判完成（防丢失流/未知 idle 屏误判） |
| `OBSERVE_DEADLINE_MS` | 6h | 观察上限，超时 `watchTimedOut` |

- **无证据时的 busy→idle 转换确认**：先确认不是上一 run 的 idle 残留（`waitForAgentStart`），再等 `tui-idle`。
- **idle 二次确认窗口** `settleIdlePane`：屏幕内容不变期间反复重判，防"过一次 idle 边就误判完成"。
- **退出码** `readProvenTerminalExit`：可证实的进程退出纳入判定（区分完成/崩溃）。
- **完成时落输出快照**：优先取 hooks 的 agent 回复文本，屏幕尾部兜底（上限 2000 行）。

**Chat 通道**（`runtime-chat-run-observer.ts`）：订阅结构化会话 journal，读 turn 记录判定 agent 是否回答了本轮消息；同样 6h deadline；`queuedSendAnswer` 确认提示已被 provider 消费。

### 1.6 持久化与保留

**位置**：`src/main/persistence/scheduling-automations/automation-run-operations.ts`、`src/shared/automations/history/automation-run-retention.ts`

- 所有状态落持久化库（`PersistedState.automationRuns`），每次变更 `flush()`。
- 保留裁剪 `pruneAutomationRuns`（上限淘汰最旧）。
- 终态触发 workspace 元数据剪枝失效（数据一致性联动）。

### 1.7 UI 侧：运行仪表盘 + agent 状态新鲜度调度

**位置**：`src/renderer/src/components/automations/AutomationRunsDashboard.tsx`、`src/renderer/src/store/slices/agent-status/agent-status-freshness-scheduler.ts`

- **运行仪表盘**：状态过滤、按主机分组、24h/7d 成功失败统计、单 run 详情（precheck 输出、输出快照、token 用量、成本）。
- **新鲜度调度器**（通用模式，值得借鉴）：
  - 不做固定轮询，而是计算每个条目的过期时刻（`observedAt + 30min`），**只设一个指向全局最小过期时刻的 timer**；
  - 增量缓存：条目变化时增量更新缓存最小值；持有最小值的条目离开 → 丢弃缓存重扫；
  - 跨过完成截止线时 `bumpEpochs()` 通知订阅者（面板/标题降级显示）。

---

## 2. 对照 WasmNest 现状的缺陷 → 借鉴方案

> WasmNest 现状详见前文《WasmNest agent 状态监控缺陷分析》。本节每条给出：**现状 → Orca 做法 → 借鉴建议 → 落地位置 → 工作量**。

### D1【P0】单一信号源：hook 推送是唯一生命线

- **现状**：任务状态唯一来自 agent hook 脚本 HTTP push；丢一次终态推送队列即停摆（`2026-08-22` 事故）。
- **Orca 做法**：双通道 —— hooks 证据（权威）+ 终端屏幕 idle/输出（兜底），hooks 全灭仍能判定完成。
- **借鉴建议**：在插件内建**终端侧观察器**，基于现有 `host-pty.ring-fetch` 拉取 PTY 输出环：
  1. 每个"在途任务"（executing 队列项 / 运行中任务行）挂一个观察状态机：
     - 轮询环输出（1s 级，配合 `yield_guard` 每 64 次迭代让出）；
     - TUI idle 判定（按各 agent 的 prompt/状态栏特征匹配，如 opencode 的输入框、claude 的 ">" 提示符）；
     - **busy→idle 转换确认**（先排除上一 run 的 idle 残留，对应 Orca `waitForAgentStart`）；
     - idle 稳定窗口（对应 `HELD_DONE_SETTLE_MS` 30s，防刷新抖动）；
  2. hook 推送（`task-status`）仍为高优先级通道，但**终端观察器作为独立验证/兜底**：hook 静默超过阈值（如 2min）即切到屏幕判定，hook 与屏幕冲突时以"更晚的事件"为准；
  3. 观察结果与 hook 推送都走统一的 `finalize` 收敛面（幂等、终态保护）。
- **落地位置**：`apps/bedcode/desktop/rust/src/task/` 新增 `observer.rs`（或并入 `state.rs`）；`scheduled.rs`/`queue.rs` 的收敛调用点统一。
- **工作量**：中（2-3 周）。风险点：各 agent 的 idle 屏特征识别需要逐一调参（Orca 也是逐 agent 打磨的）。

### D2【P0】静默看门狗会话级 + 固定阈值

- **现状**：12h executing 静默、20min retrying 静默，均按**会话聚合**，一个坏会话连累全部任务；阈值不可配置。
- **Orca 做法**：per-run 观察器，每 run 独立 deadline（6h）、独立判定，互不影响。
- **借鉴建议**：
  1. 把"静默判定"从**会话级聚合**改为**任务级**：每行任务维护最后事件时间（已有 `event_time`/`started_at`），静默超限只收敛该行（`interrupt_running_tasks` 目前是会话级收敛面，新增任务级收敛或按行收敛）；
  2. 阈值可配置化：`task_history`/`task_scheduled` 增加 `silence_timeout_secs` 列，默认 12h，用户/自动化可覆盖；
  3. 看门狗与 D1 的终端观察器合并：终端观察器本身有 6h 上限，看门狗退化为"观察器也丢了"的最后兜底。
- **落地位置**：`queue.rs` 的 `check_executing_silence`/`check_retrying_silence`、`state.rs` 收敛面。
- **工作量**：小-中（1-2 周）。

### D3【P0】定时任务与运行结果脱钩（executed ≠ 任务跑完）

- **现状**：`task_scheduled` 置 `executed` 只表示 prompts 已入队；agent 真实结果不回写。
- **Orca 做法**：每 run 独立行 + 独立状态机，终态与自动化定义解耦；run 状态回写自动化展示。
- **借鉴建议**：
  1. 定时任务触发时**先写 run 行**（`task_run` 新表，或扩展 `task_scheduled` 加 `run_id` 列）：`pending`（会话创建中）→ `dispatched`（prompts 入队）→ `completed/failed/interrupted`（由 D1 观察器/hook 推送回填）；
  2. `handle_session_created` 的 `executed` 语义改为 `dispatched`，真实终态由观察器回填；
  3. 移动端预设任务的"完成"判定改为读 run 行终态（现在是广播事件即时匹配，容易错配）。
- **落地位置**：`scheduled.rs` + 新 `task_run` 表 + `state.rs` 收敛面回填。
- **工作量**：中（2 周）。这是定时任务可观测性的最大改进。

### D4【P0】无输出快照，失败后无现场

- **现状**：看门狗中断/推送丢失后只有一句 `exit_reason`。
- **Orca 做法**：每 run 落 `outputSnapshot`（回复文本优先、屏幕尾部兜底，上限 2000 行）。
- **借鉴建议**：WasmNest 的 `ring-fetch` **已经具备能力**，只是没用于任务归档：
  1. 任务进入终态（completed/interrupted）时，从环拉取尾部快照（`ring-fetch` 游标拉到环起点或固定字节数）存入 `task_history.output_snapshot`；
  2. 快照截断标记 `truncated`（环淘汰导致）；
  3. 移动端/历史页展示快照。
- **落地位置**：`state.rs` 终态收敛处（`interrupt_running_tasks`、`handle_update_task_status` terminal 分支、看门狗收敛处）。
- **工作量**：小（1 周）。

### D5【P1】退出码不参与状态收敛

- **现状**：`pty:exit` 事件 payload 携带 `exitCode`，但 `interrupt_running_tasks_on_session_end` 统一写常量原因，退出码只发给 WS 前端——agent 正常退出（0）与崩溃被一视同仁标"中断"。
- **Orca 做法**：`readProvenTerminalExit` 把可证实退出纳入判定。
- **借鉴建议**：
  1. `session::on_pty_exit` 把 `exit_code` 传给任务域：`interrupt_running_tasks_on_session_end(host, session_id, exit_code)`；
  2. 收敛原因区分：`exit_code == Some(0)` 且 hook 从未报终态 → 记 `"agent exited cleanly before reporting completion"`（语义上接近 interrupted 但可区分）；`Some(非0)` → 带退出码的 interrupted；
  3. 配合 D1：退出事件是"会话已死"的最终事实，观察器应立即 abort 并收敛。
- **落地位置**：`session/mod.rs:549`、`task/state.rs:311`。
- **工作量**：小（半天-1 天）。

### D6【P1】状态机依赖 agent 版本特性

- **现状**：防提前终态依赖 Stop 载荷 `background_tasks`（Claude ≥ v2.1.145）；旧版本下"宿主终态保护锁死任务行，真实完成无法再同步"。
- **Orca 做法**：hooks 证据按 turn 判定（`judgeHeldRunTurn`），agent 版本差异被"证据 + 屏幕双验证"吸收；版本不满足时走屏幕兜底而非锁死。
- **借鉴建议**：
  1. 终态保护不再"锁死任务行"：已完成的行允许被**更晚事件**更新（只要 `event_time` 更晚），把"保护"从"拒绝"改为"时序判定"；
  2. 版本能力探测：hook 脚本上报 `agent_version`/能力标志，插件据此选择判定策略（对应 Orca 按 agent 类型选择观察参数）；
  3. 配合 D1 双通道：`background_tasks` 缺失时由终端观察器判定后台任务是否还在跑。
- **落地位置**：`state.rs` 终态保护分支、hook 脚本 payload 扩展。
- **工作量**：中（1-2 周）。

### D7【P1】时序保证依赖 guest 时钟字符串字典序

- **现状**：去重/防回跳/防回声全靠 hook 进程时钟的 `event_time` 字符串比较，guest 时钟可被调整。
- **Orca 做法**：事件顺序由宿主侧 DB 写入顺序决定（写序即权威序），不依赖被观察进程时钟。
- **借鉴建议**：
  1. 宿主 tick 回调已注入 `now_utc`——插件在**应用事件时**用宿主时间打 `applied_at`（宿主时钟可信），比较用 `applied_at` 而非 guest `event_time`；
  2. `event_time` 保留用于展示与脚本侧去重，但**不作为时序权威**；
  3. 可选：宿主提供单调序列原语（如 `tick_seq`），事件按应用序编号。
- **落地位置**：`state.rs` 时序保护分支（`handle_update_task_status`）、`event_time_diff_ms` 启发式（subagent 回声 5s 窗口改用宿主时间差）。
- **工作量**：小（1 周）。

### D8【P2】任务行创建依赖宿主 on_input_submitted，覆盖有洞

- **现状**：不经宿主输入扩展的路径（移动端 HTTP 发送等）无任务行，状态推送被静默跳过。
- **Orca 做法**：run 行由调度服务自己创建（每次派发必建行）。
- **借鉴建议**：
  1. 队列 `task_queue` 出队下发（`dispatch_task`）时**强制建任务行**（插件自己写 `task_history`，不再依赖宿主扩展建行）；
  2. 宿主 `on_input_submitted` 扩展保留为"用户手输"的建行路径，但插件侧下发路径自带建行；
  3. 双路径合并时按 `created_at` 取新行（现有 `find_task_by_claude_sid`/`find_task_by_session` 双路查询逻辑可复用）。
- **落地位置**：`queue.rs` `dispatch_task`、`state.rs` `create_task_from_dispatch`。
- **工作量**：中（1-2 周），注意与宿主扩展的幂等协同。
- **2026-11-13 收口（移动端执行键无任务行）**：`session::input_via_pty` 的特殊键分支对 Enter 补了提交行观察（`is_submit_key` → `line_tracker().feed("\r")` → `handle_submitted_input`）。此前移动端预设执行 / 输入栏执行走 `specialKey=enter` 只写回车字节，内容与 Enter 被拆成两次写入，重建器从未产出提交行，故 `task-status` 推送因无行被静默跳过。队列派发路径已由 `dispatch_task` 直接建行（第 1 条建议已落地），两条入口现都覆盖。

### D9【P2】无 usage 采集、无历史保留

- **现状**：`task_history.input_tokens/output_tokens` 是死列（无写入方）；任务历史无保留策略，只能手动删。
- **Orca 做法**：`writeAutomationRunUsage` 按 provider session 时间窗口归因；`pruneAutomationRuns` 保留上限。
- **借鉴建议**：
  1. 用量采集：hook 脚本从 agent 状态接口（如 Claude Code `/status`、opencode 会话统计）读取 token 上报，或由插件在任务终态时拉取；至少先让已有列活起来；
  2. 保留策略：`task_history`/`task_scheduled` 按保留上限裁剪（如 500 行/自动化，`run_number` 语义对齐 Orca）；
  3. 终态行的快照/用量/错误码一起进入历史页展示。
- **落地位置**：`state.rs` 终态收敛处 + 保留裁剪任务（可挂 tick 域）。
- **工作量**：中（2 周，含各 agent 用量接口差异处理）。

### D10【P2】推送通道无鉴权（明文 HTTP 免凭证）

- **现状**：`task-status` 在免凭证清单内，本机任意进程可伪造终态劫持队列。
- **Orca 做法**：agent hooks 面有身份/认证（`agent-hooks/server` 有 identity 体系）。
- **借鉴建议**：
  1. 宿主在注入 `WASMNEST_SESSION_ID` 的同时注入**每会话一次性 capability token**（env 变量），hook 推送 payload 携带，插件 HTTP 处理前校验（会话级 token 与 session_id 绑定，随会话销毁失效）；
  2. token 校验失败的推送记安全日志并拒绝（可观测的拒绝，而非静默）；
  3. 不改线协议字段名，只加一个可选字段（旧脚本无 token 时按现有行为放行，避免破坏已部署副本——与"宽松解析已存配置"同思路）。
- **落地位置**：`hooks.rs` 注入点、`state.rs` `handle_update_task_status` 入口、宿主 PTY env 注入。
- **工作量**：小（1 周）。

### D11【P3】广播三通道尽力而为、前端无对账手段

- **现状**：bus/emit/WS 失败只留痕，UI 可能长期不更新。
- **Orca 做法**：持久化 run 行是真源 + 前端仪表盘从状态刷新；启动对账（`retained-run-reconciliation`）。
- **借鉴建议**：
  1. 前端任务/历史页增加**定时全量刷新**（读 `task-history/list` 全量 + 客户端按 `updated_at` 合并，替代纯事件驱动）；
  2. 插件启动时对账：`recover_running_tasks_on_restart` 已有雏形，扩展到**未终结队列项 + 定时任务 run 行**的对账（对齐 Orca `reconcileRetainedRuns`）；
  3. 移动端订阅增加"全量 sync"端点。
- **落地位置**：`state.rs` 启动恢复、移动端/前端订阅层。
- **工作量**：中（2 周，含前端）。

### D12【P3】新鲜度调度模式（UI 状态展示）

- **Orca 做法**：agent 状态面板按"每条目过期时刻"设单 timer + 增量缓存 + epoch 广播（`agent-status-freshness-scheduler.ts`）。
- **借鉴建议**：WasmNest 桌面端任务/会话状态面板（如队列视图、任务状态徽标）若出现"状态过期不刷新"问题，可照搬该模式：
  - 每条目 `observedAt + staleAfterMs` 算过期时刻；
  - 全局最小过期时刻设单发 timer；
  - 条目增量变化时增量更新缓存；
  - 跨过期线 `bumpEpoch` 通知订阅组件降级显示。
- **落地位置**：桌面前端（`apps/bedcode/desktop/src/`）状态展示组件。
- **工作量**：小（1 周）。

---

## 3. 架构约束与不可照搬项

### 3.1 约束

1. **业务语义在插件层（ADR 0022）**：`host-pty` 是裸引擎（spawn/write/resize/kill/ring-fetch/is-running），宿主不持有会话对象、不直读插件 PTY 输出环。→ D1 的终端观察器必须**在插件内**基于 `ring-fetch` 实现，不能指望宿主提供 `waitForTerminal(tui-idle)` 之类的原语（除非走 ADR 流程新增原语，成本高）。
2. **wasm guest 单线程 store**：长循环必须周期让出（`yield_guard` 每 64 次迭代）；观察器轮询要配合 tick 域执行，不能起独立长驻线程。
3. **`pty:exit` 不缓冲不重放**：晚订阅期间的退出事件丢失，靠 `is-running` 快照自愈——观察器要在 activate 期订阅（现有 `session::on_pty_exit` 已订阅）。
4. **1s tick 已经是细粒度**：Orca 的 60s tick 更粗；WasmNest 不需要改节拍，但观察器轮询要复用 tick 域（D7 的"应用序"也依赖 tick 注入的 `now_utc`）。
5. **存储差异**：Orca 用持久化 JSON 状态，WasmNest 用插件私有 SQLite——**借鉴状态机与观察模式，不要照搬存储结构**（WasmNest 的 DB 化更优）。

### 3.2 不建议照搬

- Orca 的多主机调度所有权（`schedulerOwner`）——WasmNest 的多设备模型（移动端控制桌面）不同，不要强行对齐；
- Orca 的 cron/RRULE recurring 调度——WasmNest 定时任务定位是"指定时刻一次性触发"，recurring 可另行设计；
- Orca 的 `dispatchGeneration` 机制——WasmNest 插件无"停止调度器"的语义（插件生命周期由宿主管理），价值有限。

---

## 4. 落地路线图建议

| 阶段 | 内容 | 对应缺陷 | 预估 |
|---|---|---|---|
| **P0-1** | 退出码接入任务收敛（D5）——改动最小、收益直接 | D5 | 1 天 |
| **P0-2** | 输出快照归档（D4）——基于 ring-fetch | D4 | 1 周 |
| **P0-3** | 任务级静默看门狗 + 阈值可配（D2） | D2 | 1-2 周 |
| **P0-4** | 插件内终端观察器 + 双通道判定（D1）——核心改造 | D1 | 2-3 周 |
| **P0-5** | 定时任务 run 行 + 结果回填（D3） | D3 | 2 周 |
| **P1** | 时序权威改宿主时间（D7）、终态保护改时序判定（D6） | D6/D7 | 2-3 周 |
| **P2** | 用量采集 + 保留策略（D9）、任务行自建（D8）、推送鉴权（D10） | D8/D9/D10 | 3-4 周 |
| **P3** | 前端全量对账 + 新鲜度调度（D11/D12） | D11/D12 | 2-3 周 |

**优先级原则**：P0 全部围绕"监控权威性"（信号源冗余、粒度、证据留存、结果闭环）；
P1 修正确性风险；P2/P3 是运维与体验增强。

---

## 5. 参考索引

### Orca 关键文件

| 文件 | 内容 |
|---|---|
| `src/main/automations/service.ts` | 调度引擎（tick/lane/generation/先写库再派发） |
| `src/main/automations/dispatch-refusal.ts` | 错过判定、拒绝折叠、不可评估记录 |
| `src/main/automations/run-completion-watcher.ts` | 观察器模式、启动对账、stranded 收敛 |
| `src/main/automations/runtime-terminal-run-observer.ts` | 终端双通道判定（idle/启动确认/held-done/6h） |
| `src/main/automations/automation-run-agent-evidence.ts` | hooks 证据捕获与判定 |
| `src/main/automations/runtime-chat-run-observer.ts` | chat 通道 journal 观察 |
| `src/shared/automations/history/automation-run.ts` | run 状态机与终态 |
| `src/main/persistence/scheduling-automations/automation-run-operations.ts` | run 行幂等创建/更新 |
| `src/shared/automations/history/automation-run-retention.ts` | 保留裁剪 |
| `src/renderer/src/store/slices/agent-status/agent-status-freshness-scheduler.ts` | 新鲜度调度器模式 |
| `src/renderer/src/components/automations/AutomationRunsDashboard.tsx` | 运行仪表盘 |

### WasmNest 现状关键文件

| 文件 | 内容 |
|---|---|
| `apps/bedcode/desktop/rust/src/task/scheduled.rs` | 定时任务状态机（pending/creating/executed/failed/missed） |
| `apps/bedcode/desktop/rust/src/task/state.rs` | task-status 摄入（幂等/时序/终态保护）、收敛面、启动恢复 |
| `apps/bedcode/desktop/rust/src/task/queue.rs` | 队列调度、静默看门狗（12h/20min）、会话轮换 |
| `apps/bedcode/desktop/rust/src/task/mod.rs` | tick 分域（D7 错误隔离）、建表 SQL |
| `apps/bedcode/desktop/scripts/auto_task_hook.py` | Claude Code hook（状态机、推送、重试） |
| `apps/bedcode/desktop/scripts/opencode_task_hook.ts` | opencode 插件 hook |
| `wasmnest-lib/wasmnest-pty-engine/wit/pty.wit` | host-pty 原语（ring-fetch/is-running/pty:exit+exitCode） |

---

*本文档为设计参考，不构成实施承诺；所有借鉴方案需在 WasmNest 架构约束（§3）下评估后落地。*
