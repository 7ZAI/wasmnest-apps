//! 引导域状态（host-storage `bootstrap` 键，读-改-写 + 全量推送）
//!
//! 与 `install` 域**分键存储**（`bootstrap` vs `install`）但**共享串行语义**：
//! 两个域的状态各自是单一真源，互斥由命令入口判定（见 `env::start`）。
//!
//! 事件 `plugin:agent-hub:bootstrap` 全量推送，带单调 `seq`（与 `detection`
//! 同模式）：探测期间多次推送，前端按 seq 过滤乱序旧事件，只接受最新全量。

use super::sources::NODE_VERSION;
use crate::install::now_ms;
use crate::{BOOTSTRAP_KEY, DATA_DIR, HOME};
use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostEvents, HostLog, HostStorage};
use wasmnest_plugin_api::wasm_host::WasmHost;
use std::sync::atomic::{AtomicU32, Ordering};

/// 状态推送序号（单调自增；前端按 seq 丢弃乱序旧事件）
static STATE_SEQ: AtomicU32 = AtomicU32::new(0);

pub(super) fn read(h: &WasmHost) -> Value {
    let mut st = h
        .storage_get(BOOTSTRAP_KEY)
        .ok()
        .flatten()
        .unwrap_or_else(default_state);
    if !st.is_object() {
        // 存储损坏（不是对象）：退回默认状态，别带着脏数据往下走
        st = default_state();
    }
    // 钉住版本以**编译期常量**为准：持久化状态可能来自上一个应用版本，
    // 前端用 `version` 与 `placedVersion` 比较来判定「可升级」。
    st["version"] = json!(NODE_VERSION);
    st
}

/// 默认状态（纯函数，可测）：字段即前端 `BootstrapState` 的 wire 形状
pub(super) fn default_state() -> Value {
    json!({
        "phase": super::phases::Phase::Idle.as_str(),
        "active": false,
        "version": NODE_VERSION,
        "platform": null,
        "file": null,
        "sourceUrl": null,
        "sha256": null,
        "bytes": null,
        // 产物候选表（Linux 含 .tar.xz 兜底）与当前目标
        "targets": [],
        "targetIndex": 0,
        // 下载推进游标（内部字段，前端只读展示）
        "sourceIndex": 0,
        "attemptIndex": 0,
        "sources": [],
        // preflight 结论（可用工具 / 磁盘）
        "tools": [],
        // 在途进程
        "runId": null,
        "cachePath": null,
        "tmpDir": null,
        "extractIndex": 0,
        "extractError": null,
        // 已有可用 node 时短路：不下载、不改 PATH
        "alreadyReady": false,
        "detectedVersion": null,
        // 本插件落位过的版本（移除环境 / 升级分支的真源；null = 没装过）
        "placedVersion": null,
        // 升级时要清理的旧版本（成功后摘 PATH + 删目录；null = 非升级）
        "previousVersion": null,
        // 已登记进用户 PATH 的条目（升级 / 移除时按它精确摘除自己的条目）
        "registered": [],
        // 删不掉的旧目录（文件占用 / 杀软）：只影响文案，不阻塞后续操作
        "cleanupPending": [],
        "removedAt": 0,
        "startedAt": 0,
        "finishedAt": 0,
        "error": null,
    })
}

pub(super) fn write(h: &WasmHost, state: &Value) {
    if let Err(e) = h.storage_set(BOOTSTRAP_KEY, state) {
        h.log_warn(&format!("env: persist bootstrap state failed: {e}"));
    }
}

pub(super) fn emit(h: &WasmHost, state: &Value) {
    h.emit_event("plugin:agent-hub:bootstrap", state);
}

/// 落库 + 推送（seq 单调自增），返回带 seq 的状态副本
pub(super) fn push(h: &WasmHost, state: &mut Value) -> Value {
    state["seq"] = json!(STATE_SEQ.fetch_add(1, Ordering::Relaxed) + 1);
    write(h, state);
    emit(h, state);
    state.clone()
}

/// 命令返回值与事件载荷同形：`{ state }`（前端两条路径共用一套解析）
pub(super) fn push_and_return(h: &WasmHost, state: &mut Value) -> Value {
    let snapshot = push(h, state);
    json!({ "state": snapshot })
}

/// 数据目录 / 家目录（activate 未完成时 None → 命令入口 fail-visible）
pub(super) fn dirs() -> Option<(String, String)> {
    let data = DATA_DIR.get()?.clone();
    let home = HOME.get()?.clone();
    Some((data, home))
}

/// 当前时间戳（wasm 无系统时钟，经宿主取；失败返回 0 而非编造时间）
pub(super) fn started_now(h: &WasmHost) -> u64 {
    now_ms(h).unwrap_or(0)
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 默认状态形状：idle / 非 active / 版本已钉 / 无在途进程 / 无失败
    #[test]
    fn default_state_shape() {
        let s = default_state();
        assert_eq!(s["phase"], json!("idle"));
        assert_eq!(s["active"], json!(false));
        assert_eq!(s["version"], json!(NODE_VERSION));
        assert!(s["platform"].is_null());
        assert!(s["runId"].is_null());
        assert!(s["error"].is_null());
        assert_eq!(s["sources"], json!([]));
        assert_eq!(s["targets"], json!([]));
        assert_eq!(s["targetIndex"], json!(0));
        assert_eq!(s["sourceIndex"], json!(0));
        assert_eq!(s["attemptIndex"], json!(0));
        assert_eq!(s["alreadyReady"], json!(false));
        // 管理面字段（P4）：没装过 = 三个空位；升级/移除据此判定
        assert!(s["placedVersion"].is_null());
        assert!(s["previousVersion"].is_null());
        assert_eq!(s["registered"], json!([]));
        assert_eq!(s["cleanupPending"], json!([]));
    }
}
