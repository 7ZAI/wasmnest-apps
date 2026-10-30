//! 会话登记域 wire / 存储模型（会话引擎整体下沉 P1）
//!
//! **wire 形状对齐红线**：`SessionStatus` 与宿主 `enums::session::SessionStatus`
//! 的 serde 形状逐字相同（externally tagged：`"starting"` / `"running"` /
//! `"stopped"` / `{"error":"…"}`）——P1 后续阶段本域要经互调 api 向宿主与移动端
//! 供会话事实，形状漂移即线协议静默错位。形状锁定用例见本文件 `tests`。
//!
//! 存储映射（snake_case 列 ↔ camelCase 字段）只存在于 [`super::store`] 的 wasm
//! 实现里；本文件是纯数据类型，native 单测可全覆盖。

use serde::{Deserialize, Serialize};

/// 会话状态（宿主 `SessionStatus` 的 wire 镜像）
///
/// 本域当前**只生产** `Starting` / `Running` / `Stopping` / `Stopped` / `Error`
/// 五态（状态机见 [`super::ops::transition`]）。`Idle` / `WaitingInput` 是宿主与
/// 移动端既有的线协议取值，本域保留同形变体：P1 后续阶段改由本域供事实时，
/// 形状不得缺格，否则宿主反序列化即失败。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    /// 空闲（移动端语义，本域不生产）
    Idle,
    /// 启动中（两阶段启动的第一阶段：`start = false`）
    Starting,
    /// 运行中
    Running,
    /// 等待输入（移动端语义，本域不生产）
    WaitingInput,
    /// 停止中（`Stopping` 生命周期到达后、`Stopped` 之前的过渡态）
    Stopping,
    /// 已停止（终态）
    Stopped,
    /// 出错（终态，可带错误描述）
    Error(Option<String>),
}

impl SessionStatus {
    /// 终态判据：终态不再接受任何迁移（唯一例外是幂等重复写同值）
    pub fn is_terminal(&self) -> bool {
        matches!(self, SessionStatus::Stopped | SessionStatus::Error(_))
    }

    /// 对外展示字符串（`SessionSummary.status` / 同步事件状态的 wire 取值）
    ///
    /// 与 serde 标签同源，穷尽 match 保证新增变体不会漏。**`Error` 只出标签
    /// `error`**：`SessionSummary.status` 是 String 形状，把 `{"error": "…"}`
    /// 塞进去会让整条同步载荷在宿主侧解析失败；错误描述属于本域记录与
    /// `session-get` 视图，不经概要透出。
    ///
    /// 返回 `&'static str`（固定字面量，零分配）；需要所有权处由调用方 `.to_string()`
    pub fn wire_name(&self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Starting => "starting",
            SessionStatus::Running => "running",
            SessionStatus::WaitingInput => "waitingInput",
            SessionStatus::Stopping => "stopping",
            SessionStatus::Stopped => "stopped",
            SessionStatus::Error(_) => "error",
        }
    }
}

/// 会话记录（本插件私有库 `runs` 表的一行）
///
/// **术语**（ADR 0003 / `GLOSSARY.md`）：本类型与 `sessions` 表原名保留在代码里，
/// 但它承载的语义是**运行**——一次 agent 进程启动及其之后的全部对话。表名在容器
/// 迁移里改为 `runs`（`project::migrate` 的账本式重命名），`SessionRecord` 字段
/// 增加容器归属，不再是一次进程内登记的临时记录。
///
/// 与宿主 `SessionInfo` 的差异是**刻意的、增量式**的：
/// - 多 `ptyId`：PTY 句柄（`pty-<uuid>`）是插件的自有事实，进程级；
/// - 多 `canonicalRenderer` / `owner` / `updatedAt`：宿主分别存在独立的
///   `CanonicalRendererRegistry` / `session_owners` 表与 `SessionInfo` 之外；
/// - 多 `projectId` / `agentId` / `agentSessionId` / `title` / `model`：项目容器的
///   归属与 agent 侧事实（ADR 0003），**不进** `SessionInfoView` 线形状（该形状有
///   逐字锁，见 `view.rs`），只经 `run.list` 与项目视图消费；
/// - 不含 `sessionType`：宿主该字段恒为 `pty`（写死），无真源价值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    /// 运行标识（线协议与终端订阅键；重启保持同一 id）
    pub id: String,
    /// 自有 PTY 句柄（进程级；宿主重启后由启动对账清空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<String>,
    /// 来源配置 id（`session_configs.id`；无配置直接启动时为空串）
    pub config_id: String,
    /// 所属项目 id（`projects.id`；容器迁移前的历史行为空，迁移后必有值）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// 执行该运行的 agent id（`claude` / `pi` / `opencode` / `codex`；未识别为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// agent 自己的会话 id（pi 的 session / opencode 的 `ses_*`；BedCode 只引用不拥有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    /// 运行标题（首条用户消息或 agent 给的标题；缺省时视图退回 `name`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// agent 侧模型标识（驱动声明可切模型时才有值）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 事件账本是否被截断（超过 [`super::store::RUN_EVENT_CAP`] 后按 seq 淘汰）
    ///
    /// 落库形态是 `0/1`；语义是「历史不完整」，界面据此显示「已截断」提示
    /// （用户故事 35：知道历史缺了，而不是以为 agent 少说了）。
    #[serde(default)]
    pub truncated: bool,
    /// 展示名（唯一化由 `launch::generate_unique_name` 决策）
    pub name: String,
    /// 状态（写库存 JSON 文本，保 `Error` 载荷无损）
    pub status: SessionStatus,
    /// 记录创建时间（RFC3339 UTC，秒级）
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<String>,
    /// 正统渲染端归属（尺寸裁决的登记事实；`None` = 无归属）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_renderer: Option<crate::actions::RendererSource>,
    /// 创建方插件 id（`None` = 宿主自建，插件一律不可操作）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// 最后一次变更时间（RFC3339 UTC，秒级）
    pub updated_at: String,
}

