//! 项目域门面（ADR 0003：「项目」取代终端会话成为桌面一级容器）
//!
//! 本模块把三件事装配起来：
//! 1. **建表与迁移**：`projects` 表 + `runs` 容器化（[`migrate`]）——激活期在
//!    各域 `ensure_schema` **之前**跑，顺序理由见 `migrate` 模块文档；
//! 2. **命令面实现**：`project.*` 一族（列 / 建 / 打开 / 改名 / 删）；
//! 3. **归属入口**：`ensure_for_directory_via_host`——启动配置的目录 + 执行环境
//!    决定运行落到哪个项目（会话创建编排调用它，见 `launch::create_via_host`）。
//!
//! 失败口径：写面失败**显性**返回给调用方（命令面照原样上抛），不做「查不到就
//! 返回空」的静默降级；读面失败同样显性——项目列表读不出来等于工作台不可用，
//! 伪装成空列表会让用户以为项目被删了。

pub mod migrate;
pub mod model;
pub mod ops;
pub mod store;

use model::ProjectDraft;
#[cfg(target_arch = "wasm32")]
use model::{Project, ProjectStats};

#[cfg(target_arch = "wasm32")]
use migrate::ContainerStore;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::HostPluginDatabase;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::sql_params;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::wasm_host::WasmHost;

#[cfg(target_arch = "wasm32")]
use store::ProjectStore;

/// 运行扩展列（容器迁移补到 `runs` 上；顺序即 DDL 顺序）
///
/// 与 `session::store::SCHEMA` 的全新建表列**必须**一致：全新库走建表，老库走
/// 这里的 `ALTER TABLE ADD COLUMN`，两条路径落下同一组列。
pub const RUN_EXTRA_COLUMNS: &[(&str, &str)] = &[
    ("project_id", "ALTER TABLE runs ADD COLUMN project_id TEXT"),
    ("agent_id", "ALTER TABLE runs ADD COLUMN agent_id TEXT"),
    (
        "agent_session_id",
        "ALTER TABLE runs ADD COLUMN agent_session_id TEXT",
    ),
    ("title", "ALTER TABLE runs ADD COLUMN title TEXT"),
    ("model", "ALTER TABLE runs ADD COLUMN model TEXT"),
    (
        "truncated",
        "ALTER TABLE runs ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "bridge_seen_at",
        "ALTER TABLE runs ADD COLUMN bridge_seen_at TEXT",
    ),
];

/// 任务队列绑定键列（会话 id → 项目 + agent）
pub const TASK_BINDING_COLUMNS: &[(&str, &str)] = &[
    (
        "project_id",
        "ALTER TABLE task_queue ADD COLUMN project_id TEXT",
    ),
    (
        "agent_id",
        "ALTER TABLE task_queue ADD COLUMN agent_id TEXT",
    ),
];

// ==================== 激活期：建表 + 迁移 ====================

