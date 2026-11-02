# File Transfer（`com.wasmnest.file-transfer`）

内网文件传输：mDNS 设备发现、首连确认、远程目录浏览、双向传输与断点续传。桌面是服务端（可挂载共享目录），移动浏览 / 下载 / 上传，两端对称可互传。

`apps/file-transfer/{desktop,mobile}` **只有前端**，Rust 全在应用级 `apps/file-transfer/rust/`——双端加载同一份 wasm 产物（ADR 0050）。

| | 桌面（服务端） | 移动（对端） |
| --- | --- | --- |
| 入口 | `src/entry.ts` → `mountApp` + `mountPreview` | `src/index.ts` → `activate` / `deactivate` |
| 插件形态 | `full`（`platform: "both"`） | `full`（`platform: "both"`） |
| 宿主位置 | 侧边栏「文件传输」 | 宿主壳应用（三页签 + 应用内设置页） |
| Rust 来源 | `rust/plugin`（同一 crate） | `rust/plugin`（`wasmnest.sharedRustManifest` 指向它） |
| 产物 | `wasmnest_plugin_file_transfer.wasm` | 同一份 `.wasm` |

## 功能特性

### 桌面

- **设备发现**：在线对端自动发现与切换（前端持 found/lost + TTL + 上限缓存，后端只做 browse 生命周期与快照持久化），首连确认建立信任
- **远程目录浏览**：浏览对端共享目录，多选批量拉取，多任务并发（默认 3，可调）
- **传输队列**：暂停 / 恢复 / 断点续传 / 失败重试 / 取消；失败原因明示（`taskReason.ts` 归一化）
- **共享目录**：本地目录挂载（一次可加多个）供对端访问，`shared_roots` 全量推送宿主闸门
- **接收策略**：逐批批准 / 自动接受 / 自动拒绝 + 批准超时；待批批次与接收中任务分列
- **可信设备**：信任列表与撤销；信任 / consent 决策经 `com.wasmnest.auth-center` 互调
- **历史与通知**：传输历史（终态归档，200 条封顶）、系统通知、打开所在文件夹

### 移动

- **三页签**：传输（默认）/ 浏览 / 设备，左右滑切换；底栏按多选 / 活跃 / 上传三态收敛唯一入口
- **双向传输**：浏览桌面共享目录多选下载；手机文件经共享目录上传
- **队列**：暂停 / 恢复 / 取消 / 重试，队列面板分「全部 / 发送 / 接收 / 历史」
- **接收策略**：与桌面同一套策略真源；批量请求走全局弹窗（跨页面可达）
- **保存到…**：长按文件自选保存位置（系统对话框）；历史记录可打开所在文件夹
- **权限引导**：打开公共 Download 目录需「所有文件访问」，宿主以 `needs_all_files_access` 前缀 reject，应用据此弹引导并跳系统授权页

### 双端同构的边界

同一份 wasm 按 `host-platform.platform()` 在运行期分支：设备缓存、持久化、信任决策、桌面专属能力（旧快照对账 / 目录多选 / reveal-in-dir / 认证中心互调）都走各自的端口实现。移动分支误触桌面专属 import 即 fail-visible（显性 unsupported 桩），不静默降级。

## 使用方式

**桌面**：侧边栏「文件传输」→ 选择在线对端（首次需确认信任）→ 浏览远程文件加入队列；设置面板调下载目录、并发数、接收策略、加密开关。要供对端访问本机时先在设置里添加共享目录。

**移动**：两端连接后，桌面端先开共享目录 → 移动端「浏览」页选文件下载，或「传输」页上传 → 「设备」页切换对端 / 管理可信设备。

## 实现结构

