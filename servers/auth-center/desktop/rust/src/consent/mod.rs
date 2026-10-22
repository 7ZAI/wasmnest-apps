//! consent 模块（自 bedcode 会话中心搬回认证中心 · issue #6 六域之「首连确认」）— peer 首连确认决策
//!
//! 收敛 peer-net 首连确认语义（宿主 `peer:consent` 事件桥 + `respond_peer_consent`
//! 命令）的决策层：给定 peer 信息与当前信任状态，判定「放行 / 拒绝 / 需确认」。
//!
//! ## 两阶段消费流
//!
//! 1. 消费方收到 `peer:consent` 事件 → 调本域（无用户意向）：已信任 → accept
//!    （免确认，不弹窗）；未知 → ask（弹窗）
//! 2. 用户在弹窗做出选择 → 回传 `userDecision`（accept / deny / one_time）
//!    再调 → 最终 accept / deny（one_time = 本请求放行、不改变信任状态）
//!
//! 决策优先级：**已信任免确认 > 用户显式意向 > ask**。信任状态不可验证时
//! fail-closed 按未知处理（要求确认而非假设放行/阻断），见 [`ops`] 模块文档。
//!
//! ## 对外面
//!
//! - 命令面 `auth-center.consent.decide`（与 bedcode `session.consent.decide` 同形，
//!   供宿主闭环测试 / 调试直调与本 app 页面使用）。
//! - 互调 api `com.wasmnest.auth-center.consent-decide` 已声明——消费方是 file-transfer
//!   （搬迁前的契约是 `com.wasmnest.terminal-session.consent-decide`）。
//!   **声明 ≠ 已切换**：消费方仍按旧名调 bedcode，改指必须与注册切换同一次发布，
//!   否则中间任一时刻都会出现「调用方按旧名、提供方按新名」的静默断链。
//!
//! 行为等价约束（对照锚点）：判定基准 = 宿主 peer trust_store（`peer-list-trusted`
//! node_id 集合）——与宿主 peer-net 的 consent 闸门（只拦未信任首连）同源。
//! 数据来源随搬迁保持 host-peer 原语不变（本域不涉及记录库）。

pub mod model;
pub mod ops;
