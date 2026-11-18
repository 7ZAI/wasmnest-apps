//! News Plugin (WASM, 双端单产物) — v1 骨架
//!
//! ## 产物形态
//!
//! 按桌面 world 构建，桌面与移动宿主加载**同一份** `.wasm`。当前命令面不区分
//! 平台：列表查询返回本机真实状态（无源时就是空列表），刷新显式报告抓取引擎
//! 尚未接入。后续抓取 / 持久化 / AI 摘要的实现只替换
//! [`wasmnest_news_core::ports`] 的端口，不动列表判据。
//!
//! ## 已实现命令
//!
//! | 命令 | 行为 |
//! | --- | --- |
//! | `news.list-feed` | 按 `{ view, circleId? }` 过滤排序；当前库为空 |
//! | `news.list-circles` | 圈子列表（当前为空） |
//! | `news.list-sources` | 源列表（当前为空） |
//! | `news.get-settings` | 默认设置（AI 摘要关闭） |
//! | `news.refresh` | 显性失败：抓取引擎未接入 |
//!
//! 未知命令一律 `Err`，不静默返回空。

use wasmnest_news_core::{select_items, window_hours, Feed, FeedQuery, Item, Settings};
use wasmnest_plugin_api::host::{ConfigKey, HostConfig, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.news";

struct NewsPlugin;

/// 宿主当前时间（Unix 毫秒）。
///
/// wasm32 没有系统时钟，时间只经宿主配置项读取；不可用时降级为 0——空列表下
/// 窗口判据不会因此误放行条目。
fn current_time_ms() -> i64 {
    match WasmHost.config_get(ConfigKey::CurrentTimeMs) {
        Ok(Some(raw)) => raw.parse().unwrap_or(0),
        Ok(None) | Err(_) => 0,
    }
}

impl WasmPlugin for NewsPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        // 双端宿主均从**文件** plugin.json 读 manifest（本导出仅测试消费）。
        // 路径相对本文件（应用级 rust 层 `rust/plugin/src/`）上溯三级到应用根。
        serde_json::from_str(include_str!("../../../desktop/plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        WasmHost.log_info("News plugin activated (v1 skeleton: mounting + four feed tabs)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("News plugin deactivated");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            "news.list-feed" => {
                let query: FeedQuery = serde_json::from_value(args).map_err(|e| {
                    anyhow::anyhow!("news.list-feed expects {{ view, circleId? }}: {e}")
                })?;
                let now = current_time_ms();
                let stored: Vec<Item> = Vec::new();
                let items = select_items(&stored, &query, now);
                let feed = Feed {
                    items,
                    window_hours: window_hours(query.view),
                    generated_at: now,
                };
                serde_json::to_value(feed).map_err(|e| anyhow::anyhow!("news.list-feed: {e}"))
            }
            "news.list-circles" => Ok(serde_json::json!({ "circles": [] })),
            "news.list-sources" => Ok(serde_json::json!({ "sources": [] })),
            "news.get-settings" => serde_json::to_value(Settings::default())
                .map_err(|e| anyhow::anyhow!("news.get-settings: {e}")),
            "news.refresh" => Err(anyhow::anyhow!(
                "news.refresh is not implemented yet: the fetch engine has not been wired"
            )),
            _ => Err(anyhow::anyhow!("unknown command: {name}")),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(NewsPlugin);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_command_is_rejected() {
        let err = NewsPlugin::invoke_command("news.nope", serde_json::json!({}))
            .expect_err("未知命令必须报错");
        assert!(err.to_string().contains("unknown command"), "got: {err}");
    }

    #[test]
    fn refresh_reports_unimplemented_instead_of_fake_success() {
        let err = NewsPlugin::invoke_command("news.refresh", serde_json::Value::Null)
            .expect_err("抓取引擎未接入时必须显性失败");
        assert!(err.to_string().contains("not implemented"), "got: {err}");
    }

    #[test]
    fn list_feed_rejects_malformed_args_before_touching_host_time() {
        let err = NewsPlugin::invoke_command("news.list-feed", serde_json::json!({}))
            .expect_err("缺少 view 必须报错");
        assert!(
            err.to_string().contains("news.list-feed expects"),
            "got: {err}"
        );
    }
}