```text
apps/file-transfer/
├─ rust/
│  ├─ core/                     双端共享业务核（零 SDK 依赖，可 native 单测）
│  │  ├─ domain.rs              领域类型（任务 / 批次 / 对端 / 设置）
│  │  ├─ ports.rs               端口 trait：双端差异全部经此处注入
│  │  ├─ transfer.rs            台账归约（事件 → 行）、终态归档、重试 / 闸门判据
│  │  ├─ roots.rs settings.rs   共享根与设置语义
│  │  ├─ sessions.rs identity.rs
│  │  └─ boundary_lock.rs       结构锁
│  └─ plugin/                   双端同构 wasm 产物源（不属于任何一端）
│     ├─ platform.rs            端探测（未知值 = 激活失败）
│     ├─ adapters.rs / adapters_mobile.rs   端口 trait 的双端实现
│     ├─ peer.rs                peer 生命周期、发送闸门、持久化编排
│     ├─ device_bridge.rs       mdns 透传 + 快照
│     ├─ roots_registry.rs      共享根注册表（桌面表 / 移动 storage 键）
│     ├─ settings_store.rs      设置真源 + 推送宿主闸门
│     ├─ auth_center.rs         认证中心互调
│     ├─ transfer_store.rs      台账（实现已迁 core，此文件只转出）
│     └─ lib.rs                 命令面 / 事件面
├─ desktop/src/                 entry / AppRoot / FileTransferView
│                               PeerDevicesPanel / RemoteFileTable / TaskPanel
│                               SettingsPanel / TrustedPeersSection
│                               ConsentDialog / BatchRequestDialog / notifications.ts
│                               composables：usePeerDevices / useRemoteFs / useTasks
│                                            useReceiving / useBatchPrompt / useConsent / useSettings
└─ mobile/src/                  index / FileTransferView / TabBar / BrowseTab / DevicesTab
                                TransfersTab / TaskCard / SummaryBar / SettingsPage
                                composables：同构 + useAllFilesAccess / useBatchDialog
```

**关键约定**（改 Rust 层前必读）：

- crate 内引用端侧文件以**本文件所在目录**（`apps/file-transfer/rust/plugin/src/`）为基准上溯：`include_str!("../../../desktop/plugin.json")`（三级 → `apps/file-transfer/desktop/`）、`#[plugin_api(manifest = "../../../../servers/auth-center/desktop/plugin.json")]`（四级 → `apps/servers/auth-center/`，认证中心互调的真源）。**移动 rust 目录层级时这几处必须同改**，且必须跑一次 wasm 目标构建才算验证（native `cargo test` 不展开 `#[plugin_api]` 宏）。
- 发送并发由插件自控（`PENDING_SENDS` + 设置 `concurrency`），宿主 `send-files` 收窄为「一次调用即发一个会话」。
- 拉取意图先入队再调引擎（不铸无主会话）；排队批派发失败落终态行。

## 命令面

桌面 34 条、移动 33 条命令，除桌面独有的 `reveal-in-dir` 外双端同名。按用途分：

| 用途 | 命令 |
| --- | --- |
| 设备 / 连接 | `refresh-devices`、`get-device-snapshot`、`save-device-snapshot`、`dial-peer`、`disconnect-peer`、`set-active-peer`、`remember-peer-endpoint` |
| 信任 / 同意 | `respond-consent`、`list-trusted`、`revoke-trusted` |
| 浏览 / 收发 | `list-remote`、`pull-files`、`pick-files`、`enqueue`、`list-tasks` |
| 队列控制 | `pause`、`resume`、`resume-all`、`cancel`、`retry`、`remove-task` |
| 接收批次 | `list-batches`、`approve-batch`、`reject-batch`、`list-receiving`、`cancel-receiving` |
| 历史 | `list-history`、`clear-history` |
| 设置 / 共享 | `get-settings`、`set-settings`、`pick-download-dir`、`mount-local`、`update-roots` |
| 系统集成 | `reveal-in-dir`（桌面） |

## 数据与存储

| 数据 | 桌面 | 移动 |
| --- | --- | --- |
| 共享根注册表 | 插件库表 `shared_roots` | storage 键（`ROOTS_KEY`） |
| 传输任务台账 | 插件库表 `transfer_entries`（SQL 事务批） | storage 单键（`ENTRIES_KEY`） |
| 设置（下载目录 / 并发 / 策略 / 超时 / 加密） | 插件 storage + 推送宿主闸门 | 同 |
| 预授权路径 | 插件 storage（`PREAUTH_PATHS_KEY`） | 同 |

- 台账由引擎原始事件归约而来：发送方向吃 `peer:transfer-event`，接收方向吃 `peer:receive-event`；`offer-pending` / `pull-started` 建行，`progress` / `terminal` / `paused` / `resumed` 推进，`node-stopped` 标注中断。
- 终态归档 + **200 条封顶**；重启后未完成任务标 `interrupted`。
- 接收策略默认 `ask`、批准超时 60s、并发 3、加密默认关闭（`useSettings.ts` 默认值）。

## 权限

