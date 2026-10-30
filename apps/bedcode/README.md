# BedCode（`com.wasmnest.bedcode`）

终端会话中心：设备配对与信任、会话配置与生命周期编排、终端流、Agent 管理与任务队列的**单一权威**。桌面是服务端（会话宿主 / 工作台），移动是远程终端控制端——同名但职责不同，契约各自独立。

| | 桌面（服务端） | 移动（控制端） |
| --- | --- | --- |
| 入口 | `src/entry.ts` → `mountApp` + `mountPreview` | `src/index.ts` → `activate` / `deactivate` |
| 插件形态 | `rust-ts`，`backgroundTransport: true` | `wasm` |
| 宿主位置 | 侧边栏全屏工作台（五项菜单） | 宿主壳应用（四页签） |
| 后端产物 | `bedcode_plugin_terminal_session.wasm`（`wasm32-wasip3`） | 同名 `rustLibrary`，移动组件化 |
| 权威面 | 会话 / 任务 / 配对 / Agent 的真源 | 终端消费者；任务数据是桌面任务域的**只读投影** |

## 功能特性

### 桌面（服务端 / 工作台）

侧边栏六项：**设备配对 100 / 项目 190 / 终端会话 200 / Agent 管理 205 / Agent 任务 210 / 设置 9999**（排序槽位锁在 `useSidebarMenu.ts`）。项目与终端会话**并存**（用户 2026-10-29 裁定：新增项目入口，不替换旧入口；退役时机待 M3 对话面成形后评估）。另有三个不进菜单的页面：连接历史（设备列表「历史」按钮深链 `/history`）、独立终端窗口（`/terminal-window/:id`，`bareWindow` 不套外壳）、服务器诊断页（`/server`，URL 直达）。

- **设备配对**：6 位数字配对码（默认 TTL 60s，可配）与 QR token 的生命周期（生成 / 状态 / 校验 / 清除）、首连确认、可信设备视图与撤销、设备在线态与会话数合并视图
- **连接历史**：连接建立 / 关闭记录，随会话事件驱动落库
- **会话中心**：会话配置（`session_configs`）+ 创建编排 + 动作（重启 / 改名 / 移除 / 尺寸裁决）；PTY 配额 `ptyQuota: 8`；终端用 xterm，支持独立窗口
- **Agent 管理**（原 agent-hub 并入）：Node.js 环境引导与移除、CLI 探测 / 安装 / 更新 / 卸载、供应商预设导入与下发 CLI、用量统计（会话级扫描 + 趋势 / 分布 / 热力）、Skill 扫描 / 导入 / 编辑 / 分发、安装卡片「启动会话」直达会话配置
- **Agent 集成注入**：会话创建时按 agent 类型写项目 hooks —— claude（`.claude/settings.json` + `auto_task_hook.py`）、pi（`.pi/extensions/`）、opencode（`.opencode/plugins/`）、codex（`.codex/hooks.json`）；模板版本变化触发重写，会话结束可清理
- **Agent 任务**：任务队列（终端工具栏弹窗）、预设任务（一次性消耗）、定时任务、任务历史与统计、自动执行 / 自动授权开关
- **设置**：业务四分组（外观色板 / 配对 / 链路加密 / 会话），平台分组（外观深浅色 / 系统 / 日志 / 授权 / 关于）留在宿主 `/sys/settings`

### 移动（远程终端控制端）

底部四页签：**连接 0 / 会话 100 / 任务 200 / 设置 300**。

- **终端流**：订阅桌面会话输出并回送输入，断线自动重连并补齐环窗口；渲染背压 ack（`ack-rendered`），输出风暴期自动驻留防卡顿
- **输入**：可打印文本 + 特殊键（Ctrl+C / 方向键 / 功能键）直达桌面 PTY；含输入助手与输入法状态机
- **配对**：扫码（QR token）/ 手输地址 + 配对码；生物识别解锁；两种认证入口都落到同一 `auth` 面
- **任务面板**：预设任务 / 定时任务 / 任务记录（后两者只读桌面投影，ADR 0012「手机看、桌面管」）
- **文件浏览器域**：终端侧栏与任务面共用的 FileExplorer / FileSidebar / 查看弹窗 / 代码查看设置（issue #24 自移动宿主迁入）

### 双端职责边界

移动端**不是**会话 / 终端 / 任务权威，只是消费者：它的任务页数据来自桌面任务域投影，UI 文案不得自称权威（spec D6 强制口径）。桌面的认证角色已外迁：`com.wasmnest.auth-center` 是本机唯一认证中心，BedCode 不再注册（issue #6），设备中心 / consent / 连接记录经 `auth_center_client` 互调消费。

