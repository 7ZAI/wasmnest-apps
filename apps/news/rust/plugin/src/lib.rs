//! News Plugin（WASM，双端单产物）。
//!
//! ## 产物形态
//!
//! 按桌面 world 构建，桌面与移动宿主加载**同一份** `.wasm`。业务全部在共享核
//! `wasmnest-news-core`：本 crate 只做三件事——探测平台、把宿主能力适配成核的
//! 端口、把命令参数映射到核函数。
//!
//! ## 命令契约
//!
//! 失败一律 `Err`，消息形如 `<分类码>: <原因>`（分类码见核的 `domain::error_kind`），
//! 前端据此取文案。抓取失败**不是**命令错误：`news.refresh-*` 返回带
//! `errorKind` 的结果，界面按源展示，不把整次刷新打成异常。
//!
//! ## 双端差异
//!
//! 定时器与系统剪贴板只在桌面可用；移动端端口返回 `port.unsupported`
//! （剪贴板由前端 `navigator.clipboard` 回退），不伪装成功。

mod host_ports;
mod platform;

use wasmnest_news_core::commands::{CircleInput, CredentialInput, NewSource, UpdateSource};
use wasmnest_news_core::domain::{ClearMode, FeedQuery, SettingsPatch};
use wasmnest_news_core::engine::{self, RefreshRequest};
use wasmnest_news_core::ports::{PortError, Ports};
use wasmnest_news_core::reader;
use wasmnest_news_core::schedule;
use wasmnest_news_core::store;
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::wasm_host::WasmHost;
use wasmnest_plugin_api::WasmPlugin;

use host_ports::{HostPorts, NoAssistant};
use platform::Platform;

const PLUGIN_ID: &str = "com.wasmnest.news";

fn host() -> WasmHost {
    WasmHost
}

/// 用宿主句柄装配一套端口，交给闭包执行（端口全是借用，不能逃逸）。
fn with_ports<R>(h: &WasmHost, f: impl FnOnce(&Ports<'_>) -> R) -> R {
    let ports = HostPorts(h);
    let assistant = NoAssistant;
    let bundle = Ports {
        fetch: &ports,
        db: &ports,
        clock: &ports,
        schedule: &ports,
        clipboard: &ports,
        log: &ports,
        events: &ports,
        assistant: &assistant,
    };
    f(&bundle)
}

fn to_anyhow(err: PortError) -> anyhow::Error {
    anyhow::anyhow!("{}: {}", err.code(), err.detail())
}

/// 解析「现在」：命令入参优先（前端 / 宿主定时器都会带），否则经时钟端口取。
///
/// 核只接受显式时间，因此这里没有「拿不到就用 0」的退路——窗口计算用 0 会把
/// 所有条目当成未来时间过滤掉，比报错更难排查。
fn explicit_now(args: &serde_json::Value) -> Option<i64> {
    args.get("nowMs")
        .or_else(|| args.get("now_ms"))
        .and_then(|v| v.as_i64())
        .filter(|value| *value > 0)
}

fn resolve_now(args: &serde_json::Value, p: &Ports<'_>) -> anyhow::Result<i64> {
    resolve_now_hint(explicit_now(args), p)
}

/// 参数已被 `parse_args` 移走时，用提前取好的时间提示。
fn resolve_now_hint(hint: Option<i64>, p: &Ports<'_>) -> anyhow::Result<i64> {
    match hint {
        Some(value) => Ok(value),
        None => p.clock.now_ms().map_err(to_anyhow),
    }
}

fn arg_str(args: &serde_json::Value, key: &str) -> anyhow::Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("missing {key}"))
}

fn opt_str(args: &serde_json::Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

fn json<T: serde::Serialize>(value: T, what: &str) -> anyhow::Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|e| anyhow::anyhow!("{what}: {e}"))
}

fn parse_args<T: serde::de::DeserializeOwned>(
    args: serde_json::Value,
    what: &str,
) -> anyhow::Result<T> {
    serde_json::from_value(args).map_err(|e| anyhow::anyhow!("{what} expects a valid payload: {e}"))
}

struct NewsPlugin;