| 端 | 权限 | 用途 |
| --- | --- | --- |
| 桌面 | `mdns`、`peer`、`network:http` | 发现对端、建立与维持对等连接 |
| 桌面 | `fs:read`、`fs:write`、`fs:pick` | 共享目录、下载目录、文件选择 |
| 桌面 | `storage`、`timer:schedule`、`broadcast` | 设置 / 台账、TTL 与超时、事件 |
| 桌面 | `ui:sidebar`、`ui:dialog`、`ui:statusbar` | 侧边栏入口、确认 / 批次弹窗（`ui:statusbar` 目前仅在清单声明，前端未直接使用） |
| 移动 | `mdns`、`peer`、`network:http`、`transfer`、`fileservice` | 发现、连接、传输引擎与文件服务 |
| 移动 | `fs:read`、`fs:write`、`fs:pick`、`system:open` | 读写落盘、选择、打开所在文件夹 |
| 移动 | `storage`、`broadcast`、`bus` | 台账 / 设置、事件 |
| 移动 | `ui:back`、`ui:route`、`ui:settings`、`ui:dialog` | 返回、路由（设置二级页）、全局弹窗 |

## 开发与构建

> 包管理器一律 pnpm；桌面写产物默认落本仓 `.build/`，写平台宿主 resources 需显式 `--out`。

### 桌面（`apps/file-transfer/desktop/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run dev` | `build.js --watch` |
| `pnpm run dev:host` | 起真实桌面宿主（产物写 `.dev-host/plugins`，宿主 watcher 热重载） |
| `pnpm run build` | vite → cargo（`--manifest-path ../rust/plugin/Cargo.toml`）→ 产物落 `.build/plugins/com.wasmnest.file-transfer/` |
| `pnpm run build:frontend` / `build:rust` | 分段构建 |
| `pnpm run test:run` | vitest 单测 |
| `cargo test --manifest-path ../rust/core/Cargo.toml` | 共享核 native 单测（推荐入口） |
| `cargo test --manifest-path ../rust/plugin/Cargo.toml` | 插件层 native 单测 |

### 移动（`apps/file-transfer/mobile/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run dev` | SDK dev-shell（`devMock` 播一个已连接的活跃对端） |
| `pnpm run build` | 直接调平台仓移动包装脚本 `wasmnest-mobile/scripts/plugin-build.js`（需 R1 同场布局） |

> 本端**没有 `test:run`，也没有 `vitest.config.ts`**（仓级 `pnpm run test:run` 会打印 skip，不静默略过）。移动逻辑验证走真机 lane（见下）。

### 端到端（应用仓根）

```bash
node scripts/e2e.mjs --app file-transfer        # 桌面单端
node scripts/e2e-mobile.mjs --app file-transfer # 真机单端：真宿主 + 真 wasm + 真壳路由
```

移动 lane 的断言有牙：devMock 播的是「已连接对端」，真宿主忽略 devMock，因此真机上必然 `data-online="false"` 且上传入口 `disabled`——这两条成立即证明跑的是真宿主而不是 mock 壳。

## 测试

- **桌面单测**（7 个文件）：发现载荷解析与 devMock 种子契约、设备快照守卫、任务面板、失败原因归一化、对端取消提示、预览面、SDK 组件化冒烟。
- **共享核单测**（`rust/core`，native）：台账事件归约、终态归档与封顶、重试回放判据、设置语义、共享根注册、会话与身份。核内用例是**两端并集**，同一份判据不设两个测试真源。
- **插件层单测**（`rust/plugin`，native）：端口适配、根注册表、设置推送、平台分支；注意 native 测试不展开 `#[plugin_api]` 宏。
- **E2E**：`e2e/specs/file-transfer.spec.ts`（桌面）、`e2e/mobile/file-transfer-shell.spec.ts`（真机单端）。

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 看不到对端 | 两端不在同一网段 / mDNS 被防火墙拦。设备缓存有 TTL，稍等或手动刷新 |
| 看得到对端但目录是空的 | 对端没开共享目录（桌面端在设置里添加），或对端目录权限不足 |
| 移动端点「打开所在文件夹」被拒 | 缺「所有文件访问」（`needs_all_files_access`）。按引导跳系统授权页，授权后重试原操作 |
| 上传入口是灰的 | 移动端没有活跃对端（真宿主不消费 devMock，属预期）；先在设备页连接桌面 |
| 传输中断后显示 interrupted | 重启时未完成任务统一标注；对有回放凭证的任务点重试即可续传 |
| 构建找不到 wasm 产物 | 移动端经 `sharedRustManifest` 指向 `../rust/plugin/Cargo.toml`；确认 `rust/plugin` 目录层级未被移动（两处相对路径要同改） |

## 相关文档

- 应用仓裁决与硬约束：`AGENTS.md`；结构与单产物说明：`docs/CODE-MAP.md` §3
- 双端前端形态：`docs/FRONTEND.md`；后端规范：`docs/BACKEND.md`；E2E：`docs/E2E.md` §10 / §11
- 认证中心（信任 / consent 真源）：`servers/auth-center/`
