//! 启动运行的纯逻辑：入参解析 / 配置复用判定 / 配置行派生
//!
//! 全部纯函数（native 可确定性断言），wasm 门面（[`super`]）只做读库、写入与
//! 转发启动。把这三件事单独拎出来的理由：它们都是**产品语义**（怎么算「同一个
//! agent 在同一个项目里」、新建配置叫什么名字），而 PTY 生命周期属于 `launch`
//! 域——混在一起就只能靠读代码判断边界。

use crate::config::model::SessionConfig;
use crate::project::ops::project_key;

/// `run.start` 入参（camelCase，与前端命令面同形）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartRequest {
    pub project_id: String,
    pub agent_id: String,
    /// 启动端预算网格（缺省由宿主取默认网格）
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

impl StartRequest {
    /// 解析入参：`projectId` / `agentId` 必填，缺一显性报错（不猜项目、不猜 agent）
    ///
    /// `cols` / `rows` 宽容处理：前端拿不到终端网格（宿主原语不可用）时留空，
    /// 宿主按默认网格 openpty——这不是错误路径，不必为此拒掉整次启动。
    pub fn parse(value: &serde_json::Value) -> Result<Self, String> {
        let text = |key: &str| -> Result<String, String> {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("run.start: {key} required"))
        };
        let size = |key: &str| -> Option<u16> {
            value
                .get(key)
                .and_then(|v| v.as_u64())
                .and_then(|v| u16::try_from(v).ok())
                .filter(|v| *v > 0)
        };
        Ok(Self {
            project_id: text("projectId")?,
            agent_id: text("agentId")?,
            cols: size("cols"),
            rows: size("rows"),
        })
    }
}

/// 在既有配置里找可复用的启动参数
///
/// 判据 = **执行环境 + 工作目录 + 命令** 三者全同：同一项目里同一 agent 反复启动
/// 复用同一条配置（`session_configs` 已降级为「项目 × agent 的启动参数」，不是
/// 独立导航对象）；不同 agent 各自一条，互不覆盖。
///
/// 目录比较按项目身份键（[`project_key`]）而非原样字符串：配置行是**原样落库**
/// 的（`config::ops::normalize` 不规整 `working_dir`），历史行可能带尾部分隔符
/// 或首尾空白（`/srv/app/`），而项目行在落库前已经过
/// `project::ops::normalize_working_dir`。只归一化单侧会让这类历史行永远命中
/// 不了，给同一 (项目, agent) 再建一条配置。`windows` 下的大小写折叠随
/// [`project_key`] 一并生效（比较用，不改写行里存的目录形态）。
pub fn find_config<'a>(
    configs: &'a [SessionConfig],
    environment: &str,
    working_dir: &str,
    command: &str,
) -> Option<&'a SessionConfig> {
    let key = project_key(environment, working_dir);
    configs.iter().find(|config| {
        project_key(&config.environment, &config.working_dir) == key && config.command == command
    })
}

