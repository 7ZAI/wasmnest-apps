//! 测速与最新版本查询（host-http，免 shell）
//!
//! 测速：对候选源（内置 + 自定义）各做一次小 GET 计时（计时用
//! `ConfigKey::CurrentTimeMs`——wasm32-unknown-unknown 无系统时钟，
//! `Instant::now()` 会 panic），给出换源推荐；最新版本：registry HTTP API
//! `GET /<pkg>/latest`（官方源失败回落 npmmirror），与本地版本比较得 outdated。
//! 候选源白名单常量亦在此（测速列表 + apply-mirror 白名单共用）。

use super::state::{all_sources, emit, emit_and_return, now_ms, read_state, write_state};
use super::version::compare_versions;
use crate::hub::agents::{self, Agent, LatestSource};
use crate::hub::detect;
use serde_json::{json, Value};
use std::cmp::Ordering;
use wasmnest_plugin_api::host::{HostHttp, HostLog, HostStorage};
use wasmnest_plugin_api::wasm_host::WasmHost;

/// npm 官方源与 npmmirror（spec §4.2 固定两源）
pub(crate) const NPMJS: &str = "https://registry.npmjs.org";
pub(crate) const NPMMIRROR: &str = "https://registry.npmmirror.com";
/// 可切换 npm 源白名单（id, url）：测速列表 + apply-mirror 白名单共用，
/// 不拼接用户输入。列表已实测连通（2026-09-14，GET /semver/latest 200）；
/// id 供前端 i18n 映射展示名（hub.speed.source.<id>）。用户自定义源
/// （mirror.customSources）在测速/换源时追加到本表之后。
pub(crate) const MIRROR_SOURCES: [(&str, &str); 5] = [
    ("npmmirror", "https://registry.npmmirror.com"),
    ("npmjs", "https://registry.npmjs.org"),
    ("huawei", "https://mirrors.huaweicloud.com/repository/npm/"),
    ("tencent", "https://mirrors.cloud.tencent.com/npm/"),
    ("yarn", "https://registry.yarnpkg.com"),
];
/// 测速样本包：元数据小、两端长期存在，`/<pkg>/latest` 形态稳定
const PROBE_PKG: &str = "semver";

/// 批量授权的逐项决定（只用于「探不探」这一件事，不放行任何实际请求）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConsentDecision {
    Allow,
    Deny,
    Invalid,
}

/// 批量授权询问的整体结论
#[derive(Debug, Clone, PartialEq, Eq)]
enum BatchConsent {
    /// 当前端不支持批量询问：回退逐个 fetch（单 origin 授权窗照常出现）
    Unsupported,
    /// 逐项决定（按候选源索引对齐）+ 因容量上限未能落账的 allow 条数
    Decisions {
        decisions: Vec<ConsentDecision>,
        dropped_records: usize,
    },
    /// 当前策略为「总是询问」：不批量、不静默改档
    AlwaysAsk,
    /// 其他稳定错误码（显性展示，不伪装成网络不可达）
    Failed(String),
}

// ==================== 测速 ====================
// ==================== 测速 ====================

/// 探测前提交一次批量授权（只询问，不发请求；实际 fetch 仍走完整判定链）
fn batch_egress_consent(h: &WasmHost, candidates: &[(String, String)]) -> BatchConsent {
    let urls: Vec<String> = candidates
        .iter()
        .map(|(_, url)| format!("{url}/{PROBE_PKG}/latest"))
        .collect();
    let request = json!({ "urls": urls }).to_string();
    let response = match h.request_egress_consent(&request) {
        Ok(response) => response,
        Err(error) => return classify_consent_failure(&error.to_string()),
    };
    match parse_consent_decisions(&response, urls.len()) {
        Ok((decisions, dropped_records)) => BatchConsent::Decisions {
            decisions,
            dropped_records,
        },
        Err(code) => BatchConsent::Failed(code),
    }
}