impl WasmPlugin for NewsPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        // 双端宿主都从文件 plugin.json 读 manifest；这里内嵌的是桌面侧副本，
        // 仅供 native 测试消费。路径相对本文件上溯三级到应用根。
        serde_json::from_str(include_str!("../../../desktop/plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        let h = host();
        let platform = platform::detect(&h)?;
        h.log_info(&format!(
            "News plugin activating (single artifact; platform = {})",
            platform.as_str()
        ));

        with_ports(&h, |p| {
            let now = p.clock.now_ms().unwrap_or(0);
            if now == 0 {
                p.log.log_warn(
                    "news: host clock unavailable at activation; cleanup deferred to first command",
                );
            }
            match engine::init(p, now) {
                Ok(removed) => p.log.log_info(&format!(
                    "news: schema ready (removed {removed} stale items)"
                )),
                Err(err) => {
                    // 库不可用 = 应用不可用，这里翻成激活失败（fail-visible）
                    return Err(to_anyhow(err));
                }
            }
            // 定时器：移动端没有宿主定时器，端口显性 unsupported（属预期，不记错误）
            match p
                .schedule
                .register_interval(schedule::REFRESH_INTERVAL_SECS, schedule::TICK_COMMAND)
            {
                Ok(()) => p.log.log_info("news: 15-minute refresh timer registered"),
                Err(err) if err.code() == "port.unsupported" => p.log.log_info(
                    "news: host has no timer (mobile); refresh is driven by foreground events",
                ),
                Err(err) => p
                    .log
                    .log_warn(&format!("news: timer registration failed: {err}")),
            }
            // 激活期**不**发出网请求：宿主对未授权 origin 会弹询问窗并最多等 30s，
            // 而激活完成前应用界面还没挂载，用户无法作答；多源串行会把激活拖成数分钟。
            // 补抓由界面挂载 / 回前台时的 `news.refresh-stale` 驱动（那时窗口可作答），
            // 无界面自启场景则由首个 15 分钟节拍补上。这里只记一条意图日志。
            if now > 0 {
                p.log
                    .log_info("news: activation catch-up deferred to UI mount / first timer tick");
            }
            Ok(())
        })
    }

    fn deactivate() -> anyhow::Result<()> {
        host().log_info("News plugin deactivated (timer stops with the plugin)");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        let h = host();
        let platform = platform::current_opt();
        with_ports(&h, |p| dispatch(p, name, args, platform))
    }
}

fn normalize_settings(
    settings: &mut wasmnest_news_core::domain::Settings,
    platform: Option<Platform>,
) {
    if platform == Some(Platform::Mobile) {
        settings.reader_enabled = false;
    }
}

fn normalize_settings_patch(patch: &mut SettingsPatch, platform: Option<Platform>) {
    if platform == Some(Platform::Mobile) {
        patch.reader_enabled = None;
    }
}

fn is_reader_command(name: &str) -> bool {
    matches!(
        name,
        "news.read-item"
            | "news.archive-item-content"
            | "news.reader-stats"
            | "news.clear-reader-cache"
    )
}