/// 建项目表（幂等）
#[cfg(target_arch = "wasm32")]
pub fn ensure_schema_via_host() -> Result<(), String> {
    ProjectStore::ensure_schema(&WasmHost)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn ensure_schema_via_host() -> Result<(), String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 容器迁移（`sessions` → `runs` + 配置 → 项目 + 归属回填 + 任务绑定键）
///
/// 幂等，且必须在 `schema::migrate_via_host` 之后、各域 `ensure_schema` 之前调用
/// （见 [`migrate`] 模块头）。
#[cfg(target_arch = "wasm32")]
pub fn migrate_via_host() -> Result<migrate::ContainerMigrationReport, String> {
    migrate::migrate(
        &WasmHost,
        &crate::config::model::now_rfc3339(),
        crate::config::model::new_config_id,
    )
}

#[cfg(not(target_arch = "wasm32"))]
pub fn migrate_via_host() -> Result<migrate::ContainerMigrationReport, String> {
    Err("project container migration unavailable outside wasm runtime".to_string())
}

// ==================== 读面 ====================

/// 按归一化工作目录找项目 id（桥接 `run-attach` 的目录解析面）
///
/// 不区分执行环境：opencode 只报得出 cwd，环境归属由运行侧裁决（同目录跨环境
/// 是边界形态，候选全部返回——运行按 agent / 绑定状态自证）。返回顺序即存储序。
#[cfg(target_arch = "wasm32")]
pub fn ids_by_working_dir_via_host(working_dir: &str) -> Result<Vec<String>, String> {
    let dir = ops::normalize_working_dir(working_dir);
    if dir.is_empty() {
        return Ok(Vec::new());
    }
    Ok(ProjectStore::all(&WasmHost)?
        .into_iter()
        .filter(|project| project.working_dir == dir)
        .map(|project| project.id)
        .collect())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn ids_by_working_dir_via_host(_working_dir: &str) -> Result<Vec<String>, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 项目列表（派生统计随行；按最近活动倒序）
#[cfg(target_arch = "wasm32")]
pub fn list_via_host() -> Result<serde_json::Value, String> {
    let mut projects = ProjectStore::all(&WasmHost)?;
    let stats = stats_by_project()?;
    ops::sort_projects(&mut projects);
    let views: Vec<serde_json::Value> = projects
        .iter()
        .map(|project| {
            let empty = ProjectStats::default();
            let stats = stats.get(&project.id).unwrap_or(&empty);
            ops::view_json(project, stats)
        })
        .collect();
    Ok(serde_json::json!({ "projects": views }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn list_via_host() -> Result<serde_json::Value, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 单个项目（含派生统计）；未知 id → `None`（调用方按「无此项目」提示，不造半成品）
#[cfg(target_arch = "wasm32")]
pub fn get_via_host(id: &str) -> Result<Option<serde_json::Value>, String> {
    let Some(project) = ProjectStore::get(&WasmHost, id)? else {
        return Ok(None);
    };
    let stats = stats_by_project()?;
    let empty = ProjectStats::default();
    Ok(Some(ops::view_json(
        &project,
        stats.get(id).unwrap_or(&empty),
    )))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn get_via_host(_id: &str) -> Result<Option<serde_json::Value>, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 项目的派生统计（一次遍历运行活动快照；项目数量级与运行数量级都小）
#[cfg(target_arch = "wasm32")]
fn stats_by_project() -> Result<std::collections::BTreeMap<String, ProjectStats>, String> {
    let activity = crate::session::run_activity_via_host()?;
    let mut stats: std::collections::BTreeMap<String, ProjectStats> =
        std::collections::BTreeMap::new();
    for item in activity {
        let Some(project_id) = item.project_id.filter(|v| !v.is_empty()) else {
            // 未归属的历史运行不参与任何项目的统计（迁移已丢弃这批，留作防御）
            continue;
        };
        stats.entry(project_id).or_default().observe(
            item.agent_id.as_deref(),
            &item.updated_at,
            item.active,
        );
    }
    Ok(stats)
}

// ==================== 写面（命令面 project.*） ====================

/// 建项目：同目录同执行环境已存在 → 直接返回既有项目并刷新打开时间
///
/// 返回 `{project, created}`：`created = false` 让前端知道「被带到已有项目」
/// （用户故事 02），文案由界面决定。
#[cfg(target_arch = "wasm32")]
pub fn create_via_host(draft: &ProjectDraft) -> Result<serde_json::Value, String> {
    let validated = ops::validate_draft(draft)?;
    let key = ops::project_key(&validated.environment, &validated.working_dir);
    let projects = ProjectStore::all(&WasmHost)?;
    if let Some(existing) = ops::find_duplicate(&projects, &key) {
        let opened = touch_opened(&existing.id)?;
        return Ok(serde_json::json!({ "project": opened, "created": false }));
    }
    let now = crate::config::model::now_rfc3339();
    let project = Project {
        id: crate::config::model::new_config_id()?,
        environment: validated.environment,
        wsl_distro: validated.wsl_distro,
        working_dir: validated.working_dir,
        name: validated.name,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: Some(now),
    };
    ProjectStore::put(&WasmHost, &project)?;
    let empty = ProjectStats::default();
    Ok(serde_json::json!({
        "project": ops::view_json(&project, &empty),
        "created": true,
    }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn create_via_host(_draft: &ProjectDraft) -> Result<serde_json::Value, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 打开项目（刷新 `lastOpenedAt`；列表排序据此变化）
#[cfg(target_arch = "wasm32")]
pub fn open_via_host(id: &str) -> Result<serde_json::Value, String> {
    touch_opened(id)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn open_via_host(_id: &str) -> Result<serde_json::Value, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 刷新打开时间并回读视图（内部共用：create 去重命中与 open 命令）
#[cfg(target_arch = "wasm32")]
fn touch_opened(id: &str) -> Result<serde_json::Value, String> {
    let mut project =
        ProjectStore::get(&WasmHost, id)?.ok_or_else(|| format!("project not found: {id}"))?;
    let now = crate::config::model::now_rfc3339();
    project.last_opened_at = Some(now.clone());
    project.updated_at = now;
    ProjectStore::put(&WasmHost, &project)?;
    let stats = stats_by_project()?;
    let empty = ProjectStats::default();
    Ok(ops::view_json(&project, stats.get(id).unwrap_or(&empty)))
}

/// 改名（只改展示名，与目录解耦；空名显性报错）
#[cfg(target_arch = "wasm32")]
pub fn rename_via_host(id: &str, name: &str) -> Result<serde_json::Value, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("project name required".to_string());
    }
    let mut project =
        ProjectStore::get(&WasmHost, id)?.ok_or_else(|| format!("project not found: {id}"))?;
    project.name = name.to_string();
    project.updated_at = crate::config::model::now_rfc3339();
    ProjectStore::put(&WasmHost, &project)?;
    let stats = stats_by_project()?;
    let empty = ProjectStats::default();
    Ok(ops::view_json(&project, stats.get(id).unwrap_or(&empty)))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn rename_via_host(_id: &str, _name: &str) -> Result<serde_json::Value, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 移除项目（不动磁盘文件）：先校验无活跃运行，再级联删除运行与注解
///
/// 拒绝而非静默 kill：用户正在跑的 agent 被后台杀掉比「删除失败，请先停止运行」
/// 坏得多。返回 `{removed, runsRemoved}`。
#[cfg(target_arch = "wasm32")]
pub fn remove_via_host(id: &str) -> Result<serde_json::Value, String> {
    if ProjectStore::get(&WasmHost, id)?.is_none() {
        return Err(format!("project not found: {id}"));
    }
    let active = crate::session::active_runs_of_project_via_host(id)?;
    if active > 0 {
        return Err(format!(
            "project has {active} active run(s); stop them before removing the project"
        ));
    }
    let runs_removed = crate::session::remove_runs_of_project_via_host(id)?;
    let removed = ProjectStore::remove(&WasmHost, id)?;
    Ok(serde_json::json!({ "removed": removed, "runsRemoved": runs_removed }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn remove_via_host(_id: &str) -> Result<serde_json::Value, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

/// 选项目目录（宿主 `host-platform.pick-folders`：`fs:pick` 权限门与选中路径的
/// 授权校验都在宿主；用户取消 = 空数组，不是错误）→ `{picked, path}`
///
/// 为什么不复用 `agent.pick-source-dir`：那是 Agent 管理域的用量来源选择器，
/// 语义归 hub；项目建卡要有自己的入口，否则项目面依赖一个它并不拥有的命令。
#[cfg(target_arch = "wasm32")]
pub fn pick_dir_via_host() -> Result<serde_json::Value, String> {
    let path = wasmnest_plugin_api::host::HostPlatform::platform_pick_folders(&WasmHost)
        .map_err(|e| format!("project.pick-dir: {}", e.message))?
        .into_iter()
        .next()
        .unwrap_or_default();
    Ok(serde_json::json!({ "picked": !path.is_empty(), "path": path }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn pick_dir_via_host() -> Result<serde_json::Value, String> {
    Err("project picker unavailable outside wasm runtime".to_string())
}

/// 按目录取（或建）项目——会话创建编排的归属入口
///
/// 目录为空 → `Ok(None)`（该配置无法构成项目；运行保持未归属，界面上按「无项目」
/// 展示，不发明默认项目）。已存在 → 复用（**不**刷新打开时间：创建运行不等于
/// 用户打开了项目）。
#[cfg(target_arch = "wasm32")]
pub fn ensure_for_directory_via_host(
    environment: &str,
    wsl_distro: Option<&str>,
    working_dir: &str,
) -> Result<Option<String>, String> {
    let dir = ops::normalize_working_dir(working_dir);
    if dir.is_empty() {
        return Ok(None);
    }
    let key = ops::project_key(environment, &dir);
    if let Some(existing) = ops::find_duplicate(&ProjectStore::all(&WasmHost)?, &key) {
        return Ok(Some(existing.id.clone()));
    }
    let now = crate::config::model::now_rfc3339();
    let project = Project {
        id: crate::config::model::new_config_id()?,
        environment: key.environment,
        wsl_distro: wsl_distro
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        working_dir: dir.clone(),
        name: ops::default_project_name(&dir),
        created_at: now.clone(),
        updated_at: now,
        last_opened_at: None,
    };
    ProjectStore::put(&WasmHost, &project)?;
    Ok(Some(project.id))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn ensure_for_directory_via_host(
    _environment: &str,
    _wsl_distro: Option<&str>,
    _working_dir: &str,
) -> Result<Option<String>, String> {
    Err("project store unavailable outside wasm runtime".to_string())
}

// ==================== wasm：容器迁移端口实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use crate::schema::validate_identifier;
    use migrate::{ConfigRow, RunRow};

    /// 表是否存在（`sqlite_master` 查询；与 `schema.rs` 同口径）
    fn table_exists(host: &WasmHost, table: &str) -> Result<bool, String> {
        let rows = host
            .plugin_db_query_params(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                &sql_params![table],
            )
            .map_err(|e| format!("sqlite_master query failed: {}", e.message))?
            .unwrap_or_else(|| serde_json::json!([]));
        Ok(rows.as_array().map(|arr| !arr.is_empty()).unwrap_or(false))
    }

    /// 表的列名（`PRAGMA table_info`；既有用法见 `hub/providers/store.rs`）
    fn columns_of(host: &WasmHost, table: &str) -> Result<Vec<String>, String> {
        validate_identifier(table)?;
        let rows = host
            .plugin_db_query(&format!("PRAGMA table_info({table})"))
            .map_err(|e| format!("pragma table_info({table}) failed: {}", e.message))?
            .unwrap_or_else(|| serde_json::json!([]));
        Ok(rows
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|row| row.get("name").and_then(|v| v.as_str()))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 补列（缺哪列建哪列；表不在 → no-op）
    fn ensure_columns(
        host: &WasmHost,
        table: &str,
        columns: &[(&str, &str)],
    ) -> Result<(), String> {
        if !table_exists(host, table)? {
            return Ok(());
        }
        let existing = columns_of(host, table)?;
        for (column, ddl) in columns {
            if existing.iter().any(|c| c == column) {
                continue;
            }
            host.plugin_db_execute(ddl)
                .map_err(|e| format!("migrate {table}.{column} failed: {}", e.message))?;
        }
        Ok(())
    }

    fn column(rows: Option<serde_json::Value>, key: &str) -> Vec<String> {
        rows.unwrap_or_else(|| serde_json::json!([]))
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|row| row.get(key).and_then(|v| v.as_str()))
            .map(str::to_string)
            .collect()
    }

    impl ContainerStore for WasmHost {
        fn ensure_meta(&self) -> Result<(), String> {
            self.plugin_db_execute(crate::schema::META_SCHEMA)
                .map_err(|e| format!("plugin_meta init failed: {}", e.message))?;
            Ok(())
        }

        fn table_names(&self) -> Result<Vec<String>, String> {
            let rows = self
                .plugin_db_query("SELECT name FROM sqlite_master WHERE type = 'table'")
                .map_err(|e| format!("sqlite_master table query failed: {}", e.message))?;
            Ok(column(rows, "name")
                .into_iter()
                .filter(|n| !n.starts_with("sqlite_"))
                .collect())
        }

        fn rename_table(&self, from: &str, to: &str) -> Result<(), String> {
            validate_identifier(from)?;
            validate_identifier(to)?;
            self.plugin_db_execute(&format!("ALTER TABLE \"{}\" RENAME TO \"{}\"", from, to))
                .map_err(|e| format!("rename table {} → {} failed: {}", from, to, e.message))?;
            Ok(())
        }

        fn drop_indexes_of(&self, table: &str) -> Result<usize, String> {
            validate_identifier(table)?;
            let rows = self
                .plugin_db_query_params(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1",
                    &sql_params![table],
                )
                .map_err(|e| format!("sqlite_master index query failed: {}", e.message))?;
            let mut dropped = 0;
            for name in column(rows, "name") {
                // 自动索引归 SQLite 管（DROP 会被拒），只清显式建的
                if name.starts_with("sqlite_autoindex") {
                    continue;
                }
                validate_identifier(&name)?;
                self.plugin_db_execute(&format!("DROP INDEX IF EXISTS \"{}\"", name))
                    .map_err(|e| format!("drop index {} failed: {}", name, e.message))?;
                dropped += 1;
            }
            Ok(dropped)
        }

        fn ensure_projects_table(&self) -> Result<(), String> {
            ProjectStore::ensure_schema(self)
        }

        fn ensure_run_columns(&self) -> Result<(), String> {
            ensure_columns(self, "runs", RUN_EXTRA_COLUMNS)
        }

        fn ensure_task_binding_columns(&self) -> Result<(), String> {
            ensure_columns(self, "task_queue", TASK_BINDING_COLUMNS)
        }

        fn config_table_exists(&self) -> Result<bool, String> {
            table_exists(self, "session_configs")
        }

        fn configs(&self) -> Result<Vec<ConfigRow>, String> {
            if !table_exists(self, "session_configs")? {
                return Ok(Vec::new());
            }
            let rows = self
                .plugin_db_query(
                    "SELECT id, environment, working_dir, wsl_distro, command FROM session_configs",
                )
                .map_err(|e| format!("session_configs query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            Ok(rows
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|row| ConfigRow {
                    id: row
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    environment: row
                        .get("environment")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    working_dir: row
                        .get("working_dir")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    wsl_distro: row
                        .get("wsl_distro")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    command: row
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect())
        }

        fn projects(&self) -> Result<Vec<Project>, String> {
            ProjectStore::all(self)
        }

        fn runs(&self) -> Result<Vec<RunRow>, String> {
            if !table_exists(self, "runs")? {
                return Ok(Vec::new());
            }
            let rows = self
                .plugin_db_query("SELECT id, config_id, project_id, agent_id FROM runs")
                .map_err(|e| format!("runs query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            Ok(rows
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|row| RunRow {
                    id: row
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    config_id: row
                        .get("config_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    project_id: row
                        .get("project_id")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.is_empty())
                        .map(str::to_string),
                    agent_id: row
                        .get("agent_id")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.is_empty())
                        .map(str::to_string),
                })
                .collect())
        }

        fn insert_project(&self, project: &Project) -> Result<(), String> {
            ProjectStore::put(self, project)
        }

        fn set_run_attribution(
            &self,
            run_id: &str,
            project_id: &str,
            agent_id: Option<&str>,
        ) -> Result<(), String> {
            self.plugin_db_execute_params(
                "UPDATE runs SET project_id = ?1, agent_id = ?2 WHERE id = ?3",
                &sql_params![project_id, agent_id, run_id],
            )
            .map_err(|e| format!("runs attribution update failed: {}", e.message))?;
            Ok(())
        }

        fn delete_run(&self, run_id: &str) -> Result<(), String> {
            // 注解槽随行删除（无主运行的历史注解没有保留价值，留着就是孤儿键）
            self.plugin_db_execute_params(
                "DELETE FROM session_annotations WHERE session_id = ?1",
                &sql_params![run_id],
            )
            .map_err(|e| format!("orphan annotations delete failed: {}", e.message))?;
            // 事件账本 / 权限审计按运行 id 键控：与 SessionStore::remove 同一套级联。
            // 迁移跑在各域 ensure_schema 之前，这两张表可能还不存在 → 先判表。
            for table in ["run_events", "permission_audit", "run_commands"] {
                if table_exists(self, table)? {
                    self.plugin_db_execute_params(
                        &format!("DELETE FROM {} WHERE run_id = ?1", table),
                        &sql_params![run_id],
                    )
                    .map_err(|e| format!("orphan {} delete failed: {}", table, e.message))?;
                }
            }
            self.plugin_db_execute_params("DELETE FROM runs WHERE id = ?1", &sql_params![run_id])
                .map_err(|e| format!("orphan run delete failed: {}", e.message))?;
            Ok(())
        }

        fn task_session_ids(&self) -> Result<Vec<String>, String> {
            if !table_exists(self, "task_queue")? {
                return Ok(Vec::new());
            }
            let rows = self
                .plugin_db_query(
                    "SELECT DISTINCT session_id FROM task_queue \
                     WHERE session_id IS NOT NULL AND session_id <> ''",
                )
                .map_err(|e| format!("task_queue session scan failed: {}", e.message))?;
            Ok(column(rows, "session_id"))
        }

        fn task_count_for_session(&self, session_id: &str) -> Result<usize, String> {
            if !table_exists(self, "task_queue")? {
                return Ok(0);
            }
            let rows = self
                .plugin_db_query_params(
                    "SELECT session_id FROM task_queue WHERE session_id = ?1",
                    &sql_params![session_id],
                )
                .map_err(|e| format!("task_queue session count failed: {}", e.message))?;
            Ok(column(rows, "session_id").len())
        }

        fn bind_tasks(
            &self,
            session_id: &str,
            project_id: &str,
            agent_id: Option<&str>,
        ) -> Result<usize, String> {
            let affected = self
                .plugin_db_execute_params(
                    "UPDATE task_queue SET project_id = ?1, agent_id = ?2 \
                     WHERE session_id = ?3 AND (project_id IS NULL OR project_id = '')",
                    &sql_params![project_id, agent_id, session_id],
                )
                .map_err(|e| format!("task_queue binding update failed: {}", e.message))?;
            Ok(affected.max(0) as usize)
        }

        fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT value FROM plugin_meta WHERE key = ?1",
                    &sql_params![key],
                )
                .map_err(|e| format!("plugin_meta read failed: {}", e.message))?;
            Ok(column(rows, "value").into_iter().next())
        }

        fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO plugin_meta (key, value) VALUES (?1, ?2)",
                &sql_params![key, value],
            )
            .map_err(|e| format!("plugin_meta write failed: {}", e.message))?;
            Ok(())
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 全新库的建表列必须覆盖迁移补列：`runs` 的两条落地路径（新库 `CREATE TABLE`
    /// 与老库 `ALTER TABLE ADD COLUMN`）落下同一组列，否则「新装能用、升级后少列」
    /// 这类缺陷要等到线上才炸
    #[test]
    fn run_extra_columns_are_covered_by_fresh_schema() {
        let fresh = crate::session::store::SCHEMA
            .iter()
            .find(|stmt| stmt.contains("CREATE TABLE IF NOT EXISTS runs"))
            .expect("runs 建表语句必须在 session::store::SCHEMA 里");
        for (column, ddl) in RUN_EXTRA_COLUMNS {
            assert!(
                fresh.contains(&format!("{} ", column)),
                "全新库建表缺列 {column}: {fresh}"
            );
            assert!(
                ddl.contains(&format!("ADD COLUMN {column} ")) && ddl.contains("runs"),
                "补列 DDL 必须针对 runs 且加的是 {column}: {ddl}"
            );
        }
    }

    /// 任务绑定键只在 `task_queue` 上加两列（不改执行语义：旧的 `session_id` 列保留）
    #[test]
    fn task_binding_columns_table_shape() {
        assert_eq!(TASK_BINDING_COLUMNS.len(), 2);
        for (column, ddl) in TASK_BINDING_COLUMNS {
            assert!(
                ddl.contains("task_queue") && ddl.contains(&format!("ADD COLUMN {column} ")),
                "绑定键补列 DDL 形状错了: {ddl}"
            );
            assert!(
                !ddl.to_lowercase().contains("drop"),
                "补列不得删除旧列（session_id 仍被现有任务域读取）: {ddl}"
            );
        }
    }
}