/// 宿主错误串 → 稳定分支（SDK 错误文本带能力域错误码）
fn classify_consent_failure(message: &str) -> BatchConsent {
    if message.contains("consent.unsupported") {
        return BatchConsent::Unsupported;
    }
    if message.contains("consent.always-ask") {
        return BatchConsent::AlwaysAsk;
    }
    let known = [
        "consent.permission-denied",
        "consent.unavailable",
        "consent.store-failed",
        "consent.internal",
        "consent.invalid-request",
        "consent.too-many",
    ];
    let code = known
        .iter()
        .find(|code| message.contains(*code))
        .copied()
        .unwrap_or("consent.internal");
    BatchConsent::Failed(code.to_string())
}

/// 解析批量响应；缺少索引 / 形状异常 → `consent.internal`（不猜已授权）
fn parse_consent_decisions(
    response: &str,
    expected: usize,
) -> Result<(Vec<ConsentDecision>, usize), String> {
    let value: Value =
        serde_json::from_str(response).map_err(|_| "consent.internal".to_string())?;
    let results = value
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| "consent.internal".to_string())?;
    let dropped_records = value
        .get("droppedRecords")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let mut decisions = vec![ConsentDecision::Invalid; expected];
    for item in results {
        let index = item
            .get("index")
            .and_then(Value::as_u64)
            .map(|index| index as usize)
            .ok_or_else(|| "consent.internal".to_string())?;
        if index >= expected {
            return Err("consent.internal".to_string());
        }
        decisions[index] = match item.get("decision").and_then(Value::as_str) {
            Some("allow") => ConsentDecision::Allow,
            Some("deny") => ConsentDecision::Deny,
            _ => ConsentDecision::Invalid,
        };
    }
    Ok((decisions, dropped_records))
}

/// 组装测速来源列表（纯函数：拒绝 / 无效项不触网，未决项才探测）
fn build_speed_results(
    candidates: &[(String, String)],
    decisions: Option<&[ConsentDecision]>,
    mut probe: impl FnMut(&str) -> Option<u64>,
) -> Vec<Value> {
    let mut results = Vec::with_capacity(candidates.len());
    for (index, (id, url)) in candidates.iter().enumerate() {
        let decision = decisions
            .and_then(|decisions| decisions.get(index))
            .copied();
        if matches!(decision, Some(ConsentDecision::Deny)) {
            results.push(json!({
                "id": id,
                "url": url,
                "ms": null,
                "reachable": false,
                "reason": "denied",
            }));
            continue;
        }
        if matches!(decision, Some(ConsentDecision::Invalid)) {
            results.push(json!({
                "id": id,
                "url": url,
                "ms": null,
                "reachable": false,
                "reason": "invalid",
            }));
            continue;
        }
        let ms = probe(&format!("{url}/{PROBE_PKG}/latest"));
        results.push(json!({
            "id": id,
            "url": url,
            "ms": ms,
            "reachable": ms.is_some(),
            "reason": if ms.is_some() { Value::Null } else { json!("unreachable") },
        }));
    }
    results
}

/// 两源小 GET 计时（一次探测一个源，host-http 非流式）
fn probe_registry(h: &WasmHost, url: &str) -> Result<u64, String> {
    let t0 = now_ms(h)?;
    let request = json!({ "method": "GET", "url": url });
    let resp = h
        .http_fetch(&request)
        .map_err(|e| format!("http failed: {e}"))?
        .ok_or_else(|| "empty response".to_string())?;
    let t1 = now_ms(h)?;
    let status = resp.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
    if status != 200 {
        return Err(format!("status {status}"));
    }
    Ok(t1.saturating_sub(t0).max(1))
}

