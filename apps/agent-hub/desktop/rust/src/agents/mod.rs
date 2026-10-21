//! Agent 适配注册表 —— agent 清单与能力的唯一真源（issue #4）
//!
//! 每个 agent 一个适配器模块（`claude` / `codex` / `opencode` / `pi`），声明
//! 身份、探测路径特征、安装/卸载 recipe、最新版本来源、授权目录、Skills 分发
//! 目标与可选能力（供应商 / Usage）。公共域（detect / install / skills）只经
//! [`all`] / [`get`] 访问 agent，不出现具体 id 分支；内置四家与未来新 agent 走
//! 同一套接口——「内置」只是一组注册项，不是运行时特权。
//!
//! 注册顺序即产品展示顺序（概览 / 安装 / 统计）：claude → codex → opencode → pi。
//! 扩展 = 新增一个适配器模块 + 在 `AGENTS` 注册一行 + 前端登记图标/品牌名；
//! 注册是编译期的（单 wasm 插件，不做运行时第三方适配器装载）。
//!
//! 私有差异只允许写在适配器模块内：公共默认实现覆盖 npm-global 的安装/卸载
//! 与 npm registry 版本来源，native / standalone / GitHub Releases 等形态由
//! 适配器覆写。

mod claude;
mod codex;
mod opencode;
mod pi;

use crate::install::recipe::npm_install_cmd;
use crate::providers::contract::ProviderSpec;
use crate::usage::contract::UsageSpec;
use serde_json::{json, Value};

/// 最新版本来源（公共查询 / 失败回落 / 版本比较在 `install::registry`）
pub(crate) enum LatestSource {
    /// npm registry `/<pkg>/latest`
    Npm(&'static str),
    /// GitHub Releases `repos/<owner/repo>/releases/latest`
    GitHub(&'static str),
}

/// 一个 agent 的适配面。能力可选、默认关闭：未声明的 provider / skills /
/// usage 自然不出现在对应域，不产生空写入、空分发目标或空统计槽位。
pub(crate) trait Agent: Sync {
    /// 稳定 id（wire 键、命令入参、状态槽位；列表展示顺序即注册顺序）
    fn id(&self) -> &'static str;
    /// 品牌展示名（不进 i18n；前端缺图标时也用它渲染）
    fn display_name(&self) -> &'static str;
    /// PATH 探测的二进制名（默认等于 id）
    fn binary(&self) -> &'static str {
        self.id()
    }
    /// npm 包名（npm-global 安装/卸载与 npm 版本来源的公共默认）
    fn npm_package(&self) -> Option<&'static str> {
        None
    }
    /// 安装方式路径特征：[(路径片段, method)]，按声明序匹配 PATH 首位
    /// （小写化后的 `/` 分隔路径）；未命中再走公共 npm-global 特征
    fn path_methods(&self) -> &'static [(&'static str, &'static str)] {
        &[]
    }
    /// activate 批量授权的家目录相对段（CLI 配置 / 会话目录）
    fn auth_segments(&self) -> &'static [&'static str] {
        &[]
    }
    /// Skills 分发目标（家目录相对段）；None = 该 agent 无 skills 目录约定
    fn skills_seg(&self) -> Option<&'static str> {
        None
    }
    /// 供应商目标能力（配置格式 / 路径 / 导入由适配器私有实现）；None = 非目标
    fn provider(&self) -> Option<&'static ProviderSpec> {
        None
    }
    /// 使用统计来源能力（JSONL / SQLite 由适配器私有实现）；None = 不入统计
    fn usage(&self) -> Option<&'static UsageSpec> {
        None
    }
    /// 是否出现在安装页（注册项默认参与探测与安装）
    fn installable(&self) -> bool {
        true
    }
    /// 安装/更新 recipe：返回 `(脚本, action)`；action 供 UI 展示
    fn install_recipe(
        &self,
        _method: &str,
        installed: bool,
        use_mirror: bool,
    ) -> Result<(String, &'static str), String> {
        npm_install_recipe(self, installed, use_mirror)
    }
    /// 卸载 recipe；method 来自探测状态而非前端传参
    fn uninstall_recipe(&self, method: &str, _windows: bool) -> Result<String, String> {
        npm_uninstall_recipe(self, method)
    }
    /// 安装/更新是否需要 node 环境（原生命令 / 自带更新器的 standalone 不需要）
    fn install_requires_node(&self, _method: &str) -> bool {
        true
    }
    /// 卸载是否需要 node 环境（npm-global 依赖 npm，其余走 CLI 自身命令）
    fn uninstall_requires_node(&self, method: &str) -> bool {
        method == "npm-global"
    }
    /// 最新版本来源（默认 npm 包；standalone 等私有形态由适配器覆写）
    fn latest_source(&self, _method: Option<&str>) -> Option<LatestSource> {
        self.npm_package().map(LatestSource::Npm)
    }
}