fn dispatch(
    p: &Ports<'_>,
    name: &str,
    args: serde_json::Value,
    platform: Option<Platform>,
) -> anyhow::Result<serde_json::Value> {
    if platform == Some(Platform::Mobile) && is_reader_command(name) {
        return Err(anyhow::anyhow!("unknown command: {name}"));
    }
    match name {
        // ==================== 读取 ====================
        "news.list-feed" => {
            let hint = explicit_now(&args);
            let query: FeedQuery = parse_args(args, "news.list-feed")?;
            let now = resolve_now_hint(hint, p)?;
            json(
                engine::feed(p, &query, now).map_err(to_anyhow)?,
                "list-feed",
            )
        }
        "news.get-item" => {
            let item_id = arg_str(&args, "itemId")?;
            let now = resolve_now(&args, p)?;
            match engine::item_detail(p, &item_id, now).map_err(to_anyhow)? {
                Some((item, origins)) => {
                    Ok(serde_json::json!({ "item": item, "origins": origins }))
                }
                None => Ok(serde_json::Value::Null),
            }
        }
        "news.list-circles" => json(
            serde_json::json!({ "circles": wasmnest_news_core::store::load_circles(p).map_err(to_anyhow)? }),
            "list-circles",
        ),
        "news.list-sources" => json(
            serde_json::json!({ "sources": wasmnest_news_core::store::load_sources(p).map_err(to_anyhow)? }),
            "list-sources",
        ),
        "news.get-settings" => {
            let mut settings = engine::settings(p).map_err(to_anyhow)?;
            normalize_settings(&mut settings, platform);
            json(settings, "get-settings")
        }
        "news.set-settings" => {
            let mut patch: SettingsPatch = parse_args(args, "news.set-settings")?;
            normalize_settings_patch(&mut patch, platform);
            json(
                engine::save_settings(p, &patch).map_err(to_anyhow)?,
                "set-settings",
            )
        }
        "news.list-fetch-log" => {
            let source_id = opt_str(&args, "sourceId");
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(200) as usize;
            json(
                serde_json::json!({
                    "entries": engine::fetch_log(p, source_id.as_deref(), limit).map_err(to_anyhow)?
                }),
                "list-fetch-log",
            )
        }
        "news.list-credentials" => json(
            serde_json::json!({
                "credentials": wasmnest_news_core::store::list_credentials(p).map_err(to_anyhow)?
            }),
            "list-credentials",
        ),

        // ==================== 刷新 ====================
        "news.refresh-all" => {
            let now = resolve_now(&args, p)?;
            json(
                engine::refresh_all(p, RefreshRequest::manual(), now).map_err(to_anyhow)?,
                "refresh-all",
            )
        }
        "news.refresh-stale" => {
            let now = resolve_now(&args, p)?;
            json(
                engine::refresh_all(p, RefreshRequest::stale(), now).map_err(to_anyhow)?,
                "refresh-stale",
            )
        }
        "news.refresh-source" => {
            let now = resolve_now(&args, p)?;
            let source_id = arg_str(&args, "sourceId")?;
            json(
                engine::refresh_one(p, &source_id, RefreshRequest::tool(), now)
                    .map_err(to_anyhow)?,
                "refresh-source",
            )
        }
        // 宿主定时器到点调用：参数带 now_ms / now_utc
        "news.tick" => {
            let now = resolve_now(&args, p)?;
            json(
                engine::refresh_all(p, RefreshRequest::auto(), now).map_err(to_anyhow)?,
                "tick",
            )
        }

        // ==================== 条目状态 ====================
        "news.mark-read" => {
            let now = resolve_now(&args, p)?;
            let item_id = arg_str(&args, "itemId")?;
            let read = args.get("read").and_then(|v| v.as_bool()).unwrap_or(true);
            engine::set_read(p, &item_id, read, now).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.mark-all-read" => {
            let hint = explicit_now(&args);
            let query: FeedQuery = parse_args(args, "news.mark-all-read")?;
            let now = resolve_now_hint(hint, p)?;
            let count = engine::mark_all_read(p, &query, now).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "count": count }))
        }
        "news.set-favorite" => {
            let now = resolve_now(&args, p)?;
            let item_id = arg_str(&args, "itemId")?;
            let favorite = args
                .get("favorite")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            engine::set_favorite(p, &item_id, favorite, now).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.copy-link" => {
            let url = arg_str(&args, "url")?;
            engine::copy_link(p, &url).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.read-item" => {
            let now = resolve_now(&args, p)?;
            let item_id = arg_str(&args, "itemId")?;
            let force = args
                .get("force")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            json(
                reader::read_item(p, &item_id, force, now).map_err(to_anyhow)?,
                "read-item",
            )
        }
        "news.archive-item-content" => {
            let now = resolve_now(&args, p)?;
            let item_id = arg_str(&args, "itemId")?;
            json(
                reader::archive_item_content(p, &item_id, now).map_err(to_anyhow)?,
                "archive-item-content",
            )
        }
        "news.reader-stats" => json(reader::reader_stats(p).map_err(to_anyhow)?, "reader-stats"),
        "news.clear-reader-cache" => {
            let mode = match arg_str(&args, "mode")?.as_str() {
                "unarchived" => ClearMode::Unarchived,
                "all" => ClearMode::All,
                other => {
                    return Err(to_anyhow(store::invalid(format!(
                        "clear-reader-cache: unknown mode {other}"
                    ))))
                }
            };
            json(
                reader::clear_content(p, mode).map_err(to_anyhow)?,
                "clear-reader-cache",
            )
        }

        // ==================== 源 / 圈子 / 凭据 ====================
        "news.add-source" => {
            let hint = explicit_now(&args);
            let input: NewSource = parse_args(args, "news.add-source")?;
            let now = resolve_now_hint(hint, p)?;
            json(
                wasmnest_news_core::commands::create_source(p, &input, now).map_err(to_anyhow)?,
                "add-source",
            )
        }
        "news.update-source" => {
            let hint = explicit_now(&args);
            let input: UpdateSource = parse_args(args, "news.update-source")?;
            let now = resolve_now_hint(hint, p)?;
            json(
                wasmnest_news_core::commands::update_source(p, &input, now).map_err(to_anyhow)?,
                "update-source",
            )
        }
        "news.delete-source" => {
            let id = arg_str(&args, "id")?;
            wasmnest_news_core::commands::delete_source(p, &id).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.add-circle" => {
            let hint = explicit_now(&args);
            let input: CircleInput = parse_args(args, "news.add-circle")?;
            let now = resolve_now_hint(hint, p)?;
            json(
                wasmnest_news_core::commands::create_circle(p, &input, now).map_err(to_anyhow)?,
                "add-circle",
            )
        }
        "news.update-circle" => {
            let input: CircleInput = parse_args(args, "news.update-circle")?;
            json(
                wasmnest_news_core::commands::update_circle(p, &input).map_err(to_anyhow)?,
                "update-circle",
            )
        }
        "news.delete-circle" => {
            let id = arg_str(&args, "id")?;
            wasmnest_news_core::commands::delete_circle(p, &id).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.save-credential" => {
            let hint = explicit_now(&args);
            let input: CredentialInput = parse_args(args, "news.save-credential")?;
            let now = resolve_now_hint(hint, p)?;
            json(
                wasmnest_news_core::commands::save_credential(p, &input, now).map_err(to_anyhow)?,
                "save-credential",
            )
        }
        "news.delete-credential" => {
            let now = resolve_now(&args, p)?;
            let id = arg_str(&args, "id")?;
            wasmnest_news_core::commands::delete_credential(p, &id, now).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "news.export-json" => {
            let now = resolve_now(&args, p)?;
            let json_text = wasmnest_news_core::commands::export_json(p, now).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "json": json_text }))
        }

        // ==================== AI 摘要 ====================
        "news.ai-summarize" => {
            let now = resolve_now(&args, p)?;
            let ids: Vec<String> = args
                .get("itemIds")
                .and_then(|v| v.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            json(
                engine::ai_summarize(p, &ids, now).map_err(to_anyhow)?,
                "ai-summarize",
            )
        }

        // ==================== 助手工具 ====================
        "news.today-summary" => {
            let now = resolve_now(&args, p)?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
            json(
                serde_json::json!({
                    "items": engine::today_summary(p, now, limit).map_err(to_anyhow)?
                }),
                "today-summary",
            )
        }
        "news.search-items" => {
            let keyword = arg_str(&args, "keyword")?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            json(
                serde_json::json!({
                    "items": engine::search_items(p, &keyword, limit).map_err(to_anyhow)?
                }),
                "search-items",
            )
        }
        "news.assistant-fetch" => {
            // 反向代抓：宿主当前没有该能力，固定显性不可用（不静默回退）
            let url = arg_str(&args, "url")?;
            let schema = opt_str(&args, "schema").unwrap_or_default();
            engine::assistant_fetch(p, &url, &schema).map_err(to_anyhow)?;
            Ok(serde_json::json!({ "ok": true }))
        }

        _ => Err(anyhow::anyhow!("unknown command: {name}")),
    }
}

