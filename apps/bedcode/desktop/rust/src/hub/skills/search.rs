//! skills.sh 联网搜索（`agent.search-skills`）
//!
//! 数据源 = skills.sh 搜索 API（`GET /api/search?q=`，与 `npx skills find`
//! 同源端点）。流程照 pi `find-skills` skill 描述的做法机器化：
//! 1. 精确查询一次；
//! 2. 精确命中不足（< [`MIN_EXACT_RESULTS`]）且查询为 2–6 个词时，逐词剔除的
//!    近似子查询再查（「换个说法再试」），按「命中次数 → 最好名次 → 安装量」
//!    合并（与 CLI 的 fallback 合并口径一致）；
//! 3. 结果上限 [`MAX_RESULTS`] 条。
//!
//! **不做推荐判断**：安装数 / 来源原样回前端，可信度口径（≥1K 优先、<100 谨慎、
//! 官方来源更可靠）由 UI 呈现——这里只取数与归一，不在 guest 里编造结论。
//!
//! 网络：host-http 非流式 GET（与 [`super::github`] 同一套 `http_fetch`），失败
//! 以 `error` 字段回前端（不静默给空结果）。

use super::github::http_get;
use serde_json::{json, Value};
use std::collections::HashSet;
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 搜索接口基地址（与 `npx skills find` 同一端点）
pub(super) const SEARCH_API: &str = "https://skills.sh/api/search";
/// 精确命中少于此数才走逐词近似合并（CLI 同值）
pub(super) const MIN_EXACT_RESULTS: usize = 10;
/// 逐词近似只对 2–6 个词的查询启用（CLI 同界限）
pub(super) const MAX_FALLBACK_TERMS: usize = 6;
/// 单次搜索最多返回条数（CLI 同值）
pub(super) const MAX_RESULTS: usize = 25;
/// 近似子查询上限：每多一条就是一次同步 host-http 往返，取前三条足够覆盖
/// 「多词里有一个词是噪音」的常见情况
pub(super) const MAX_FALLBACK_QUERIES: usize = 3;
/// 网络文本字段上限（防超长标题撑破 UI；超长即截断，不做静默丢弃）
pub(super) const FIELD_CHAR_CAP: usize = 200;

/// 归一后的单条搜索结果（前端 `SkillSearchHit` 同构）
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchHit {
    /// `owner/repo/skill`（skills.sh 详情页路径）
    pub id: String,
    /// 展示名（frontmatter `name`，可能是自由文本如 `react:components`）
    pub name: String,
    /// `owner/repo`
    pub source: String,
    /// 仓库内 skill 名（sanitize 后，安装解析按此匹配目录 / frontmatter）
    pub skill_id: String,
    /// 安装量（可信度原始依据）
    pub installs: u64,
}

impl SearchHit {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "skillId": self.skill_id,
            "installs": self.installs,
            "install": format!("{}@{}", self.source, self.skill_id),
            "url": format!("https://skills.sh/{}", self.id),
        })
    }
}

// ==================== 纯函数 ====================

/// 查询串百分号编码（保留 unreserved 字符，空格编 `%20`）
pub(crate) fn encode_query(q: &str) -> String {
    let mut out = String::new();
    for b in q.trim().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 搜索请求 URL
pub(crate) fn search_url(query: &str) -> String {
    format!("{SEARCH_API}?q={}", encode_query(query))
}

/// 查询拆词（空白折叠；空查询 → 空列表）
pub(crate) fn query_terms(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_string).collect()
}

/// 逐词剔除的近似子查询（每个词各被剔除一次，截断到
/// [`MAX_FALLBACK_QUERIES`]）
pub(crate) fn fallback_queries(terms: &[String]) -> Vec<String> {
    terms
        .iter()
        .enumerate()
        .take(MAX_FALLBACK_QUERIES)
        .map(|(skip, _)| {
            terms
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != skip)
                .map(|(_, t)| t.as_str())
                .collect::<Vec<&str>>()
                .join(" ")
        })
        .filter(|q| !q.trim().is_empty())
        .collect()
}

/// 网络文本归一：去控制字符（含换行）、空白折叠、截断到 [`FIELD_CHAR_CAP`]
fn clean_text(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = 0usize;
    let mut prev_space = false;
    for c in raw.chars() {
        let c = if c.is_control() { ' ' } else { c };
        if c.is_whitespace() {
            if !prev_space && chars > 0 {
                out.push(' ');
                chars += 1;
            }
            prev_space = true;
            continue;
        }
        prev_space = false;
        if chars >= FIELD_CHAR_CAP {
            break;
        }
        out.push(c);
        chars += 1;
    }
    out.trim().to_string()
}