/// 测速全部候选源并给出推荐：sources 数组（可达按耗时升序、不可达置后）+ recommend
/// （最快可达源的 id）。只测速不切换——切换由用户在列表中选择（apply-mirror 白名单）。
pub(crate) fn speed_test(h: &WasmHost) -> anyhow::Result<Value> {
    let mut state = read_state(h);
    state["mirror"]["speed"] = json!({
        "status": "testing",
        "sources": [],
        "recommend": null,
        "error": null,
        "testedAt": null,
    });
    write_state(h, &state);
    emit(h, &state);
    h.log_info("registry speed test started");

    // 先提交一次批量授权（只询问）；实际探测仍走 http_fetch 的完整判定链
    let candidates = all_sources(&state);
    let consent = batch_egress_consent(h, &candidates);
    let (decisions, dropped_records) = match consent {
        BatchConsent::Unsupported => (None, 0),
        BatchConsent::Decisions {
            decisions,
            dropped_records,
        } => (Some(decisions), dropped_records),
        BatchConsent::AlwaysAsk => {
            state["mirror"]["speed"] = json!({
                "status": "error",
                "sources": [],
                "recommend": null,
                "error": "consent.always-ask",
                "testedAt": now_ms(h).unwrap_or(0),
            });
            write_state(h, &state);
            h.log_warn("registry speed test blocked: authorization strategy is always_ask");
            return emit_and_return(h, &state);
        }
        BatchConsent::Failed(code) => {
            state["mirror"]["speed"] = json!({
                "status": "error",
                "sources": [],
                "recommend": null,
                "error": code,
                "testedAt": now_ms(h).unwrap_or(0),
            });
            write_state(h, &state);
            h.log_warn(&format!("registry speed test blocked: {code}"));
            return emit_and_return(h, &state);
        }
    };

    // wasm 单线程阻塞式 http_fetch：未决源顺序测速（候选源少，耗时叠加可接受）
    let mut results = build_speed_results(&candidates, decisions.as_deref(), |url| {
        probe_registry(h, url).ok()
    });
    results.sort_by(compare_source);
    // 推荐：全部候选里最快可达者（排序后首位可达）
    let recommend = results
        .iter()
        .find(|r| r["reachable"] == json!(true))
        .map(|r| r["id"].clone());
    let error = if recommend.is_none() {
        if results.iter().any(|row| row["reason"] == "denied") {
            Some("all registries denied".to_string())
        } else {
            Some("all registries unreachable".to_string())
        }
    } else {
        None
    };
    let tested_at = now_ms(h).unwrap_or(0);

    state["mirror"]["speed"] = json!({
        "status": if recommend.is_some() { "ok" } else { "error" },
        // 供选择的候选：按速度排序，最多前 10（用户诉求：列出前 5/前 10 供选择）
        "sources": results.into_iter().take(10).collect::<Vec<_>>(),
        "recommend": recommend,
        "error": error,
        // 批量落账触顶：放行方向不变，但应用必须提示「下次仍会询问」
        "notice": if dropped_records > 0 {
            json!("consent.dropped-records")
        } else {
            Value::Null
        },
        "testedAt": tested_at,
    });
    write_state(h, &state);
    h.log_info(&format!(
        "registry speed test done ({} candidates, recommend={recommend:?})",
        candidates.len()
    ));
    emit_and_return(h, &state)
}

/// sources 排序：可达按耗时升序在前，不可达置后
fn compare_source(a: &Value, b: &Value) -> Ordering {
    match (a["ms"].as_u64(), b["ms"].as_u64()) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}
// ==================== 最新版本查询 ====================
// ==================== 最新版本查询 ====================

/// registry HTTP API 查最新版本（免 shell）：官方源失败回落 npmmirror；
/// scoped 包名按 registry 约定转义 `/` → `%2f`
fn fetch_latest_version(h: &WasmHost, pkg: &str) -> Result<String, String> {
    let scoped = pkg.replace('/', "%2f");
    for base in [NPMJS, NPMMIRROR] {
        let request = json!({ "method": "GET", "url": format!("{base}/{scoped}/latest") });
        match h.http_fetch(&request) {
            Ok(Some(resp)) => {
                let status = resp.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
                let body = resp.get("body").and_then(|v| v.as_str()).unwrap_or("");
                if status == 200 {
                    if let Ok(meta) = serde_json::from_str::<Value>(body) {
                        if let Some(v) = meta.get("version").and_then(|v| v.as_str()) {
                            return Ok(v.to_string());
                        }
                    }
                }
            }
            Ok(None) => {}
            Err(e) => h.log_debug(&format!("install: latest query failed on {base}: {e}")),
        }
    }
    Err(format!("latest version unavailable for {pkg}"))
}

