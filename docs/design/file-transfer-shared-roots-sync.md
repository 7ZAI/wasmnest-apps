# 共享目录可见性同步（file-transfer）

> 状态：已实现（2026-11-17）。范围：`apps/file-transfer` 双端前端 + rust 插件/核。

## 1. 问题

双端首次完成连接后，可能有一端在「浏览」页看不到对方的共享目录；必须重启应用、或在设置里改动一次共享目录，才会恢复可见。

## 2. 根因

共享根清单是**纯拉模式**：暴露侧只应答 `RootsRequest`（`wasmnest-lib/wasmnest-server-peer-net/src/base/shared.rs` 的首帧分流与 `serve_roots`），连接建立（`peer-connected`）不携带也不公告根清单。可见性因此完全取决于「读取方是否发起了拉取、那一次是否成功」。代码里有两条独立断链。

### 2.1 读侧：只在连接那一刻拉一次，失败无重试

- 触发点只有一处：活跃对端就绪时 `useRemoteFs.loadRoots()`（移动 `FileTransferView.vue` 的 `readyPeerId` watch；桌面同文件只 watch `peer.value.id`，连 `online` 都不看）。
- 拉取需要三个前置条件同时成立：
  1. 插件侧 `ACTIVE_NODE` 已落值（`list-remote` 的默认寻址）；
  2. 有 session 句柄，或有一份 endpoint memo 供重拨——**入站（被连）侧没有句柄**（句柄只在 `dial_peer` / `ensure_target` 里登记）；
  3. 前端已把地址写进 memo（`remember-peer-endpoint`），而它要求该设备**已在发现缓存里**。
- 被连侧常常「先收到连接、后收到 mDNS 发现」：连接事件里设备不在缓存 → 没有 memo，也没有设备行，活跃对端兜底选不出对象；等发现到达时 memo 仍不会被补写，而拉取又已经失败过且不会重来。
- 失败结果被 `useRemoteFs` 固化为「目录不可用 + 空列表」，没有任何 watch 在条件补齐后再拉一次。

### 2.2 写侧：引擎镜像只在「改共享目录」时写

- 插件仅在 `mount-local` / `update-roots` 里调 `roots_registry::apply_and_push`（`rust/plugin/src/peer.rs`），`activate()` 只 `ensure_table`，**不推送**。
- 宿主侧镜像 `shared_dirs.json` 只由 `set-shared-roots` 全量替换（`wasmnest-server-peer-net/src/lib.rs::set_shared_roots`）。
- 于是镜像与插件注册表一旦分叉（宿主落盘失败被回滚、数据目录变化、旧版本迁移），没有任何自愈路径；「改一次共享目录」恰好是唯一会重写镜像的动作，所以看起来像被它修好了。

## 3. 目标（不变量）

1. 插件激活完成、以及任意对端连入后，引擎镜像必然等于插件注册表。
2. 读侧只在条件齐备（活跃对端 + 已连接 + 有可用地址）时发起拉取；任一条件变化都要再拉一次。
3. 入站侧不因「发现晚于连接」永久失去数据面寻址；发现到达后必须补写 memo 并允许重新拉取。
4. 失败只记日志、不改写成成功语义（fail-visible）。

## 4. 方案

### 4.1 写侧自愈（M1）

- 新增 `core::roots::push_snapshot(&ports)`：读存储 → 全量推 `peer_set_shared_roots`，**不改存储**，返回快照。
- 新增 `plugin::roots_registry::sync_engine(&host)`：按平台选端口，转调 `push_snapshot`（桌面 `path` / 移动 `safTreeUri` 两种 wire 形状）。
- 调用点：
  - `activate()`：`ensure_table` 之后（此时节点已请求启动），成功记 info（条数），失败 `log_error`，**不阻断激活**；
  - `dispatch_bus_message` 的 `peer:connection` 且 `connected == true`：对端连入即重推一次，失败 `log_error`。
- 幂等性由宿主保证：`set_shared_roots` → `replace_all` 全量替换 + 原子落盘，并重挂平台默认目录。
- 已知边界：桌面 Fs 根在推送时刻不可访问（外置盘未插）会让 `replace_all` 整批拒绝；此时保留旧镜像并留日志，不部分生效。

### 4.2 读侧重拉（M2）

- 双端 `useRemoteFs` 新增导出 `rootsReadyKey({ peerId, online, connectionModes })`：三者齐备返回 `peerId`，否则返回空串（= 不该拉，避免注定失败的请求）。
- `FileTransferView` 的 watch 键从「id」换成该就绪键（桌面同时补上 `online`，修复「重连时 id 不变 → 不重拉」）。
- `list-remote` 显式带 `peerId`（后端 `resolve_node` 已支持显式参数优先），消掉 `set-active-peer` 与建立连接的到达时序依赖；根清单与根内目录列表都带。

### 4.3 入站寻址（M3）

- `usePeerDevices`（双端各一份）新增 `ensureConnectedEntry(nodeId, deviceName)`：连接事件里设备不在缓存时，先落一条只有身份的条目（**不落盘**，地址未知，重启后由实时发现重建），使设备行与活跃对端兜底有对象。
- `handleFound` 在 `upsertDevice` 之后补写 `remember-endpoint`（地址此时才存在），再把活跃对端兜底放到 memo 之后，保证「兜底触发的拉取」不会跑在 memo 前面。

## 5. 契约与兼容

- `file-transfer.list-remote` 新增**可选**入参 `peerId`；不传仍走 `ACTIVE_NODE`（旧调用方零改动）。
- `set-shared-roots` 调用频次上升（激活一次 + 每次连入一次）；宿主语义是全量幂等替换，不新增 WIT / 协议字段。
- 前端只改内部状态与命令参数，界面与既有的 `data-testid` 锚点不变；不做轮询、不做服务端推送。

## 6. 测试

| 层 | 用例 | 位置 |
| --- | --- | --- |
| core | 重推不过存储、两次调用载荷一致、引擎拒绝如实上抛 | `rust/core/src/roots.rs` |
| plugin | `sync_engine` 双端 wire 形状（`path` / `safTreeUri`），且不改持久层 | `rust/plugin/src/roots_registry.rs` |
| mobile | 就绪键四类组合；`list-remote` 带/不带 `peerId`；连接先于发现时补行、发现后补 memo、已发现时不重复补行 | `mobile/src/composables/__tests__/rootsSync.test.ts` |
| desktop | 同判据（`rootsSync.test.ts`） | `desktop/src/__tests__/rootsSync.test.ts` |

验证记录：`cargo test --lib` core 105 / plugin 134 全绿；`cargo clippy --lib -- -D warnings` 双 crate 干净；移动端 vitest 13 文件 / 105 用例、桌面 vitest 18 文件 / 133 用例全绿。

## 7. 验收（真机）

1. A 主动连接 B，双方都不重启、不改共享目录：两端的「浏览」页都能看到对方的根清单。
2. 日志对账：暴露侧 `shared roots served to peer` 的 `count` 与浏览侧 `peer shared roots listed` 的 `count` 一致且 ≥1。
3. 断开后重连（nodeId 不变）：浏览页自动刷新，不需要手动点刷新。
4. 若仍复现：先看暴露侧 `count` —— 为 0 是写侧（M1 未生效或推送被拒），不为 0 则是读侧（M2/M3），据此收敛。

## 8. 非目标

- 不改 WIT / 宿主协议，不做「根清单变更公告」类推送。
- 不改共享目录存储真源（插件库 / KV 仍是唯一真源）。
- 不引入轮询或定时重试；显式刷新入口保持原样。