/// 搜索 API 响应 → 归一结果（按 `id` 去重保序；缺 `skills` 数组视为响应无效）
pub(crate) fn parse_hits(body: &str) -> Result<Vec<SearchHit>, String> {
    let parsed: Value =
        serde_json::from_str(body).map_err(|e| format!("search response invalid: {e}"))?;
    let arr = parsed
        .get("skills")
        .and_then(Value::as_array)
        .ok_or_else(|| "search response missing `skills` array".to_string())?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut hits = Vec::new();
    for item in arr {
        let field = |key: &str| {
            item.get(key)
                .and_then(Value::as_str)
                .map(clean_text)
                .filter(|s| !s.is_empty())
        };
        let Some(id) = field("id") else { continue };
        let Some(source) = field("source") else {
            continue;
        };
        let skill_id = field("skillId")
            .or_else(|| field("name"))
            .or_else(|| id.rsplit('/').next().map(str::to_string));
        let Some(skill_id) = skill_id else { continue };
        let name = field("name").unwrap_or_else(|| skill_id.clone());
        let installs = item
            .get("installs")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if !seen.insert(id.clone()) {
            continue;
        }
        hits.push(SearchHit {
            id,
            name,
            source,
            skill_id,
            installs,
        });
    }
    Ok(hits)
}

/// 精确结果 + 逐词近似结果合并（CLI 口径：精确在前；近似按命中次数、最好名次、
/// 安装量排序后补齐到 [`MAX_RESULTS`]）
pub(crate) fn merge_fallback(exact: &[SearchHit], partials: &[Vec<SearchHit>]) -> Vec<SearchHit> {
    let seen: HashSet<&str> = exact.iter().map(|h| h.id.as_str()).collect();
    struct Cand<'a> {
        hit: &'a SearchHit,
        hits: usize,
        best_rank: usize,
    }
    let mut cands: Vec<Cand> = Vec::new();
    for list in partials {
        for (rank, hit) in list.iter().enumerate() {
            if seen.contains(hit.id.as_str()) {
                continue;
            }
            match cands.iter_mut().find(|c| c.hit.id == hit.id) {
                Some(c) => {
                    c.hits += 1;
                    c.best_rank = c.best_rank.min(rank);
                }
                None => cands.push(Cand {
                    hit,
                    hits: 1,
                    best_rank: rank,
                }),
            }
        }
    }
    cands.sort_by(|a, b| {
        b.hits
            .cmp(&a.hits)
            .then(a.best_rank.cmp(&b.best_rank))
            .then(b.hit.installs.cmp(&a.hit.installs))
            .then(a.hit.id.cmp(&b.hit.id))
    });
    let mut out: Vec<SearchHit> = exact.iter().take(MAX_RESULTS).cloned().collect();
    let room = MAX_RESULTS.saturating_sub(out.len());
    out.extend(cands.into_iter().take(room).map(|c| c.hit.clone()));
    out
}

// ==================== 命令入口 ====================

/// 单次搜索请求（非 200 视为不可达，交由调用方决定是否降级）
fn fetch_hits(h: &WasmHost, query: &str) -> Result<Vec<SearchHit>, String> {
    let (status, body) = http_get(h, &search_url(query), false)?;
    if status != 200 {
        return Err(format!("skills.sh returned HTTP {status}"));
    }
    parse_hits(&body)
}

fn error_payload(query: &str, error: &str) -> Value {
    json!({
        "query": query,
        "results": [],
        "exactCount": 0,
        "fallback": false,
        "error": error,
    })
}

/// `agent.search-skills`：精确查询 + 逐词近似合并（同步命令，1–4 次往返）
pub(crate) fn search(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("search-skills: missing query"))?;

    let exact = match fetch_hits(h, query) {
        Ok(hits) => hits,
        Err(e) => return Ok(error_payload(query, &e)),
    };

    let terms = query_terms(query);
    let mut results = exact.clone();
    let mut fallback = false;
    if exact.len() < MIN_EXACT_RESULTS && (2..=MAX_FALLBACK_TERMS).contains(&terms.len()) {
        let mut partials: Vec<Vec<SearchHit>> = Vec::new();
        for sub in fallback_queries(&terms) {
            match fetch_hits(h, &sub) {
                Ok(hits) => partials.push(hits),
                // 近似查询失败不降级整体结果：精确命中仍可用
                Err(e) => h.log_debug(&format!("search-skills: fallback `{sub}` failed: {e}")),
            }
        }
        if !partials.is_empty() {
            let merged = merge_fallback(&exact, &partials);
            fallback = merged.len() > exact.len();
            results = merged;
        }
    }
    results.truncate(MAX_RESULTS);
    h.log_info(&format!(
        "search-skills done (query = `{query}`, exact = {}, total = {}, fallback = {fallback})",
        exact.len(),
        results.len()
    ));
    Ok(json!({
        "query": query,
        "results": results.iter().map(SearchHit::to_json).collect::<Vec<Value>>(),
        "exactCount": exact.len(),
        "fallback": fallback,
        "error": Value::Null,
    }))
}