/// opencode 的 GitHub Releases 仓库由适配器声明（`LatestSource::GitHub`）；
/// GitHub Releases API 查最新版本（免 shell，与 npm registry 同走
/// host-http）：`GET /repos/{repo}/releases/latest` → tag_name（`v1.19.1`
/// 形态，剥前缀 v）。未认证限 60 次/小时/IP，偶发更新检查足够
fn fetch_github_latest(h: &WasmHost, repo: &str) -> Result<String, String> {
    let request = json!({ "method": "GET", "url": format!("https://api.github.com/repos/{repo}/releases/latest") });
    match h.http_fetch(&request) {
        Ok(Some(resp)) => {
            let status = resp.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
            let body = resp.get("body").and_then(|v| v.as_str()).unwrap_or("");
            if status == 200 {
                if let Ok(meta) = serde_json::from_str::<Value>(body) {
                    if let Some(tag) = meta.get("tag_name").and_then(|v| v.as_str()) {
                        return Ok(tag.strip_prefix('v').unwrap_or(tag).to_string());
                    }
                }
            }
        }
        Ok(None) => {}
        Err(e) => h.log_debug(&format!("install: github latest failed on {repo}: {e}")),
    }
    Err(format!("github latest unavailable for {repo}"))
}

/// 最新版本查询分派（适配器声明来源）：GitHub Releases 为主来源的形态
/// （opencode standalone）先查 GitHub，失败回落 npm registry；其余走 npm
fn fetch_latest_for_agent(
    h: &WasmHost,
    agent: &dyn Agent,
    method: Option<&str>,
) -> Result<String, String> {
    match agent.latest_source(method) {
        Some(LatestSource::GitHub(repo)) => match fetch_github_latest(h, repo) {
            Ok(v) => return Ok(v),
            Err(e) => h.log_warn(&format!("install: github latest failed, fallback npm: {e}")),
        },
        Some(LatestSource::Npm(pkg)) => return fetch_latest_version(h, pkg),
        // 未声明来源：走包名兜底（无包名时 fail-visible）
        None => {}
    }
    let pkg = agent
        .npm_package()
        .ok_or_else(|| format!("no package for {}", agent.id()))?;
    fetch_latest_version(h, pkg)
}

/// 「检测更新」命令入口：置位 pending 并触发全量重探测（刷新本地已安装版本），
/// 探测收敛后由 detect 回灌自动执行 [`run_update_check`]。
/// 不在此同步查 registry——本地版本若用上次探测缓存，outdated 会按旧版本误判
/// （2026-10-02 实测：pi 已装 1.0、缓存 0.87，检测更新仍显示可更新）
pub(crate) fn check_updates(h: &WasmHost) -> anyhow::Result<Value> {
    detect::request_update_check(h)?;
    Ok(json!({ "started": true }))
}

/// 最新版本查询本体（探测收敛后由 detect 回灌调用：本地版本为本轮实测值）。
/// 四家 CLI 各查一次 latest，与刷新后的本地版本比较得 outdated
pub(crate) fn run_update_check(h: &WasmHost) -> anyhow::Result<()> {
    let mut state = read_state(h);
    let detection = h.storage_get(crate::hub::STATE_KEY).ok().flatten();
    let checked_at = now_ms(h).unwrap_or(0);

    for agent in agents::all().iter().copied() {
        let cli = agent.id();
        let local = detection
            .as_ref()
            .and_then(|d| d["clis"][cli]["version"].as_str())
            .map(|s| s.to_string());
        // 来源由适配器声明（opencode standalone 以 GitHub Releases 为权威，
        // 失败回落 npm registry；其余 CLI 一律 npm），公共查询与回落在此复用
        let method = detection
            .as_ref()
            .and_then(|d| d["clis"][cli]["method"].as_str());
        let entry = match fetch_latest_for_agent(h, agent, method) {
            Ok(latest) => json!({
                "latest": latest,
                "outdated": outdated_flag(local.as_deref(), &latest),
                "checkedAt": checked_at,
                "error": null,
            }),
            Err(e) => {
                json!({ "latest": null, "outdated": null, "checkedAt": checked_at, "error": e })
            }
        };
        state["updates"][cli] = entry;
    }
    write_state(h, &state);
    h.log_info("update check finished");
    emit(h, &state);
    Ok(())
}