wasmnest_plugin_api::wasm_entry!(NewsPlugin);

#[cfg(test)]
mod tests {
    use super::*;
    use wasmnest_news_core::domain::error_kind;

    #[test]
    fn unknown_command_is_rejected() {
        let err = NewsPlugin::invoke_command("news.nope", serde_json::json!({}))
            .expect_err("未知命令必须报错");
        assert!(err.to_string().contains("unknown command"), "got: {err}");
    }

    #[test]
    fn malformed_payload_is_rejected_with_command_name() {
        let err = NewsPlugin::invoke_command("news.list-feed", serde_json::json!({}))
            .expect_err("缺少 view 必须报错");
        assert!(
            err.to_string().contains("news.list-feed expects"),
            "got: {err}"
        );
    }

    #[test]
    fn missing_required_argument_is_named() {
        let err = NewsPlugin::invoke_command("news.get-item", serde_json::json!({}))
            .expect_err("缺少 itemId 必须报错");
        assert!(err.to_string().contains("missing itemId"), "got: {err}");
    }

    #[test]
    fn manifest_declares_every_dispatched_command() {
        let manifest = NewsPlugin::manifest();
        let declared: Vec<String> = manifest
            .contributes
            .commands
            .iter()
            .map(|command| command.id.clone())
            .collect();
        for command in [
            "news.list-feed",
            "news.get-item",
            "news.list-circles",
            "news.list-sources",
            "news.get-settings",
            "news.set-settings",
            "news.read-item",
            "news.archive-item-content",
            "news.reader-stats",
            "news.clear-reader-cache",
            "news.list-fetch-log",
            "news.list-credentials",
            "news.refresh-all",
            "news.refresh-stale",
            "news.refresh-source",
            "news.tick",
            "news.mark-read",
            "news.mark-all-read",
            "news.set-favorite",
            "news.copy-link",
            "news.add-source",
            "news.update-source",
            "news.delete-source",
            "news.add-circle",
            "news.update-circle",
            "news.delete-circle",
            "news.save-credential",
            "news.delete-credential",
            "news.export-json",
            "news.ai-summarize",
            "news.today-summary",
            "news.search-items",
            "news.assistant-fetch",
        ] {
            assert!(
                declared.iter().any(|id| id == command),
                "plugin.json 缺命令声明 {command}"
            );
        }
    }