/// 派生一条新的启动配置（项目 × agent）
///
/// 名字取项目名：运行名 = 配置名（`launch` 的命名唯一化以配置名为基名），于是
/// 工作台的运行列表读作「项目名 / 项目名(1)」——同一项目并发两条运行时靠编号
/// 区分，而不是靠 agent 名（agent 已单独成列，重复写进名字只是噪音）。
pub fn new_config(
    id: &str,
    project_name: &str,
    environment: &str,
    wsl_distro: Option<&str>,
    working_dir: &str,
    command: &str,
    now: &str,
) -> SessionConfig {
    SessionConfig {
        id: id.to_string(),
        name: project_name.trim().to_string(),
        environment: environment.to_lowercase(),
        // 发行版只在 wsl2 下保留（与 `project::ops::validate_draft` 同口径：
        // 「linux 项目带发行版」是无意义组合，留进库会让后续分支到处要判）
        wsl_distro: if environment.eq_ignore_ascii_case("wsl2") {
            wsl_distro
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        } else {
            None
        },
        working_dir: working_dir.to_string(),
        command: command.to_string(),
        // 项目里手动启动的运行与「开机自启」无关：自动启动只服务遗留的会话配置
        // 语义，新链路不写 true（否则每次激活都会被拉起来）
        auto_start: false,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(id: &str, env: &str, dir: &str, command: &str) -> SessionConfig {
        SessionConfig {
            id: id.to_string(),
            name: "app".to_string(),
            environment: env.to_string(),
            wsl_distro: None,
            working_dir: dir.to_string(),
            command: command.to_string(),
            auto_start: false,
            created_at: "2026-10-29T00:00:00Z".to_string(),
            updated_at: "2026-10-29T00:00:00Z".to_string(),
        }
    }

    // ==================== 入参解析 ====================

    #[test]
    fn parse_requires_project_and_agent() {
        let ok = StartRequest::parse(&serde_json::json!({
            "projectId": " p-1 ", "agentId": "opencode", "cols": 120, "rows": 40
        }))
        .expect("合法入参");
        assert_eq!(ok.project_id, "p-1", "首尾空白折掉");
        assert_eq!(ok.agent_id, "opencode");
        assert_eq!(ok.cols, Some(120));
        assert_eq!(ok.rows, Some(40));

        for (payload, needle) in [
            (serde_json::json!({ "agentId": "pi" }), "projectId required"),
            (serde_json::json!({ "projectId": "p-1" }), "agentId required"),
            (
                serde_json::json!({ "projectId": "  ", "agentId": "pi" }),
                "projectId required",
            ),
            (
                serde_json::json!({ "projectId": "p-1", "agentId": "" }),
                "agentId required",
            ),
        ] {
            let err = StartRequest::parse(&payload).expect_err("必须拒绝");
            assert!(err.contains(needle), "got: {err}");
        }
    }

    /// 网格缺省/非法只是「按宿主默认网格启动」，不是错误路径
    #[test]
    fn parse_tolerates_missing_or_invalid_grid() {
        let req = StartRequest::parse(&serde_json::json!({
            "projectId": "p-1", "agentId": "pi", "cols": 0, "rows": 70000
        }))
        .expect("网格异常不阻断启动");
        assert_eq!(req.cols, None, "0 列无意义 → 交给宿主默认");
        assert_eq!(req.rows, None, "超出 u16 → 交给宿主默认");

        let none = StartRequest::parse(&serde_json::json!({
            "projectId": "p-1", "agentId": "pi"
        }))
        .expect("缺网格合法");
        assert_eq!(none.cols, None);
        assert_eq!(none.rows, None);
    }

    // ==================== 配置复用 ====================

    /// 三元组全同才算同一条配置；任一不同即另起一条
    #[test]
    fn find_config_matches_environment_dir_and_command() {
        let configs = vec![
            config("c1", "linux", "/srv/app", "opencode"),
            config("c2", "linux", "/srv/app", "pi"),
            config("c3", "wsl2", "/srv/app", "opencode"),
            config("c4", "linux", "/srv/other", "opencode"),
        ];
        assert_eq!(
            find_config(&configs, "LINUX", "/srv/app", "opencode").map(|c| c.id.as_str()),
            Some("c1"),
            "环境大小写不敏感"
        );
        assert_eq!(
            find_config(&configs, "linux", "/srv/app", "pi").map(|c| c.id.as_str()),
            Some("c2"),
            "同目录不同 agent 各自一条"
        );
        assert!(
            find_config(&configs, "linux", "/srv/app", "claude").is_none(),
            "未装过的 agent 不能复用别人的配置"
        );
        assert!(
            find_config(&configs, "wsl2", "/srv/app", "pi").is_none(),
            "跨执行环境不合并"
        );
    }

    #[test]
    fn find_config_empty_pool_returns_none() {
        assert!(find_config(&[], "linux", "/srv/app", "pi").is_none());
    }

    /// 历史配置行原样落库（尾部分隔符 / 首尾空白）：项目目录已归一化，
    /// 两侧不按同一规则比较就会给同一 (项目, agent) 再建一条同义配置
    #[test]
    fn find_config_matches_historical_unnormalized_working_dir() {
        let configs = vec![
            config("c1", "linux", "/srv/app/", "pi"),
            config("c2", "linux", " /srv/app ", "opencode"),
        ];
        assert_eq!(
            find_config(&configs, "linux", "/srv/app", "pi").map(|c| c.id.as_str()),
            Some("c1"),
            "尾部分隔符不影响复用"
        );
        assert_eq!(
            find_config(&configs, "linux", "/srv/app", "opencode").map(|c| c.id.as_str()),
            Some("c2"),
            "首尾空白不影响复用"
        );
    }

    #[test]
    fn find_config_folds_windows_path_case_but_not_on_other_environments() {
        let configs = vec![
            config("c1", "Windows", "C:\\Work", "pi"),
            config("c2", "linux", "/srv/App", "pi"),
        ];
        assert_eq!(
            find_config(&configs, "windows", "c:\\work", "pi").map(|c| c.id.as_str()),
            Some("c1"),
            "windows 下环境与目录大小写不敏感"
        );
        assert!(
            find_config(&configs, "linux", "/srv/app", "pi").is_none(),
            "非 windows 环境不折叠大小写（posix 是两个目录）"
        );
    }

    // ==================== 配置派生 ====================

    #[test]
    fn new_config_takes_project_name_and_agent_binary() {
        let cfg = new_config(
            "cfg-1",
            " 支付重构 ",
            "Linux",
            Some("Ubuntu"),
            "/srv/app",
            "opencode",
            "2026-10-29T01:02:03Z",
        );
        assert_eq!(cfg.id, "cfg-1");
        assert_eq!(cfg.name, "支付重构", "配置名 = 项目名（去首尾空白）");
        assert_eq!(cfg.environment, "linux", "环境取值落小写");
        assert_eq!(cfg.working_dir, "/srv/app");
        assert_eq!(cfg.command, "opencode");
        assert!(!cfg.auto_start, "手动启动不写自启位");
        assert_eq!(cfg.created_at, "2026-10-29T01:02:03Z");
        assert_eq!(cfg.updated_at, "2026-10-29T01:02:03Z");
        assert!(cfg.wsl_distro.is_none(), "非 wsl2 不带发行版");
    }

    #[test]
    fn new_config_keeps_distro_only_for_wsl2() {
        let wsl = new_config(
            "cfg-2",
            "app",
            "wsl2",
            Some(" Ubuntu-22.04 "),
            "/srv/app",
            "pi",
            "2026-10-29T00:00:00Z",
        );
        assert_eq!(wsl.wsl_distro.as_deref(), Some("Ubuntu-22.04"));

        let blank = new_config(
            "cfg-3",
            "app",
            "wsl2",
            Some("   "),
            "/srv/app",
            "pi",
            "2026-10-29T00:00:00Z",
        );
        assert!(blank.wsl_distro.is_none(), "空白发行版按缺失处理");
    }

    /// 派生出的配置会被 [`find_config`] 命中：写入后再次启动复用同一条
    /// （否则每次启动都新建配置，配置表按运行数膨胀）
    #[test]
    fn new_config_is_reusable_by_find_config() {
        let created = new_config(
            "cfg-9",
            "app",
            "linux",
            None,
            "/srv/app",
            "pi",
            "2026-10-29T00:00:00Z",
        );
        let pool = vec![created];
        assert_eq!(
            find_config(&pool, "linux", "/srv/app", "pi").map(|c| c.id.as_str()),
            Some("cfg-9")
        );
    }
}