/// outdated 判定（纯函数，可测）：本地版本缺失（未安装/探测失败）时不判旧；
/// 其余按 local < latest
fn outdated_flag(local: Option<&str>, latest: &str) -> Option<bool> {
    local.map(|l| compare_versions(l, latest) == Ordering::Less)
}

// ==================== Tests（纯函数单测，双平台形态覆盖） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 宿主错误串按稳定码分类：unsupported 回退、always-ask 显性阻断、其余保持错误码
    #[test]
    fn consent_failure_classification_uses_stable_codes() {
        assert_eq!(
            classify_consent_failure("request_egress_consent: consent.unsupported"),
            BatchConsent::Unsupported
        );
        assert_eq!(
            classify_consent_failure("consent.always-ask"),
            BatchConsent::AlwaysAsk
        );
        assert_eq!(
            classify_consent_failure("consent.store-failed: db unavailable"),
            BatchConsent::Failed("consent.store-failed".to_string())
        );
        assert_eq!(
            classify_consent_failure("unexpected host failure"),
            BatchConsent::Failed("consent.internal".to_string())
        );
    }

    /// 逐项决定按入参索引回填；形状异常 / 越界一律 fail-closed 成 internal
    #[test]
    fn consent_decisions_are_backfilled_by_index() {
        let response = json!({
            "results": [
                { "index": 0, "origin": "https://a.example:443", "decision": "allow", "source": "user" },
                { "index": 1, "origin": "https://b.example:443", "decision": "deny", "source": "user-denied" },
                { "index": 2, "decision": "invalid" }
            ],
            "droppedRecords": 2
        })
        .to_string();
        let (decisions, dropped) =
            parse_consent_decisions(&response, 3).expect("well-formed response");
        assert_eq!(
            decisions,
            vec![
                ConsentDecision::Allow,
                ConsentDecision::Deny,
                ConsentDecision::Invalid
            ]
        );
        assert_eq!(dropped, 2, "droppedRecords 必须透传给应用");
        assert!(parse_consent_decisions("not-json", 1).is_err());
        assert!(
            parse_consent_decisions(r#"{"results":[{"index":3,"decision":"allow"}]}"#, 1).is_err(),
            "越界索引必须 fail-closed"
        );
    }

    /// 被拒 / 无效源不触网；未决源逐个探测
    #[test]
    fn denied_and_invalid_sources_are_not_probed() {
        let candidates = vec![
            ("allow".to_string(), "https://allow.example".to_string()),
            ("deny".to_string(), "https://deny.example".to_string()),
            ("invalid".to_string(), "https://invalid.example".to_string()),
            ("probe".to_string(), "https://probe.example".to_string()),
        ];
        let decisions = [
            ConsentDecision::Allow,
            ConsentDecision::Deny,
            ConsentDecision::Invalid,
            ConsentDecision::Allow,
        ];
        let probes = std::cell::Cell::new(0usize);
        let results = build_speed_results(&candidates, Some(&decisions), |_url| {
            probes.set(probes.get() + 1);
            Some(12)
        });

        assert_eq!(probes.get(), 2, "只有 allow 项才会真正探测");
        assert_eq!(results[0]["ms"], json!(12));
        assert_eq!(results[1]["reachable"], json!(false));
        assert_eq!(results[1]["reason"], json!("denied"));
        assert_eq!(results[2]["reachable"], json!(false));
        assert_eq!(results[2]["reason"], json!("invalid"));
        assert_eq!(results[3]["ms"], json!(12));
    }

    /// 当前端不支持批量询问：回退逐个探测（单 origin 授权窗照常出现）
    #[test]
    fn unsupported_batch_consent_falls_back_to_probing_all_sources() {
        let candidates = vec![
            ("a".to_string(), "https://a.example".to_string()),
            ("b".to_string(), "https://b.example".to_string()),
        ];
        let probes = std::cell::Cell::new(0usize);
        let results = build_speed_results(&candidates, None, |_url| {
            probes.set(probes.get() + 1);
            Some(5)
        });

        assert_eq!(probes.get(), 2);
        assert!(results.iter().all(|row| row["reachable"] == json!(true)));
        assert!(results.iter().all(|row| row["reason"].is_null()));
    }

    /// 候选源白名单：id/url 唯一、npmmirror 在列、URL 以 https:// 开头
    #[test]
    fn mirror_sources_whitelist_wellformed() {
        assert_eq!(MIRROR_SOURCES.len(), 5);
        let ids: Vec<&str> = MIRROR_SOURCES.iter().map(|(id, _)| *id).collect();
        let urls: Vec<&str> = MIRROR_SOURCES.iter().map(|(_, url)| *url).collect();
        let mut uniq_ids = ids.clone();
        let mut uniq_urls = urls.clone();
        uniq_ids.sort_unstable();
        uniq_urls.sort_unstable();
        uniq_ids.dedup();
        uniq_urls.dedup();
        assert_eq!(uniq_ids.len(), ids.len(), "duplicate source id");
        assert_eq!(uniq_urls.len(), urls.len(), "duplicate source url");
        assert!(ids.contains(&"npmmirror"));
        assert!(urls.contains(&"https://registry.npmmirror.com"));
        assert!(urls.iter().all(|u| u.starts_with("https://")));
    }

    /// sources 排序：可达按耗时升序在前，不可达置后
    #[test]
    fn compare_source_sorts_reachable_first() {
        let slow = json!({ "id": "a", "ms": 500, "reachable": true });
        let fast = json!({ "id": "b", "ms": 120, "reachable": true });
        let down = json!({ "id": "c", "ms": null, "reachable": false });
        let mut v = vec![slow.clone(), down.clone(), fast.clone()];
        v.sort_by(compare_source);
        assert_eq!(v[0]["id"], json!("b"));
        assert_eq!(v[1]["id"], json!("a"));
        assert_eq!(v[2]["id"], json!("c"));
    }

    /// outdated 判定正例：本地落后 → 可更新
    #[test]
    fn outdated_flag_marks_local_behind() {
        assert_eq!(outdated_flag(Some("0.87.0"), "1.0.0"), Some(true));
        assert_eq!(outdated_flag(Some("0.153.4"), "0.154.0"), Some(true));
    }

    /// outdated 判定：本地与最新持平/超前 → 非可更新（超前视为最新，不判旧）
    #[test]
    fn outdated_flag_not_outdated_when_local_latest_or_newer() {
        assert_eq!(outdated_flag(Some("1.0.0"), "1.0.0"), Some(false));
        assert_eq!(outdated_flag(Some("2.0.0"), "1.0.0"), Some(false));
    }

    /// outdated 判定反例：本地版本缺失（未安装 / 探测失败）→ 不判旧（null），
    /// 由行内安装/手动提示兜底，避免把「未知」展示成「可更新」
    #[test]
    fn outdated_flag_unknown_local_is_null() {
        assert_eq!(outdated_flag(None, "1.0.0"), None);
    }

    /// 最新版本来源决策（适配器声明）：opencode standalone → GitHub Releases；
    /// opencode npm-global / 其余 CLI → npm registry
    #[test]
    fn latest_source_decision() {
        let opencode = agents::get("opencode").expect("opencode registered");
        assert!(matches!(
            opencode.latest_source(Some("standalone")),
            Some(LatestSource::GitHub(_))
        ));
        assert!(matches!(
            opencode.latest_source(Some("npm-global")),
            Some(LatestSource::Npm("opencode-ai"))
        ));
        assert!(matches!(
            opencode.latest_source(None),
            Some(LatestSource::Npm(_))
        ));
        let pi = agents::get("pi").expect("pi registered");
        assert!(matches!(
            pi.latest_source(Some("standalone")),
            Some(LatestSource::Npm(_))
        ));
    }
}