/// 编译期注册表（顺序 = 产品展示顺序，行为等价的一部分）
static AGENTS: [&'static dyn Agent; 4] =
    [&claude::Claude, &codex::Codex, &opencode::Opencode, &pi::Pi];

/// 全部注册项（按展示顺序）
pub(crate) fn all() -> &'static [&'static dyn Agent] {
    &AGENTS
}

/// 按稳定 id 取适配器；未知 id 返回 None（由调用方 fail-visible 拒绝）
pub(crate) fn get(id: &str) -> Option<&'static dyn Agent> {
    all().iter().copied().find(|a| a.id() == id)
}

/// 公共 npm-global 安装 recipe（镜像开关追加 `--registry`）
pub(super) fn npm_install_recipe<A: Agent + ?Sized>(
    agent: &A,
    installed: bool,
    use_mirror: bool,
) -> Result<(String, &'static str), String> {
    let pkg = agent
        .npm_package()
        .ok_or_else(|| format!("no install recipe for cli: {}", agent.id()))?;
    Ok((
        npm_install_cmd(pkg, use_mirror),
        if installed { "update" } else { "install" },
    ))
}

/// 公共 npm-global 卸载 recipe（npm 条目本地卸载，与镜像无关）
pub(super) fn npm_uninstall_recipe<A: Agent + ?Sized>(
    agent: &A,
    method: &str,
) -> Result<String, String> {
    if method != "npm-global" {
        return Err(format!(
            "unsupported uninstall method: {} / {method}",
            agent.id()
        ));
    }
    let pkg = agent
        .npm_package()
        .ok_or_else(|| format!("no uninstall recipe for cli: {}", agent.id()))?;
    Ok(format!("npm uninstall -g {pkg}"))
}

/// 与 agent 无关、但会随 activate 批量申请的家目录相对段（共享目录）：
/// 技能库 `.agents`、npm 源 `.npmrc`、claude 当前项目配置与 usage 会话真源。
/// 宿主第一方清单已免审的目录（`.claude/skills` / `.pi/agent/skills` /
/// 自身 runs 目录）不在此列。
const SHARED_AUTH_SEGS: [&str; 4] = [".agents", ".npmrc", ".claude.json", ".claude/projects"];

/// 批量授权目录清单：注册表适配器声明的配置/会话目录 + 共享目录，
/// 全部为家目录绝对路径前缀（一次弹窗覆盖所有 CLI 与自身域）
pub(crate) fn auth_dirs(home: &str) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    for agent in all() {
        for seg in agent.auth_segments() {
            dirs.push(format!("{home}/{seg}"));
        }
    }
    for seg in SHARED_AUTH_SEGS {
        dirs.push(format!("{home}/{seg}"));
    }
    dirs
}

/// `list-agents` 命令载荷：注册表派生的 id / 展示名 / 能力（不暴露路径与命令）
pub(crate) fn describe() -> Value {
    let agents: Vec<Value> = all()
        .into_iter()
        .map(|a| {
            json!({
                "id": a.id(),
                "displayName": a.display_name(),
                "capabilities": {
                    "install": a.installable(),
                    "provider": a.provider().is_some(),
                    "skills": a.skills_seg().is_some(),
                    "usage": a.usage().is_some(),
                },
            })
        })
        .collect();
    json!({ "agents": agents })
}

