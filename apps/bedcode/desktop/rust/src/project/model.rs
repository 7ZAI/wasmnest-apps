//! 项目域模型（ADR 0003「项目取代终端会话成为一级容器」）
//!
//! **项目 = 一个本地目录 + 一个执行环境**，同目录同执行环境只有一条。项目是
//! 一级容器，运行（`session` 域改名后的 `runs` 表）挂在项目下；`session_configs`
//! 降级为「项目 × agent 的启动参数」，不再是独立导航对象。
//!
//! 本文件是纯数据类型 + 值对象（目录归一化、默认名、身份键），不碰宿主也不碰
//! 私有库——native 单测可全覆盖；SQL 与列映射只存在于 [`super::store`]。
//!
//! **wire 形状**：camelCase（前端命令面直接消费）。`environment` 是**执行环境**
//! 三取值（`linux` / `wsl2` / `windows`），不是 Node 环境——词汇表已分家。

use serde::{Deserialize, Serialize};

/// 合法执行环境取值（与 `session_configs.environment` 的 CHECK 集合同源）
pub const VALID_ENVIRONMENTS: &[&str] = &["linux", "wsl2", "windows"];

/// 项目行（插件私有库 `projects` 表）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    /// 执行环境（`linux` / `wsl2` / `windows`）
    pub environment: String,
    /// 仅 `environment = wsl2` 时有值（不参与身份键，见 [`super::ops::project_key`]）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
    /// 工作目录（归一化后的形态，见 [`super::ops::normalize_working_dir`]）
    pub working_dir: String,
    /// 展示名（可重命名，与目录解耦）
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    /// 最近一次打开时间（`project.open` 刷新；列表按它排序）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

/// 建项目请求（`project.create` 入参）
///
/// `name` 缺省 → 取目录末段（[`super::ops::default_project_name`]）。重复添加同目录
/// 同执行环境不报错：返回既有项目并标 `created = false`（用户故事 02「直接被带到
/// 已有项目」）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 项目身份键：`(执行环境, 归一化目录)`——唯一索引与去重都按它
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProjectKey {
    pub environment: String,
    pub working_dir: String,
}

/// 项目派生统计（来自 `runs` 聚合；列表卡片的「活跃运行数 / 最近活动」）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectStats {
    /// 非终态运行数（Running / Starting / WaitingInput / Stopping）
    pub active_runs: usize,
    /// 全部运行数（含历史）
    pub total_runs: usize,
    /// 最近活动时间 = 各运行 `updated_at` 的最大值（RFC3339 字典序可比）
    pub last_activity_at: Option<String>,
    /// 最近一次活动的 agent（取最近更新那条运行的 `agent_id`）
    pub last_agent_id: Option<String>,
}

impl ProjectStats {
    /// 累加一条运行（`active` 由调用方按状态判定，避免本模块依赖会话域状态机）
    pub fn observe(&mut self, agent_id: Option<&str>, updated_at: &str, active: bool) {
        self.total_runs += 1;
        if active {
            self.active_runs += 1;
        }
        let newer = match &self.last_activity_at {
            None => true,
            Some(current) => updated_at > current.as_str(),
        };
        if newer {
            self.last_activity_at = Some(updated_at.to_string());
            self.last_agent_id = agent_id.map(str::to_string);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 统计累加：总数为全量、活跃只数非终态、最近活动取最大时间并带上当时的 agent
    #[test]
    fn stats_accumulate_active_count_and_latest_activity() {
        let mut stats = ProjectStats::default();
        stats.observe(Some("pi"), "2026-10-01T00:00:00Z", false);
        stats.observe(Some("opencode"), "2026-10-03T00:00:00Z", true);
        stats.observe(Some("claude"), "2026-10-02T00:00:00Z", false);

        assert_eq!(stats.total_runs, 3);
        assert_eq!(stats.active_runs, 1, "只有第二条是非终态");
        assert_eq!(
            stats.last_activity_at.as_deref(),
            Some("2026-10-03T00:00:00Z")
        );
        assert_eq!(stats.last_agent_id.as_deref(), Some("opencode"));
    }

    /// 空项目的统计是零值（读不出聚合时视图显示「无活动」，不是伪造时间）
    #[test]
    fn empty_stats_have_no_timestamps() {
        let stats = ProjectStats::default();
        assert_eq!(stats.total_runs, 0);
        assert_eq!(stats.active_runs, 0);
        assert!(stats.last_activity_at.is_none());
        assert!(stats.last_agent_id.is_none());
    }

    /// wire 形状：camelCase，缺省字段不出现（前端按 undefined 判缺）
    #[test]
    fn project_serializes_to_camel_case_without_absent_options() {
        let project = Project {
            id: "p1".to_string(),
            environment: "linux".to_string(),
            wsl_distro: None,
            working_dir: "/srv/app".to_string(),
            name: "app".to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
            updated_at: "2026-10-01T00:00:00Z".to_string(),
            last_opened_at: None,
        };
        let value = serde_json::to_value(&project).expect("serialize");
        assert_eq!(value["workingDir"], "/srv/app");
        assert_eq!(value["createdAt"], "2026-10-01T00:00:00Z");
        assert!(value.get("wslDistro").is_none(), "缺省字段不出现");
        assert!(value.get("lastOpenedAt").is_none());

        let back: Project = serde_json::from_value(value).expect("deserialize");
        assert_eq!(back, project, "可往返");
    }
}