## 使用方式

**桌面**：首次进「设备配对」生成配对码或 QR → 移动端扫码 / 填码完成配对 → 到「终端会话」新建会话（选工作目录与 agent）→ 会话工具栏打开任务队列；「Agent 管理」先看环境是否就绪，再装 CLI、导入供应商预设。

**移动**：连接页填桌面地址（或扫码）→ 进入会话列表 → 点会话即订阅终端；离开页面自动断开（不在后台常拉）；任务页先选目标会话再建任务入队。

## 实现结构

```text
apps/bedcode/
├─ desktop/
│  ├─ src/entry.ts              挂载 + 预览契约；建 Vue/pinia/router/i18n 全量依赖
│  ├─ src/router/               内存路由（自身导航不进宿主 URL；未匹配显性 not-found）
│  ├─ src/components/           DeviceCenterView / SessionCenterView / TaskHistoryView
│  │                            ConnectionHistoryView / Sidebar / TaskQueueModal / terminal/
│  ├─ src/views/                SettingsView / ServerView / terminal/TerminalWindowView
│  │                            projects/{ProjectListView,ProjectWorkbenchView}（项目壳，M2）
│  ├─ src/agents/               Agent 管理域：AgentHubView + Install/Providers/Skills/Stats 页签
│  ├─ src/composables/          useServer / useSessionCenter / useProjects / useDeviceCenter
│  │                            useSidebarMenu / useLinkCrypto / useSessionWindows / useToast …
│  ├─ src/utils/terminal/       渲染策略 / 尺寸裁决 / 写入管线 / 滚动缓冲
│  ├─ scripts/{auto_task,codex_task}_hook.py、{opencode,pi}_task_hook.ts
│  │                            注入项目 hooks 的脚本模板（随插件资源分发）
│  └─ rust/src/                 按域组织（见下表）
└─ mobile/
   ├─ src/index.ts              激活顺序：host → terminal → fileExplorer → task → app
   ├─ src/app/                  壳域：底部导航 + 页签状态机 + 沉浸运行面
   ├─ src/host/                 设备 / 会话 / 连接态
   ├─ src/terminal/             终端消费 UI（缓冲 store / 输入助手 / 样式）
   ├─ src/task/                 任务面板与只读投影
   ├─ src/fileExplorer/         文件浏览器域
   └─ rust/src/                 auth.rs（配对与认证）/ commands.rs / keys.rs
```

桌面后端按域分包（`rust/src/`）：

| 域 | 目录 | 职责 |
| --- | --- | --- |
| 配对 / 信任 / 同意 | `pairing/` `trust/` `consent/` `policy/` | 配对码与 QR、可信设备、首连确认、策略导出 |
| 认证记录 | `auth_records/` | 设备与连接历史的本地副本（`auth_*` 表）；真源已迁 `com.wasmnest.auth-center`，副本待删 |
| 项目 | `project/` | 一级容器（目录 + 执行环境）、容器迁移（`sessions` → `runs`、配置 → 项目）、`project.*` 命令面（含 `project.pick-dir` 目录选择） |
| 运行 | `run/` `session/` `config/` `launch.rs` `actions.rs` | `run.start`（项目 + agent → 取/建启动参数 → 走唯一启动链）、运行登记（表 `runs`）、配置真源、创建编排、动作与尺寸裁决 |
| 终端传输 | `ws_terminal.rs` `ws_control.rs` `ws_events.rs` `sessions_http.rs` | 两个 WS 端点（`terminal` / `session-control`，均 JWT）+ HTTP 面 |
| 任务 | `task/{agent,hooks,queue,preset,scheduled,state,config_queue}.rs` | Agent registry、hooks 注入、队列调度、预设与定时 |
| Agent 管理 | `hub/` | CLI 探测、用量解析（SQLite 只读扫描）、供应商预设 |
| 设备视图 | `devices.rs` `devices_events.rs` `device_face.rs` | 在线判定、会话数合并、配对页命令面 |
| 迁移 | `schema.rs`（表名前缀统一 + 可回退账本）、`project/migrate.rs`（容器迁移） | 建表顺序纪律的执行面：前缀统一 → 容器迁移 → 各域 `ensure_schema` |

## 命令面与互调面