// ==================== Tests（纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(id: &str, installs: u64) -> SearchHit {
        let mut parts = id.split('/');
        let owner = parts.next().unwrap_or("o");
        let repo = parts.next().unwrap_or("r");
        SearchHit {
            id: id.to_string(),
            name: id.rsplit('/').next().unwrap_or("skill").to_string(),
            source: format!("{owner}/{repo}"),
            skill_id: id.rsplit('/').next().unwrap_or("skill").to_string(),
            installs,
        }
    }

    /// 查询编码：空格 → %20，中文按 UTF-8 逐字节编码，unreserved 原样
    #[test]
    fn query_encoding() {
        assert_eq!(encode_query("react performance"), "react%20performance");
        assert_eq!(encode_query("  pr review  "), "pr%20review");
        assert_eq!(encode_query("a/b?c=1"), "a%2Fb%3Fc%3D1");
        assert_eq!(encode_query("测试"), "%E6%B5%8B%E8%AF%95");
        assert_eq!(
            search_url("ui ux"),
            "https://skills.sh/api/search?q=ui%20ux"
        );
    }

    /// 响应解析：去重保序、缺失字段跳过、控制字符清理、安装量缺省 0
    #[test]
    fn parse_response_shape() {
        let body = r#"{"skills":[
            {"id":"vercel-labs/agent-skills/vercel-react-best-practices","source":"vercel-labs/agent-skills","skillId":"vercel-react-best-practices","name":"vercel-react-best-practices","installs":893012},
            {"id":"vercel-labs/agent-skills/vercel-react-best-practices","source":"vercel-labs/agent-skills","skillId":"vercel-react-best-practices","name":"dup","installs":1},
            {"id":"a/b/c","source":"a/b","skillId":"c"},
            {"id":"no-source/x"},
            {"source":"owner/repo","skillId":"x"}
        ]}"#;
        let hits = parse_hits(body).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].id,
            "vercel-labs/agent-skills/vercel-react-best-practices"
        );
        assert_eq!(hits[0].installs, 893012);
        assert_eq!(hits[1].id, "a/b/c");
        assert_eq!(hits[1].installs, 0);

        let multiline =
            r#"{"skills":[{"id":"o/r/s","source":"o/r","skillId":"s","name":"bad\nname\u0007"}]}"#;
        let hits = parse_hits(multiline).unwrap();
        assert_eq!(hits[0].name, "bad name");

        assert!(parse_hits("{}").is_err());
        assert!(parse_hits("not json").is_err());
        assert_eq!(parse_hits(r#"{"skills":[]}"#).unwrap().len(), 0);
    }

    /// 逐词近似：每次剔除一个词，最多 3 条子查询
    #[test]
    fn fallback_queries_drop_one_term() {
        let terms = query_terms("react  native   best practices");
        assert_eq!(terms, vec!["react", "native", "best", "practices"]);
        assert_eq!(
            fallback_queries(&terms),
            vec![
                "native best practices",
                "react best practices",
                "react native practices"
            ]
        );
        assert!(fallback_queries(&query_terms("single")).is_empty());
    }

    /// 合并：精确在前；近似按命中次数 → 名次 → 安装量排序，且不重复
    #[test]
    fn merge_prefers_multi_hits() {
        let exact = vec![hit("o/r/exact", 10)];
        let partials = vec![
            vec![hit("o/r/a", 5), hit("o/r/b", 100)],
            vec![hit("o/r/b", 100), hit("o/r/c", 1)],
            vec![hit("o/r/exact", 10)],
        ];
        let merged = merge_fallback(&exact, &partials);
        assert_eq!(
            merged.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            vec!["o/r/exact", "o/r/b", "o/r/a", "o/r/c"]
        );
    }

    /// 合并上限：不超过 MAX_RESULTS
    #[test]
    fn merge_caps_results() {
        let exact: Vec<SearchHit> = (0..5).map(|i| hit(&format!("o/r/e{i}"), 0)).collect();
        let partial: Vec<SearchHit> = (0..40).map(|i| hit(&format!("o/r/p{i}"), 0)).collect();
        let merged = merge_fallback(&exact, &[partial]);
        assert_eq!(merged.len(), MAX_RESULTS);
        assert_eq!(merged[0].id, "o/r/e0");
    }
}