/// 运行活动快照（项目列表的派生统计输入）
///
/// 只带聚合需要的三个字段 + 活跃位：项目域不该为了算「最近活动 / 活跃运行数」
/// 去理解会话状态机（`active` 由本域按 [`SessionStatus::is_terminal`] 判定后给出）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunActivity {
    pub project_id: Option<String>,
    pub agent_id: Option<String>,
    pub updated_at: String,
    pub active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 状态 wire 形状锁定：宿主 `SessionStatus`（externally tagged camelCase）
    /// 的逐字形态——`{"error": …}` 是宿主 `Error(Option<String>)` 的 serde 产物
    #[test]
    fn status_wire_shape_matches_host_enum() {
        let cases = [
            (SessionStatus::Idle, serde_json::json!("idle")),
            (SessionStatus::Starting, serde_json::json!("starting")),
            (SessionStatus::Running, serde_json::json!("running")),
            (
                SessionStatus::WaitingInput,
                serde_json::json!("waitingInput"),
            ),
            (SessionStatus::Stopping, serde_json::json!("stopping")),
            (SessionStatus::Stopped, serde_json::json!("stopped")),
            (
                SessionStatus::Error(Some("pty closed".to_string())),
                serde_json::json!({ "error": "pty closed" }),
            ),
            (
                SessionStatus::Error(None),
                serde_json::json!({ "error": null }),
            ),
        ];
        for (status, expected) in cases {
            let json = serde_json::to_value(&status).expect("serialize status");
            assert_eq!(json, expected, "状态 wire 形状必须与宿主一致");
            let back: SessionStatus = serde_json::from_value(json).expect("deserialize status");
            assert_eq!(back, status, "状态可往返");
        }
    }

    /// `wire_name()` 与 serde 标签同源：会话概要的 `status` 字段用的是标签字符串，
    /// 手写表与 `rename_all = "camelCase"` 一旦漂移，本用例即红
    #[test]
    fn wire_name_matches_serde_tag() {
        let cases = [
            SessionStatus::Idle,
            SessionStatus::Starting,
            SessionStatus::Running,
            SessionStatus::WaitingInput,
            SessionStatus::Stopping,
            SessionStatus::Stopped,
            SessionStatus::Error(Some("pty closed".to_string())),
            SessionStatus::Error(None),
        ];
        for status in cases {
            let json = serde_json::to_value(&status).expect("serialize status");
            let tag = match &json {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Object(map) => {
                    assert_eq!(map.len(), 1, "Error 是 externally tagged，键即标签");
                    map.keys().next().expect("Error 载荷应有标签键").clone()
                }
                other => panic!("意外的状态 wire 形状: {other}"),
            };
            assert_eq!(
                status.wire_name(),
                tag,
                "{status:?} 的概要字符串应等于 serde 标签"
            );
        }
        // 记账：Error 的描述文本不进概要字符串（SessionSummary.status 是 String 形状）
        assert_eq!(
            SessionStatus::Error(Some("boom".to_string())).wire_name(),
            "error"
        );
    }

    /// 存储文本形态同样是无损往返的（写库存 JSON 文本的理由）
    #[test]
    fn status_text_roundtrip_is_lossless() {
        let status = SessionStatus::Error(Some("boom".to_string()));
        let text = serde_json::to_string(&status).expect("serialize");
        assert_eq!(text, r#"{"error":"boom"}"#);
        let back: SessionStatus = serde_json::from_str(&text).expect("deserialize");
        assert_eq!(back, status);
    }

    /// 终态判据
    #[test]
    fn terminal_states_are_stopped_and_error() {
        assert!(SessionStatus::Stopped.is_terminal());
        assert!(SessionStatus::Error(None).is_terminal());
        for status in [
            SessionStatus::Idle,
            SessionStatus::Starting,
            SessionStatus::Running,
            SessionStatus::WaitingInput,
            SessionStatus::Stopping,
        ] {
            assert!(!status.is_terminal(), "{status:?} 不是终态");
        }
    }
}