    #[test]
    fn error_message_carries_the_classification_code() {
        let err = to_anyhow(PortError::with_detail(error_kind::NET_DENIED, "denied"));
        assert_eq!(err.to_string(), "net.denied: denied");
    }

    #[test]
    fn reader_commands_are_rejected_before_argument_parsing_on_mobile() {
        let _guard = platform::TEST_LOCK.lock().expect("platform test lock");
        platform::set_for_test(Some(Platform::Mobile));
        for command in [
            "news.read-item",
            "news.archive-item-content",
            "news.reader-stats",
            "news.clear-reader-cache",
        ] {
            let err = NewsPlugin::invoke_command(command, serde_json::json!({}))
                .expect_err("移动端必须拒绝阅读命令");
            assert!(
                err.to_string().contains("unknown command"),
                "command {command}: {err}"
            );
        }
        platform::set_for_test(None);
    }

    #[test]
    fn mobile_settings_force_reader_off() {
        let mut settings = wasmnest_news_core::domain::Settings::default();
        settings.reader_enabled = true;
        normalize_settings(&mut settings, Some(Platform::Mobile));
        assert!(!settings.reader_enabled);
    }

    #[test]
    fn mobile_settings_patch_drops_reader_field() {
        let mut patch = SettingsPatch {
            reader_enabled: Some(true),
            ..Default::default()
        };
        normalize_settings_patch(&mut patch, Some(Platform::Mobile));
        assert_eq!(patch.reader_enabled, None);

        let mut desktop_patch = SettingsPatch {
            reader_enabled: Some(false),
            ..Default::default()
        };
        normalize_settings_patch(&mut desktop_patch, Some(Platform::Desktop));
        assert_eq!(desktop_patch.reader_enabled, Some(false));
    }

    #[test]
    fn invalid_clear_mode_is_an_invalid_argument() {
        let _guard = platform::TEST_LOCK.lock().expect("platform test lock");
        platform::set_for_test(Some(Platform::Desktop));
        let err = NewsPlugin::invoke_command(
            "news.clear-reader-cache",
            serde_json::json!({ "mode": "bogus" }),
        )
        .expect_err("unknown clear mode must fail");
        assert!(err.to_string().contains("invalid.argument"), "got: {err}");
        platform::set_for_test(None);
    }
}
