//! trust 模块（自 bedcode 会话中心搬回认证中心 · issue #6 六域之「信任」）—— 设备信任列表统一视图
//!
//! 语义：把「认证记录库里的已配对设备 + 宿主 peer trust_store 里的可信对端」两套事实
//! 映射为单一统一视图，列表 / 撤销行为与搬迁前**逐条等价**（对照用例随域搬入）。
//!
//! ## 统一视图 = pairing（认证记录库） + peer（可信对端）
//!
//! | 宿主概念 | 语义基准 | 插件映射 |
//! | --- | --- | --- |
//! | 已配对设备 | 私有库 `auth_pairings` 表（全量原始记录、撤销 = 软删 `is_active=0`） | [`source`] 端口读原始记录，[`ops`] 过滤排序 |
//! | 可信对端 | 宿主 peer trust_store（`list-trusted` → `TrustedPeerDto`；`revoke-trusted` → bool） | 经 host-peer 原语原样映射 |
//!
//! 行为等价约束（对照测试锚点，逐条对应搬迁前实现）：
//! - **列表**：pairing 段只含活跃记录，按 `paired_at` DESC；peer 段透传宿主
//!   `list-trusted` 的条目序。两段合并为统一数组，每条带 `kind` 判别
//!   （`pairing` | `peer`），pairing 在前。
//! - **撤销**：pairing 走私有库软删（软删 + 删连接历史），撤销后立即从列表消失；
//!   未命中 id 幂等 `removed=false` 不报错。peer 走 host-peer `revoke-trusted`。
//!   **三态裁决**（T-G01）：id 命中「已非活跃」pairing 时不落 peer 路径——否则陈旧
//!   pairing id 撞上某个 peer node id 会误撤销无关 peer。
//! - **持久化**：真源是认证记录库（重启一致），插件不持账本——两套账本的口径漂移
//!   是搬迁前就修掉的旧病，不得复发。
//!
//! ## 降级（peer 侧不可用时）
//!
//! 无头 / peer-net 未启动时 host-peer `list-trusted` 报错（宿主原语显性失败），
//! 本模块不静默吞掉：`list` 仍返回 pairing 段 + `peerError` 字段透出错误；
//! `revoke` 对 peer 目标直接上抛错误（不做「看似成功」的假撤销）。
//!
//! ## 接线现状
//!
//! - wasm 侧 [`source::TrustRecords`] 适配器已指向认证记录库（[`crate::auth_records`]），
//!   真源 = 插件私有库；native 单测仍注入内存 mock 跑同一套编排语义。
//! - 命令面 `auth-center.trust.list` / `.revoke` 与互调 api `trust-list` / `trust-revoke`
//!   共用同一实现体（`ops::list_via_host` / `revoke_via_host`）。
//!
//! 这样切分的收益：`list` / `revoke` 的全部行为分支都能在 native 下用 mock 钉住，
//! 记录库那一层只承担「读 / 软删」两条原语。

pub mod model;
pub mod ops;
pub mod source;

// 入口是 `ops::list_via_host` / `ops::revoke_via_host`（wasm）/ `ops::{list, revoke}`
// （native + mock）。**不做 `pub use` 转发**：命令面接线后由 lib.rs 直接写全路径，
// 少一层别名就少一处「改名绕过」的面（与搬入前的口径一致）。