// ==================== Tests（注册表契约） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 内置集合与展示顺序：行为等价的一部分（概览/安装/统计同序）
    #[test]
    fn registry_has_builtin_four_in_display_order() {
        let ids: Vec<&str> = all().iter().map(|a| a.id()).collect();
        assert_eq!(ids, vec!["claude", "codex", "opencode", "pi"]);
    }

    /// 注册表完整性：id 唯一、展示名非空、二进制名非空
    #[test]
    fn registry_entries_are_complete_and_unique() {
        let agents = all();
        let mut ids: Vec<&str> = agents.iter().map(|a| a.id()).collect();
        ids.sort_unstable();
        let unique = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), unique, "duplicate agent id");
        for a in all() {
            assert!(!a.id().is_empty(), "empty agent id");
            assert!(!a.display_name().is_empty(), "{} display name", a.id());
            assert!(!a.binary().is_empty(), "{} binary", a.id());
        }
    }

    /// get：每个注册 id 可解析；未知/空 id 返回 None（由调用方 fail-visible）
    #[test]
    fn get_resolves_registered_ids_only() {
        for a in all() {
            assert_eq!(get(a.id()).map(|x| x.id()), Some(a.id()));
        }
        assert!(get("gemini").is_none());
        assert!(get("").is_none());
    }

    /// 授权目录：注册表声明 + 共享目录 = 8 条、全局唯一、不含宿主免审目录
    #[test]
    fn auth_dirs_aggregate_registry_and_shared() {
        let dirs = auth_dirs("/home/u");
        assert_eq!(dirs.len(), 8);
        assert!(dirs.iter().all(|d| d.starts_with("/home/u/")));
        let mut unique = dirs.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), dirs.len(), "duplicate auth dir");

        assert!(dirs.iter().any(|d| d.ends_with("/.codex")));
        assert!(dirs.iter().any(|d| d.ends_with("/.pi")));
        assert!(dirs.iter().any(|d| d.ends_with("/.config/opencode")));
        assert!(dirs.iter().any(|d| d.ends_with("/.local/share/opencode")));
        // usage 扫描的 claude 会话真源：不随宿主第一方免询（用户内容），须授权
        assert!(dirs.iter().any(|d| d.ends_with("/.claude/projects")));
        assert!(dirs.iter().any(|d| d.ends_with("/.claude.json")));
        // 宿主第一方清单已免审的目录不进申请列
        assert!(dirs.iter().all(|d| !d.contains("/.claude/skills")));
        assert!(dirs
            .iter()
            .all(|d| !d.contains("/.wasmnest/agent-hub/runs")));
    }

    /// Skills 目标由能力派生：claude / pi 声明目录，codex / opencode 不声明
    #[test]
    fn skills_targets_come_from_capability() {
        let targets: Vec<(&str, &str)> = all()
            .iter()
            .filter_map(|a| a.skills_seg().map(|seg| (a.id(), seg)))
            .collect();
        assert_eq!(
            targets,
            vec![("claude", ".claude/skills"), ("pi", ".pi/agent/skills")]
        );
    }

    /// list-agents wire：顺序 = 注册表；能力形状固定（install/provider/skills/usage）
    #[test]
    fn describe_wire_shape_matches_registry() {
        let out = describe();
        let agents = out["agents"].as_array().expect("agents array");
        let ids: Vec<&str> = agents
            .iter()
            .map(|a| a["id"].as_str().expect("id"))
            .collect();
        assert_eq!(ids, vec!["claude", "codex", "opencode", "pi"]);

        let first = &agents[0];
        assert_eq!(first["displayName"], json!("Claude Code"));
        for key in ["install", "provider", "skills", "usage"] {
            assert!(
                first["capabilities"][key].is_boolean(),
                "capability {key} must be boolean"
            );
        }
        // 当前四家的能力事实（供应商 / Usage 全支持；Skills 仅 claude / pi）
        for (i, a) in agents.iter().enumerate() {
            assert_eq!(a["capabilities"]["install"], json!(true));
            assert_eq!(a["capabilities"]["provider"], json!(true));
            assert_eq!(a["capabilities"]["usage"], json!(true));
            assert_eq!(a["capabilities"]["skills"], json!(i == 0 || i == 3));
        }
    }

    /// 供应商目标由注册表派生：四家均为目标；视图成对声明（当前 claude / codex），
    /// 仅 codex 不参与 key 解析（只写 env 变量名）
    #[test]
    fn provider_targets_are_registry_derived() {
        let ids: Vec<&str> = all()
            .iter()
            .filter(|a| a.provider().is_some())
            .map(|a| a.id())
            .collect();
        assert_eq!(ids, vec!["claude", "codex", "opencode", "pi"]);

        let mut view_keys: Vec<&str> = Vec::new();
        for agent in all() {
            let spec = agent.provider().expect("provider target");
            // 视图键与视图函数必须成对（成对声明才能上 wire）
            assert_eq!(
                spec.view_key.is_some(),
                spec.view.is_some(),
                "{} view_key/view pair",
                agent.id()
            );
            if let Some(key) = spec.view_key {
                view_keys.push(key);
            }
        }
        assert_eq!(view_keys, vec!["claude", "codex"]);
        for agent in all() {
            let spec = agent.provider().expect("provider target");
            assert_eq!(
                spec.requires_key,
                agent.id() != "codex",
                "{} requires_key",
                agent.id()
            );
        }
        // source 模式只对有配置直拷能力的目标开放（codex 无 key 可拷）
        assert!(all()
            .iter()
            .find(|a| a.id() == "codex")
            .and_then(|a| a.provider())
            .expect("codex provider")
            .source_key
            .is_none());
    }

    /// 反向导入顺序：同名冲突时先者有名字优先权（重构前 pi → opencode）
    #[test]
    fn provider_import_order_is_declared() {
        let mut importers: Vec<(u8, &str)> = Vec::new();
        for agent in all() {
            if let Some(spec) = agent.provider() {
                if spec.import.is_some() {
                    importers.push((spec.import_rank, agent.id()));
                }
            }
        }
        importers.sort_by_key(|(rank, _)| *rank);
        let ids: Vec<&str> = importers.into_iter().map(|(_, id)| id).collect();
        assert_eq!(ids, vec!["pi", "opencode"]);
    }

    /// 使用统计来源由注册表派生：四家均入统计；JSONL 源必有解析器，
    /// SQLite 源必有取数引擎（两者互斥），来源落点与重构前一致
    #[test]
    fn usage_sources_are_registry_derived() {
        use crate::usage::contract::UsageSource;

        let mut ids: Vec<&str> = Vec::new();
        for agent in all() {
            let Some(spec) = agent.usage() else {
                continue;
            };
            ids.push(agent.id());
            match spec.source {
                UsageSource::Jsonl(seg) => {
                    assert!(seg.starts_with('.'), "{} jsonl seg", agent.id());
                    assert!(
                        spec.parse_jsonl.is_some(),
                        "{} jsonl source needs parser",
                        agent.id()
                    );
                    assert!(spec.sqlite.is_none(), "{} jsonl has no sqlite", agent.id());
                }
                UsageSource::Sqlite(seg) => {
                    assert!(seg.starts_with('.'), "{} sqlite seg", agent.id());
                    assert!(
                        spec.sqlite.is_some(),
                        "{} sqlite source needs engine",
                        agent.id()
                    );
                    assert!(
                        spec.parse_jsonl.is_none(),
                        "{} sqlite has no jsonl parser",
                        agent.id()
                    );
                }
            }
        }
        assert_eq!(ids, vec!["claude", "codex", "opencode", "pi"]);

        let source = |id: &str| {
            all()
                .iter()
                .find(|a| a.id() == id)
                .and_then(|a| a.usage())
                .map(|s| s.source)
                .expect("usage source")
        };
        assert!(matches!(
            source("claude"),
            UsageSource::Jsonl(".claude/projects")
        ));
        assert!(matches!(
            source("codex"),
            UsageSource::Jsonl(".codex/sessions")
        ));
        assert!(matches!(
            source("pi"),
            UsageSource::Jsonl(".pi/agent/sessions")
        ));
        match source("opencode") {
            UsageSource::Sqlite(seg) => assert_eq!(seg, crate::usage_sqlite::DB_REL),
            UsageSource::Jsonl(_) => panic!("opencode must be a sqlite source"),
        }
    }

    /// 自定义来源嗅探顺序（同名样式冲突时先者有优先权）：pi 先于 claude；
    /// 只有 claude 声明了配置权威的活跃会话钩子
    #[test]
    fn usage_policies_are_declared() {
        let mut sniffs: Vec<(u8, &str)> = Vec::new();
        let mut active: Vec<&str> = Vec::new();
        for agent in all() {
            let Some(spec) = agent.usage() else {
                continue;
            };
            if spec.sniff.is_some() {
                sniffs.push((spec.sniff_rank, agent.id()));
            }
            if spec.active_session.is_some() {
                active.push(agent.id());
            }
        }
        sniffs.sort_by_key(|(rank, _)| *rank);
        let sniff_ids: Vec<&str> = sniffs.into_iter().map(|(_, id)| id).collect();
        assert_eq!(sniff_ids, vec!["pi", "claude"]);
        assert_eq!(active, vec!["claude"]);
    }

    /// 契约：注册表 id 集合 == 探测状态 `clis` 键集合（含顺序）
    #[test]
    fn detect_state_slots_match_registry() {
        let state = crate::detect::default_clis();
        let keys: Vec<&str> = state
            .as_object()
            .expect("clis object")
            .keys()
            .map(|k| k.as_str())
            .collect();
        let ids: Vec<&str> = all().iter().map(|a| a.id()).collect();
        assert_eq!(keys, ids);
    }
}
