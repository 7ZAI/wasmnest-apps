//! 项目域纯逻辑：目录归一化 / 去重键 / 默认名 / 视图派生 / 排序
//!
//! 全部是纯函数（native 可确定性断言），wasm 门面只做搬运。
//!
//! **归一化的边界（诚实记账）**：插件侧拿不到 `fs` 的 realpath（`host-fs` 无
//! canonicalize，且项目创建时目录可能还不存在），所以去重是**文本级**的：
//! 去首尾空白 + 去末尾分隔符（根目录除外）+ `windows` 执行环境下大小写折叠。
//! 不做软链解析、不做 `..` 折叠——那需要真实文件系统语义，属于宿主侧未来能力，
//! 不在本域用猜测代替。
//!
//! **存什么、比什么分开**：项目行里存用户给的目录形态（启动命令要能直接用），
//! 唯一索引比较的是 [`project_key`] 的归一化形态。两者不同时以归一化形态判重。

use super::model::{Project, ProjectDraft, ProjectKey, ProjectStats, VALID_ENVIRONMENTS};

/// 目录归一化：去首尾空白 + 去末尾分隔符（根目录保留）
///
/// `"/srv/app/"` → `"/srv/app"`；`"C:\\work\\"` → `"C:\\work"`；`"/"` → `"/"`。
/// 反斜杠与正斜杠**不互换**（Windows 与 posix 路径各自保留原形）。
pub fn normalize_working_dir(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // 根目录：`/`、`\`、`C:\`、`C:/` 这类「盘符 + 单个分隔符」保持原样
    let stripped = trimmed.trim_end_matches(['/', '\\']);
    if stripped.is_empty() {
        // 全是分隔符 → 保留一个（posix 根）
        return trimmed.chars().next().map(String::from).unwrap_or_default();
    }
    if stripped.len() == 2 && stripped.ends_with(':') {
        // 裸 `C:` 在 Windows 上是「当前盘目录」，与盘根 `C:\` 语义不同：保持原样
        if trimmed.len() == stripped.len() {
            return stripped.to_string();
        }
        // `C:\` / `C:/` 已带分隔符：去掉重复后补回同一个
        return format!("{}{}", stripped, separator_of(trimmed));
    }
    stripped.to_string()
}

/// 原串使用的分隔符（缺省 `/`）
fn separator_of(raw: &str) -> char {
    if raw.contains('\\') {
        '\\'
    } else {
        '/'
    }
}

/// 项目身份键：执行环境 + 归一化目录（`windows` 下大小写折叠）
///
/// 大小写折叠只作用于**比较**，不改写项目行里存的目录形态：Windows 路径
/// `C:\Work` 与 `c:\work` 是同一目录，但启动命令要按用户给的形态执行。
pub fn project_key(environment: &str, working_dir: &str) -> ProjectKey {
    let dir = normalize_working_dir(working_dir);
    let dir = if environment.eq_ignore_ascii_case("windows") {
        dir.to_lowercase()
    } else {
        dir
    };
    ProjectKey {
        environment: environment.to_lowercase(),
        working_dir: dir,
    }
}

/// 默认项目名：目录末段；取不到时退回整串，再退回 `"project"`
pub fn default_project_name(working_dir: &str) -> String {
    let normalized = normalize_working_dir(working_dir);
    let last = normalized
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty() && *segment != ".");
    match last {
        // `C:\` 归一化后是 `C:\`，末段是 `C:`——不是好名字，退回整串
        Some(segment) if segment.len() > 2 || !segment.ends_with(':') => segment.to_string(),
        _ if !normalized.is_empty() => normalized.clone(),
        _ => "project".to_string(),
    }
}

/// 校验后的建项目入参
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProjectDraft {
    pub environment: String,
    pub wsl_distro: Option<String>,
    /// 归一化后的目录（写库形态）
    pub working_dir: String,
    pub name: String,
}

/// 校验建项目入参：环境三取值、目录非空、名字缺省取目录末段
///
/// `wsl_distro` 只在 `wsl2` 下保留（其他环境清空——留着会让「linux 项目带发行版」
/// 这种无意义组合进库，后续分支到处要判）
pub fn validate_draft(draft: &ProjectDraft) -> Result<ValidatedProjectDraft, String> {
    let environment = draft
        .environment
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "project environment required".to_string())?
        .to_lowercase();
    if !VALID_ENVIRONMENTS.contains(&environment.as_str()) {
        return Err(format!(
            "invalid project environment: {environment:?} (expected one of {VALID_ENVIRONMENTS:?})"
        ));
    }
    let working_dir = normalize_working_dir(draft.working_dir.as_deref().unwrap_or_default());
    if working_dir.is_empty() {
        return Err("project workingDir required".to_string());
    }
    let name = draft
        .name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_project_name(&working_dir));
    let wsl_distro = if environment == "wsl2" {
        draft
            .wsl_distro
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    Ok(ValidatedProjectDraft {
        environment,
        wsl_distro,
        working_dir,
        name,
    })
}