| 面 | 规模 | 说明 |
| --- | --- | --- |
| 命令（`contributes.commands`） | 83 | `project.*`（项目容器）+ `run.*`（`run.list` / `run.start`）+ `session.*`（运行 / 任务域，冻结为兼容投影）+ `agent.*`（Agent 管理域） |
| 互调 api（`plugin.json.api`） | 34 | 配对码 / QR / 信任 / consent / 配置 / 设备 / 连接记录 / 会话；供对侧与认证中心消费 |
| WS 端点 | 2 | `terminal`（终端流）、`session-control`（控制面），均 `auth: jwt` |
| 广播事件（`provides`） | 5 | `task:status-changed` / `session:mode-changed` / `task:queue-changed` / `task:scheduled-changed` / `task:preset-changed` |
| 依赖能力 | `host-pty` | 终端 PTY 由宿主提供，`ptyQuota: 8` |

## 数据与存储

桌面业务状态全部自持于**插件私有库**（`host-plugin-database`），宿主只给无业务语义的原语。表按域分组：

- 项目域：`projects`（唯一键 `(environment, working_dir)`）
- 运行域：`session_configs`（降级为「项目 × agent 的启动参数」）、`runs`（由 `sessions` 账本式重命名 + 补容器列）、`session_annotations`、`run_events`（归一事件账本，写入方随桥接落地）、`permission_audit`（权限代传审计）
- 任务域：`task_queue`、`task_config_queues`、`task_history`、`task_preset`、`task_scheduled`、`task_session_mapping`、`task_session_settings`
- Agent 管理域：`provider_preset`、`usage_session`、`parse_watermark`、`quick_actions`
- 认证记录：`auth_pairings`、`auth_biometric_keys`、`auth_connection_history`（`com.wasmnest.auth-center` 为真源，本地副本待后续票删除）
- 跨域：`plugin_meta`（迁移账本，键如 `schema.rename_ledger`）

`task_*` / `session_*` 前缀是一次幂等重命名迁移的结果：**必须在各域 `ensure_schema` 之前执行**（先建新名会让旧数据永久留在无人读的名字下，现象是「升级后列表变空」）；实际发生的重命名记在账本里，可逆向回滚。

移动端不落会话 / 任务台账（数据面是桌面域的只读投影），只有配对凭证、密钥与 UI 偏好等少量状态在插件 storage。

## 权限

**桌面**（按用途归组）：

| 用途 | 权限 |
| --- | --- |
| 终端与会话 | `pty:spawn`、`pty:io`、`terminal:input`、`session:read`、`process:run`、`task:run`、`timer:schedule` |
| 设备与认证 | `auth`、`peer`、`connection:read`、`ws:server` |
| 项目 hooks 与文件 | `fs:read`、`fs:write`、`fs:pick`、`app:path` |
| 存储与网络 | `storage`、`network:http` |
| UI 与事件 | `ui:sidebar`、`ui:settings`、`ui:input`、`broadcast` |

**移动**：`auth`、`bus`、`network:http`、`session:read`、`storage`、`terminal:output`、`ui:back`、`ui:route`、`ws:client`。

## 开发与构建

### 桌面（`apps/bedcode/desktop/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run build` | 全量构建，产物落 `.build/plugins/com.wasmnest.bedcode/` |
| `pnpm run build:frontend` / `build:rust` | 分段构建（`build:rust` = `build.js --rust-only`） |
| `pnpm run dev:host` | 起真实桌面宿主（预构建 + 启动，**前端不参与 watch**） |
| `pnpm run test:run` | vitest 单测 |
| `pnpm run test:rust` | 后端 native 单测 |

> 本端**没有 `dev` 脚本**：前端最重，dev 期不参与 watch；改前端后需重跑 `build` / `dev:host`。

### 移动（`apps/bedcode/mobile/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run dev` | SDK dev-shell（HMR；命令走前端 mock，不跑 WASM） |
| `pnpm run build` / `package` | `wasmnest-plugin build` / 打包 |
| `pnpm run test:run` | vitest 单测 |

### 端到端（应用仓根）

```bash
node scripts/e2e.mjs --app bedcode        # 桌面单端：侧边栏 / 会话 / 任务 / 设置
node scripts/e2e-dual.mjs --app bedcode   # 双端：真桌面宿主 ↔ USB 真机配对闭环
```

双端 lane 需要 debug APK + `adb reverse`；判据纪律见 `docs/E2E.md` §10。

## 测试

- **桌面单测**（55 个文件）：终端渲染管线（尺寸裁决 / 尺寸防抖 / 写入批处理 / 滚动缓冲 / 拉取策略 / IME 状态机）、会话中心、设备中心、连接历史、任务视图与队列、Agent 域、i18n 前缀纪律、插件契约、预览面。
- **移动单测**（46 个文件）：壳域页签状态机、终端域、任务域、文件浏览器域、设置、返回键与滑动仲裁。
- **后端单测**：`pnpm run test:rust`；跨端契约断言写在 `rust/src/d10_contract_test.rs`（`#[cfg(test)]` 模块，不是 `tests/` 集成目标——crate 只声明 `cdylib`，见 Cargo.toml 注释）。
- **E2E**：`e2e/specs/bedcode.spec.ts`（桌面单端）+ `e2e/dual/bedcode-pairing.spec.ts`（配对闭环，断言状态位而非文案）。

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 移动端配对被拒，日志有 `deny_kind` | `no_center` = 本机未注册认证中心（看 auth-center 注册失败日志）；`unavailable` = 中心实例不可调（trap / 超时）；`policy` = 验签或策略拒绝（撤销 / 过期 / 结构非法） |
| 升级后移动端需重新配对 | 认证中心切换后认证记录库是新库，旧配对记录不迁移（D5）：旧 token 由旧密钥签发，不再被接受 |
| hooks 在外部终端不生效 | hook 只在 `WASMNEST_SESSION_ID` 存在时激活——即只在 WasmNest 启动的 PTY 里生效；codex 的非托管 hooks 还需用户在 `/hooks` 里信任 |
| 升级后任务 / 会话列表变空 | 表名迁移顺序被破坏（重命名跑在 `ensure_schema` 之后）。查 `plugin_meta` 的 `schema.rename_ledger` |
| 升级后项目里一条运行都没有 | 容器迁移顺序被破坏（`project::migrate_via_host` 跑在 `session::ensure_schema_via_host` 之后，`runs` 先以空表占位导致 `sessions` 没被重命名）。查加载日志的 `project container migration` 与 `plugin_meta` 的 `project.migration_log` |
| 升级后少了一批历史运行 | 无主运行（配置已删 / 配置目录为空）按迁移口径丢弃，`project.migration_log` 的 `runsDropped` 逐个点名 |
| 会话开不出来 | 检查 PTY 配额（`ptyQuota: 8`）与宿主 `host-pty` 是否可用 |

## 维护注记

- **项目壳已落地（issue #23 M2）**：侧边栏「项目」+ `/projects` 列表 + `/projects/:id` 工作台（左运行列表 / 中对话面 / 右检查器 变更·终端·事件）。终端页签复用 `TerminalPreview`（同一条 PTY 的真实字节），对话面与「变更 / 事件」页签是 M3（桥接 + 事件账本）的显性占位。旧「终端会话」页与项目入口**并存**（用户 2026-10-29 裁定），退役时机待 M3 对话面覆盖旧页全部动作后评估——在此之前**不要**在旧会话页上加项目字段（两套入口会互相打架）。
- 「新建运行」不新建会话配置：`run.start` 按 `(项目执行环境, 项目目录, agent 二进制)` 取或建一条 `session_configs`（配置已降级为「项目 × agent 的启动参数」），再走唯一启动链 `launch::create_via_host`。agent → 二进制由后端注册表给出（`hub::binary_for`），前端不维护第二份映射。
- `runs` 行不再随宿主重启清空：启动对账只把非终态运行收敛成 `Error` 并清空 `pty_id`，历史保留。因此「设备卡的 `sessionCount`」「移动端会话列表」现在都是**跨进程累计**的；改成只计活跃运行需要产品裁定（当前沿用既有「含 Stopped 历史」口径）。
- `plugin.json` 的 `description` 已随 M2 改为「设备配对 / 项目 / 终端会话 / Agent 管理 / Agent 任务」的实际入口清单（不再写死「四目录」）。改 `description` 属跨仓可见变更，按 `AGENTS.md` §3 与平台仓 `release-manifest.json` 一起核对。
- 桌面认证角色已迁出，本地 `auth_http` 只剩旧互调 api 仍引用的状态机副本，待「删除 bedcode 侧六域副本」后续票整体移除——新增认证逻辑不要再落在这里。

## 相关文档

- 应用仓裁决与硬约束：`AGENTS.md`；结构导航：`docs/CODE-MAP.md`
- 双端前端形态：`docs/FRONTEND.md`；后端规范：`docs/BACKEND.md`；E2E：`docs/E2E.md`
- 认证中心：`servers/auth-center/`（`docs/CODE-MAP.md` §3 的 auth-center 现状说明）