/// 项目 → 对外视图（列表卡片一行：项目字段 + 派生统计）
///
/// 派生字段名与项目字段同层（`activeRuns` / `runCount` / `lastActivityAt` /
/// `lastAgentId`），前端一次读完即可渲染，不必二次聚合。
pub fn view_json(project: &Project, stats: &ProjectStats) -> serde_json::Value {
    let mut value = serde_json::to_value(project).expect("Project 可序列化");
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "activeRuns".to_string(),
            serde_json::json!(stats.active_runs),
        );
        obj.insert("runCount".to_string(), serde_json::json!(stats.total_runs));
        obj.insert(
            "lastActivityAt".to_string(),
            stats
                .last_activity_at
                .as_ref()
                .map(|v| serde_json::json!(v))
                .unwrap_or(serde_json::Value::Null),
        );
        obj.insert(
            "lastAgentId".to_string(),
            stats
                .last_agent_id
                .as_ref()
                .map(|v| serde_json::json!(v))
                .unwrap_or(serde_json::Value::Null),
        );
    }
    value
}

/// 列表排序：最近活动（打开时间，缺省取更新时间）倒序 → 名字 → id
///
/// 时间戳是秒级 RFC3339（定长），字典序即时间序；同刻用名字与 id 兜底保证稳定，
/// 不让列表顺序随 `HashMap` 迭代序抖动。
pub fn sort_projects(projects: &mut [Project]) {
    projects.sort_by(|a, b| {
        let a_at = a.last_opened_at.as_deref().unwrap_or(&a.updated_at);
        let b_at = b.last_opened_at.as_deref().unwrap_or(&b.updated_at);
        b_at.cmp(a_at)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// 在既有项目里找去重目标（按 [`project_key`] 比较；返回第一条命中）
pub fn find_duplicate<'a>(projects: &'a [Project], key: &ProjectKey) -> Option<&'a Project> {
    projects
        .iter()
        .find(|p| &project_key(&p.environment, &p.working_dir) == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::model::Project;

    fn project(id: &str, env: &str, dir: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            environment: env.to_string(),
            wsl_distro: None,
            working_dir: dir.to_string(),
            name: name.to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
            updated_at: "2026-10-01T00:00:00Z".to_string(),
            last_opened_at: None,
        }
    }

    /// 末尾分隔符与空白被折掉，根目录与盘根保留
    #[test]
    fn normalize_strips_trailing_separators_but_keeps_roots() {
        assert_eq!(normalize_working_dir("  /srv/app/  "), "/srv/app");
        assert_eq!(normalize_working_dir("/srv/app///"), "/srv/app");
        assert_eq!(normalize_working_dir("C:\\work\\"), "C:\\work");
        assert_eq!(normalize_working_dir("C:/work/"), "C:/work");
        assert_eq!(normalize_working_dir("/"), "/");
        assert_eq!(normalize_working_dir("\\"), "\\");
        assert_eq!(normalize_working_dir("C:\\"), "C:\\");
        // 裸盘符 = 当前盘目录，不能被悄悄改写成盘根
        assert_eq!(normalize_working_dir("C:"), "C:");
        assert_eq!(normalize_working_dir(""), "");
        assert_eq!(normalize_working_dir("   "), "");
    }

    /// 去重键：同目录同环境相等；跨环境不等；windows 折叠大小写、posix 不折叠
    #[test]
    fn project_key_merges_same_dir_and_splits_across_environments() {
        assert_eq!(
            project_key("linux", "/srv/app/"),
            project_key("linux", "/srv/app")
        );
        assert_ne!(
            project_key("linux", "/srv/app"),
            project_key("wsl2", "/srv/app"),
            "同一目录在不同执行环境下是两个项目"
        );
        assert_eq!(
            project_key("windows", "C:\\Work"),
            project_key("windows", "c:\\work"),
            "Windows 路径大小写不敏感"
        );
        assert_ne!(
            project_key("linux", "/srv/App"),
            project_key("linux", "/srv/app"),
            "posix 大小写敏感，不得折叠"
        );
        assert_eq!(project_key("LINUX", "/srv/app").environment, "linux");
    }

    /// 默认名取目录末段；根 / 盘根退回整串；空目录退回 project
    #[test]
    fn default_name_uses_last_segment() {
        assert_eq!(default_project_name("/srv/proj/"), "proj");
        assert_eq!(default_project_name("C:\\work\\bedcode"), "bedcode");
        assert_eq!(default_project_name("/"), "/");
        assert_eq!(default_project_name("C:\\"), "C:\\");
        assert_eq!(default_project_name(""), "project");
    }

    /// 校验：环境必需且限三值；目录必需；名字缺省走默认；wslDistro 只在 wsl2 保留
    #[test]
    fn validate_draft_enforces_environment_and_dir() {
        let ok = validate_draft(&ProjectDraft {
            environment: Some(" WSL2 ".to_string()),
            wsl_distro: Some("Ubuntu".to_string()),
            working_dir: Some("/srv/app/".to_string()),
            name: None,
        })
        .expect("合法草稿");
        assert_eq!(ok.environment, "wsl2");
        assert_eq!(ok.working_dir, "/srv/app");
        assert_eq!(ok.name, "app", "名字缺省取目录末段");
        assert_eq!(ok.wsl_distro.as_deref(), Some("Ubuntu"));

        let linux = validate_draft(&ProjectDraft {
            environment: Some("linux".to_string()),
            wsl_distro: Some("Ubuntu".to_string()),
            working_dir: Some("/srv/app".to_string()),
            name: Some("  支付重构  ".to_string()),
        })
        .expect("合法草稿");
        assert_eq!(linux.name, "支付重构", "名字去首尾空白");
        assert!(linux.wsl_distro.is_none(), "非 wsl2 不带发行版");

        let missing_env = validate_draft(&ProjectDraft {
            environment: None,
            ..Default::default()
        })
        .expect_err("缺环境必须报错");
        assert!(
            missing_env.contains("environment required"),
            "got: {missing_env}"
        );

        let bad_env = validate_draft(&ProjectDraft {
            environment: Some("solaris".to_string()),
            working_dir: Some("/srv".to_string()),
            ..Default::default()
        })
        .expect_err("未知环境必须报错");
        assert!(
            bad_env.contains("invalid project environment"),
            "got: {bad_env}"
        );

        let missing_dir = validate_draft(&ProjectDraft {
            environment: Some("linux".to_string()),
            working_dir: Some("   ".to_string()),
            ..Default::default()
        })
        .expect_err("空目录必须报错");
        assert!(
            missing_dir.contains("workingDir required"),
            "got: {missing_dir}"
        );
    }

    /// 视图：项目字段 + 派生字段同层；无活动时时间是 null（键必须在）
    #[test]
    fn view_carries_project_fields_and_stats() {
        let mut p = project("p1", "linux", "/srv/app", "app");
        p.last_opened_at = Some("2026-10-05T00:00:00Z".to_string());
        let mut stats = ProjectStats::default();
        stats.observe(Some("pi"), "2026-10-04T00:00:00Z", true);

        let view = view_json(&p, &stats);
        assert_eq!(view["id"], "p1");
        assert_eq!(view["workingDir"], "/srv/app");
        assert_eq!(view["lastOpenedAt"], "2026-10-05T00:00:00Z");
        assert_eq!(view["activeRuns"], 1);
        assert_eq!(view["runCount"], 1);
        assert_eq!(view["lastActivityAt"], "2026-10-04T00:00:00Z");
        assert_eq!(view["lastAgentId"], "pi");

        let empty = view_json(&p, &ProjectStats::default());
        assert!(
            empty.get("lastActivityAt").is_some_and(|v| v.is_null()),
            "无活动 = null（键必须在）: {empty}"
        );
        assert!(empty.get("lastAgentId").is_some_and(|v| v.is_null()));
    }

    /// 排序：最近打开优先 → 名字 → id
    #[test]
    fn sort_prefers_recent_activity_then_name_then_id() {
        let mut older = project("p-old", "linux", "/srv/a", "alpha");
        older.updated_at = "2026-10-01T00:00:00Z".to_string();
        let mut newer = project("p-new", "linux", "/srv/b", "beta");
        newer.last_opened_at = Some("2026-10-09T00:00:00Z".to_string());
        let mut same_a = project("p-a", "linux", "/srv/c", "same");
        same_a.updated_at = "2026-10-05T00:00:00Z".to_string();
        let mut same_b = project("p-b", "linux", "/srv/d", "same");
        same_b.updated_at = "2026-10-05T00:00:00Z".to_string();

        let mut all = vec![older, same_b, newer, same_a];
        sort_projects(&mut all);
        let ids: Vec<&str> = all.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["p-new", "p-a", "p-b", "p-old"]);
    }

    /// 去重命中：按归一化键比较（末尾斜杠 / windows 大小写都算同一个）
    #[test]
    fn find_duplicate_matches_on_normalized_key() {
        let projects = vec![project("p1", "windows", "C:\\Work", "work")];
        let key = project_key("windows", "c:\\work\\");
        assert_eq!(
            find_duplicate(&projects, &key).map(|p| p.id.as_str()),
            Some("p1")
        );
        let other = project_key("wsl2", "C:\\Work");
        assert!(find_duplicate(&projects, &other).is_none());
    }
}
