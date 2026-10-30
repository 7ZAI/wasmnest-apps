//! 容器迁移：会话 → 运行、会话配置 → 项目、任务绑定键改列（ADR 0003 决定 7）
//!
//! 本迁移**必须在各域 `ensure_schema` 之前**跑（沿用 `schema.rs` 的账本式重命名
//! 纪律：先建新名会让旧表以空表占位，重命名被跳过，旧数据永久留在无人读的名字下，
//! 现象是「升级后列表变空」）。激活顺序见 `lib.rs` 的 `activate`。
//!
//! ## 四步与幂等
//!
//! 1. `sessions` → `runs`（重命名 + 补列 `project_id` / `agent_id` /
//!    `agent_session_id` / `title` / `model`）；
//! 2. `session_configs` 按 `(执行环境, 归一化目录)` 去重生成 `projects`（已存在则复用，
//!    不覆盖用户改过的名字）；
//! 3. 运行按 `config_id` → 配置的目录/命令回填 `(project_id, agent_id)`；
//! 4. 无法归属的运行（`config_id` 空 / 配置已删）**删除**并把 id 写进迁移日志
//!    （研发期无真实用户，不背幽灵项目；但绝不静默——日志键 `project.migration_log`）。
//!
//! 任务队列只改绑定键（`session_id` → `project_id + agent_id` 两列），执行语义不变；
//! 找不到运行的任务留原样并计数（`tasksUnbound`），由后续票在界面上显性提示。
//!
//! 每一步都按「现状判断」而非「跑过一次就跳过」：重跑不产生重复项目、不重复回填、
//! 不重复删除（已删的 id 不在表里）。唯一的 marker 是**迁移日志**，只作留痕，
//! 不参与判定——marker 参与判定会让「删库后恢复」这类场景变成永久跳过。
//!
//! **本迁移不进 `schema.rename_ledger`（不可逆向回退）**：它不只是改名，还补列、
//! 丢无主运行、把任务绑定键加列。逆向「改名回去」会留下一张带新列、缺旧行的表，
//! 旧构建读它会以为数据完整——比拒绝回退更危险。回退走备份，不靠账本。
//!
//! ## 半迁移态（`sessions` 与 `runs` 并存）
//!
//! 两侧都不动，只登记 `ambiguous`（`"sessions|runs"`）并继续按 `runs` 处理。自动
//! 合并必然丢一侧的行，宁可让读日志的人决定。

use super::model::Project;
use super::ops;
use crate::task::agent::detect_agent;

/// 迁移日志键（`plugin_meta`）
pub const MIGRATION_LOG: &str = "project.migration_log";

/// `session_configs` 行（迁移只需要归属判据，不需要整行）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigRow {
    pub id: String,
    pub environment: String,
    pub working_dir: String,
    pub wsl_distro: Option<String>,
    pub command: String,
}

/// `runs` 行（迁移只需要归属字段）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRow {
    pub id: String,
    pub config_id: String,
    /// 空串 / `None` = 尚未归属
    pub project_id: Option<String>,
    pub agent_id: Option<String>,
}

/// 迁移结果（宿主日志与单测断言的外部可见面）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContainerMigrationReport {
    /// 实际发生的重命名（`"sessions→runs"`）
    pub renamed: Vec<String>,
    /// 新旧名并存的条目（`"sessions|runs"`），两侧都不动
    pub ambiguous: Vec<String>,
    /// 重命名后清理掉的旧索引数量（名字带旧表名，新索引由 `ensure_schema` 建回）
    pub indexes_dropped: usize,
    /// 本次新建的项目 id（复用的不算）
    pub projects_created: Vec<String>,
    /// 回填了项目归属的运行数
    pub runs_attributed: usize,
    /// 无法归属被删除的运行 id（按 id 升序，便于对账）
    pub runs_dropped: Vec<String>,
    /// 配置面不可用（`session_configs` 表不在）时**保留**的未归属运行 id
    ///
    /// 删无主运行的前提是「配置集可信」；配置表读不到时（新装 / 建表降级）宁可
    /// 留着让它们显示为「无项目」，也不拿一次读取失败当「配置已删光」。
    pub runs_unattributed: Vec<String>,
    /// 回填了绑定键的任务数
    pub tasks_bound: usize,
    /// 找不到运行、绑定键留空的任务数
    pub tasks_unbound: usize,
    /// 目录为空的配置 id（无法建项目，其运行会被丢弃）
    pub skipped_configs: Vec<String>,
    /// 本次是否写过迁移日志（无事发生则 false，不刷时间戳）
    pub log_written: bool,
}

impl ContainerMigrationReport {
    /// 是否有任何实际变更（决定要不要写日志）
    pub fn changed(&self) -> bool {
        !self.renamed.is_empty()
            || !self.projects_created.is_empty()
            || self.runs_attributed > 0
            || !self.runs_dropped.is_empty()
            || !self.runs_unattributed.is_empty()
            || self.tasks_bound > 0
    }

    /// 迁移日志（JSON 文本；`at` 为本次运行时间）
    pub fn log_json(&self, at: &str) -> String {
        serde_json::json!({
            "at": at,
            "renamed": self.renamed,
            "indexesDropped": self.indexes_dropped,
            "ambiguous": self.ambiguous,
            "projectsCreated": self.projects_created,
            "runsAttributed": self.runs_attributed,
            "runsDropped": self.runs_dropped,
            "runsUnattributed": self.runs_unattributed,
            "tasksBound": self.tasks_bound,
            "tasksUnbound": self.tasks_unbound,
            "skippedConfigs": self.skipped_configs,
        })
        .to_string()
    }
}

/// 迁移端口（行语义；SQL 只存在于 wasm 实现里）
///
/// 表不存在时各读取方法返回空、各补列方法 no-op（全新库的迁移是一次空跑），
/// 这样激活顺序不必先判断「是不是新装」。
pub trait ContainerStore {
    fn ensure_meta(&self) -> Result<(), String>;
    fn table_names(&self) -> Result<Vec<String>, String>;
    fn rename_table(&self, from: &str, to: &str) -> Result<(), String>;
    /// 删掉某表上的全部非自动索引，返回删除数量
    ///
    /// `ALTER TABLE RENAME` 不会改索引名（实测 `idx_sessions_config_id` 会跟着
    /// 表走但名字不变），而随后的 `ensure_schema` 会用新名再建一遍——不清理就是
    /// 同一张表两套同覆盖列的索引。与 `schema.rs` 的重命名纪律一致。
    fn drop_indexes_of(&self, table: &str) -> Result<usize, String>;
    /// 建 `projects` 表 + 索引（幂等）
    fn ensure_projects_table(&self) -> Result<(), String>;
    /// 给 `runs` 补运行扩展列（缺则 `ALTER TABLE ADD COLUMN`，幂等；表不在 no-op）
    fn ensure_run_columns(&self) -> Result<(), String>;
    /// 给 `task_queue` 补 `project_id` / `agent_id`（幂等；表不在 no-op）
    fn ensure_task_binding_columns(&self) -> Result<(), String>;
    /// `session_configs` 表是否存在
    ///
    /// 判「无主运行能不能删」用：表在 = 配置集可信（哪怕空表也是用户删光了配置）；
    /// 表不在 = 配置面不可用（新装 / 建表失败），此时**不能**把全部运行判成无主——
    /// 那等于把历史静默删光。
    fn config_table_exists(&self) -> Result<bool, String>;
    fn configs(&self) -> Result<Vec<ConfigRow>, String>;
    fn projects(&self) -> Result<Vec<Project>, String>;
    fn runs(&self) -> Result<Vec<RunRow>, String>;
    fn insert_project(&self, project: &Project) -> Result<(), String>;
    fn set_run_attribution(
        &self,
        run_id: &str,
        project_id: &str,
        agent_id: Option<&str>,
    ) -> Result<(), String>;
    fn delete_run(&self, run_id: &str) -> Result<(), String>;
    /// `task_queue` 里出现过的会话 id（去重）
    fn task_session_ids(&self) -> Result<Vec<String>, String>;
    /// 某会话 id 关联的任务行数（`tasks_unbound` 与 `tasks_bound` 同单位：任务行）
    fn task_count_for_session(&self, session_id: &str) -> Result<usize, String>;
    /// 按会话 id 回填绑定键；只更新尚未绑定（`project_id` 空）的行，返回命中行数
    fn bind_tasks(
        &self,
        session_id: &str,
        project_id: &str,
        agent_id: Option<&str>,
    ) -> Result<usize, String>;
    fn meta_get(&self, key: &str) -> Result<Option<String>, String>;
    fn meta_set(&self, key: &str, value: &str) -> Result<(), String>;
}

/// 执行容器迁移（幂等；见模块文档四步）
pub fn migrate(
    store: &impl ContainerStore,
    now: &str,
    new_project_id: impl Fn() -> Result<String, String>,
) -> Result<ContainerMigrationReport, String> {
    store.ensure_meta()?;
    let mut report = ContainerMigrationReport::default();

    // ===== 第一步：sessions → runs（重命名）=====
    let tables = store.table_names()?;
    let has = |name: &str| tables.iter().any(|t| t == name);
    let has_sessions = has("sessions");
    let has_runs = has("runs");
    match (has_sessions, has_runs) {
        (true, true) => report.ambiguous.push("sessions|runs".to_string()),
        (true, false) => {
            store.rename_table("sessions", "runs")?;
            report.indexes_dropped = store.drop_indexes_of("runs")?;
            report.renamed.push("sessions→runs".to_string());
        }
        _ => {}
    }

    // ===== 结构与列（幂等；新库在这里把两张表建出来）=====
    store.ensure_projects_table()?;
    store.ensure_run_columns()?;
    store.ensure_task_binding_columns()?;

    // ===== 第二步：配置 → 项目（同目录同执行环境合并）=====
    //
    // 配置表不在（新装 / 配置面降级）→ 配置集不可信：不建项目、不删无主运行，
    // 只把运行标成「未归属」由界面显示（fail-visible，不静默丢历史）
    let configs_available = store.config_table_exists()?;
    let configs = if configs_available {
        store.configs()?
    } else {
        Vec::new()
    };
    let mut projects = store.projects()?;
    // config_id → (project_id, agent_id)
    let mut attribution: std::collections::BTreeMap<String, (String, Option<String>)> =
        std::collections::BTreeMap::new();
    for config in &configs {
        let dir = ops::normalize_working_dir(&config.working_dir);
        if dir.is_empty() {
            // 目录空的配置无法构成项目：不发明「默认项目」，其运行按无主丢弃
            report.skipped_configs.push(config.id.clone());
            continue;
        }
        let key = ops::project_key(&config.environment, &dir);
        let project_id = match ops::find_duplicate(&projects, &key) {
            Some(existing) => existing.id.clone(),
            None => {
                let project = Project {
                    id: new_project_id()?,
                    environment: key.environment.clone(),
                    wsl_distro: config.wsl_distro.clone(),
                    working_dir: dir.clone(),
                    name: ops::default_project_name(&dir),
                    created_at: now.to_string(),
                    updated_at: now.to_string(),
                    last_opened_at: None,
                };
                store.insert_project(&project)?;
                report.projects_created.push(project.id.clone());
                projects.push(project.clone());
                project.id
            }
        };
        let agent = agent_of(&config.command);
        attribution.insert(config.id.clone(), (project_id, agent));
    }

    // ===== 第三步：运行回填归属；无主运行删除 =====
    let mut runs = store.runs()?;
    let mut bound: std::collections::BTreeMap<String, (String, Option<String>)> =
        std::collections::BTreeMap::new();
    for run in runs.iter_mut() {
        if run.project_id.as_deref().is_some_and(|v| !v.is_empty()) {
            // 已归属（重跑 / 新进程创建的运行）：只记录，不改
            let agent = run.agent_id.clone().filter(|v| !v.is_empty());
            bound.insert(
                run.id.clone(),
                (run.project_id.clone().unwrap_or_default(), agent),
            );
            continue;
        }
        match attribution.get(&run.config_id) {
            Some((project_id, agent)) => {
                store.set_run_attribution(&run.id, project_id, agent.as_deref())?;
                run.project_id = Some(project_id.clone());
                run.agent_id = agent.clone();
                bound.insert(run.id.clone(), (project_id.clone(), agent.clone()));
                report.runs_attributed += 1;
            }
            None if configs_available => {
                store.delete_run(&run.id)?;
                report.runs_dropped.push(run.id.clone());
            }
            None => {
                // 配置集不可信：保留行，等下次（配置面恢复后）再判
                report.runs_unattributed.push(run.id.clone());
            }
        }
    }
    report.runs_dropped.sort();
    report.runs_unattributed.sort();

    // ===== 第四步：任务队列绑定键（会话 id → 项目 + agent）=====
    let mut task_sessions = store.task_session_ids()?;
    task_sessions.sort();
    for session_id in &task_sessions {
        match bound.get(session_id) {
            Some((project_id, agent)) => {
                report.tasks_bound += store.bind_tasks(session_id, project_id, agent.as_deref())?;
            }
            None => {
                report.tasks_unbound += store.task_count_for_session(session_id)?;
            }
        }
    }

    // ===== 留痕（只在有事发生时写，重跑不刷时间戳）=====
    if report.changed() {
        store.meta_set(MIGRATION_LOG, &report.log_json(now))?;
        report.log_written = true;
    }
    Ok(report)
}

/// 命令 → agent id（`unknown` 归一成 `None`：空值表示「未识别的命令行」，
/// 不把 `unknown` 当 agent 名写进库里——它会是未来某个真 agent 的合法 slug 风险）
fn agent_of(command: &str) -> Option<String> {
    let detected = detect_agent(command);
    if detected == "unknown" {
        None
    } else {
        Some(detected.to_string())
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    /// 内存容器库：表名 + 配置行 + 运行行 + 项目行 + 任务绑定行
    #[derive(Default)]
    struct MockContainerStore {
        tables: Mutex<Vec<String>>,
        configs: Mutex<Vec<ConfigRow>>,
        projects: Mutex<Vec<Project>>,
        runs: Mutex<Vec<RunRow>>,
        /// `(session_id, project_id, agent_id)`；project_id 空 = 未绑定
        tasks: Mutex<Vec<(String, String, String)>>,
        meta: Mutex<BTreeMap<String, String>>,
        /// 运行扩展列是否已补（断言 `ensure_run_columns` 被调用且幂等）
        run_columns: Mutex<bool>,
        rename_log: Mutex<Vec<(String, String)>>,
        /// 旧索引（表名, 索引名）——重命名后按表清理
        indexes: Mutex<Vec<(String, String)>>,
    }

    impl MockContainerStore {
        fn with_tables(tables: &[&str]) -> Self {
            Self {
                tables: Mutex::new(tables.iter().map(|t| t.to_string()).collect()),
                ..Default::default()
            }
        }

        fn has_table(&self, name: &str) -> bool {
            self.tables.lock().unwrap().iter().any(|t| t == name)
        }

        fn project_count(&self) -> usize {
            self.projects.lock().unwrap().len()
        }

        fn runs(&self) -> Vec<RunRow> {
            self.runs.lock().unwrap().clone()
        }

        fn log(&self) -> Option<serde_json::Value> {
            self.meta
                .lock()
                .unwrap()
                .get(MIGRATION_LOG)
                .and_then(|raw| serde_json::from_str(raw).ok())
        }
    }

    impl ContainerStore for MockContainerStore {
        fn ensure_meta(&self) -> Result<(), String> {
            if !self.has_table("plugin_meta") {
                self.tables.lock().unwrap().push("plugin_meta".to_string());
            }
            Ok(())
        }

        fn table_names(&self) -> Result<Vec<String>, String> {
            Ok(self.tables.lock().unwrap().clone())
        }

        fn rename_table(&self, from: &str, to: &str) -> Result<(), String> {
            let mut tables = self.tables.lock().unwrap();
            if !tables.iter().any(|t| t == from) {
                return Err(format!("no such table: {from}"));
            }
            if tables.iter().any(|t| t == to) {
                return Err(format!("table already exists: {to}"));
            }
            tables.retain(|t| t != from);
            tables.push(to.to_string());
            drop(tables);
            for (t, _) in self.indexes.lock().unwrap().iter_mut() {
                if t == from {
                    *t = to.to_string();
                }
            }
            self.rename_log
                .lock()
                .unwrap()
                .push((from.to_string(), to.to_string()));
            Ok(())
        }

        fn drop_indexes_of(&self, table: &str) -> Result<usize, String> {
            let mut indexes = self.indexes.lock().unwrap();
            let before = indexes.len();
            indexes.retain(|(t, _)| t != table);
            Ok(before - indexes.len())
        }

        fn ensure_projects_table(&self) -> Result<(), String> {
            if !self.has_table("projects") {
                self.tables.lock().unwrap().push("projects".to_string());
            }
            Ok(())
        }

        fn ensure_run_columns(&self) -> Result<(), String> {
            if self.has_table("runs") {
                *self.run_columns.lock().unwrap() = true;
            }
            Ok(())
        }

        fn ensure_task_binding_columns(&self) -> Result<(), String> {
            Ok(())
        }

        fn config_table_exists(&self) -> Result<bool, String> {
            Ok(self.has_table("session_configs"))
        }

        fn configs(&self) -> Result<Vec<ConfigRow>, String> {
            Ok(self.configs.lock().unwrap().clone())
        }

        fn projects(&self) -> Result<Vec<Project>, String> {
            Ok(self.projects.lock().unwrap().clone())
        }

        fn runs(&self) -> Result<Vec<RunRow>, String> {
            Ok(MockContainerStore::runs(self))
        }

        fn insert_project(&self, project: &Project) -> Result<(), String> {
            let mut projects = self.projects.lock().unwrap();
            let key = ops::project_key(&project.environment, &project.working_dir);
            if projects
                .iter()
                .any(|p| ops::project_key(&p.environment, &p.working_dir) == key)
            {
                return Err(format!(
                    "UNIQUE constraint failed: projects ({}, {})",
                    project.environment, project.working_dir
                ));
            }
            projects.push(project.clone());
            Ok(())
        }

        fn set_run_attribution(
            &self,
            run_id: &str,
            project_id: &str,
            agent_id: Option<&str>,
        ) -> Result<(), String> {
            let mut runs = self.runs.lock().unwrap();
            let run = runs
                .iter_mut()
                .find(|r| r.id == run_id)
                .ok_or_else(|| format!("no such run: {run_id}"))?;
            run.project_id = Some(project_id.to_string());
            run.agent_id = agent_id.map(str::to_string);
            Ok(())
        }

        fn delete_run(&self, run_id: &str) -> Result<(), String> {
            self.runs.lock().unwrap().retain(|r| r.id != run_id);
            Ok(())
        }

        fn task_session_ids(&self) -> Result<Vec<String>, String> {
            let mut ids: Vec<String> = self
                .tasks
                .lock()
                .unwrap()
                .iter()
                .map(|(session_id, _, _)| session_id.clone())
                .collect();
            ids.dedup();
            Ok(ids)
        }

        fn task_count_for_session(&self, session_id: &str) -> Result<usize, String> {
            Ok(self
                .tasks
                .lock()
                .unwrap()
                .iter()
                .filter(|(sid, _, _)| sid == session_id)
                .count())
        }

        fn bind_tasks(
            &self,
            session_id: &str,
            project_id: &str,
            agent_id: Option<&str>,
        ) -> Result<usize, String> {
            let mut tasks = self.tasks.lock().unwrap();
            let mut hit = 0;
            for (sid, pid, aid) in tasks.iter_mut() {
                if sid == session_id && pid.is_empty() {
                    *pid = project_id.to_string();
                    *aid = agent_id.unwrap_or_default().to_string();
                    hit += 1;
                }
            }
            Ok(hit)
        }

        fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.meta.lock().unwrap().get(key).cloned())
        }

        fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
            self.meta
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
    }

    fn config(id: &str, env: &str, dir: &str, command: &str) -> ConfigRow {
        ConfigRow {
            id: id.to_string(),
            environment: env.to_string(),
            working_dir: dir.to_string(),
            wsl_distro: None,
            command: command.to_string(),
        }
    }

    fn run(id: &str, config_id: &str) -> RunRow {
        RunRow {
            id: id.to_string(),
            config_id: config_id.to_string(),
            project_id: None,
            agent_id: None,
        }
    }

    /// 计数器 id 生成器（native 测试可确定性断言）
    fn ids() -> impl Fn() -> Result<String, String> {
        let counter = std::sync::atomic::AtomicUsize::new(0);
        move || {
            let n = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(format!("proj-{}", n))
        }
    }

    fn store_with_two_configs_same_dir() -> MockContainerStore {
        let store = MockContainerStore::with_tables(&[
            "sessions",
            "session_configs",
            "task_queue",
            "plugin_meta",
        ]);
        *store.configs.lock().unwrap() = vec![
            config("c1", "linux", "/srv/app/", "pi"),
            config("c2", "linux", "/srv/app", "opencode"),
        ];
        *store.runs.lock().unwrap() = vec![run("r1", "c1"), run("r2", "c2")];
        store
    }

    /// 旧库一次迁到位：改名、合并项目、回填归属与 agent、任务绑定
    #[test]
    fn migration_renames_merges_and_attributes() {
        let store = store_with_two_configs_same_dir();
        *store.tasks.lock().unwrap() = vec![("r1".to_string(), String::new(), String::new())];
        // 旧表带一个索引：重命名后名字仍带旧表名，必须被清掉（新索引由 ensure_schema 建回）
        store
            .indexes
            .lock()
            .unwrap()
            .push(("sessions".to_string(), "idx_sessions_config_id".to_string()));

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");

        assert_eq!(report.renamed, vec!["sessions→runs".to_string()]);
        assert!(store.has_table("runs") && !store.has_table("sessions"));
        assert_eq!(
            report.projects_created.len(),
            1,
            "同目录同执行环境合并成一条项目, got: {:?}",
            report.projects_created
        );
        assert_eq!(store.project_count(), 1);
        let projects = store.projects.lock().unwrap();
        assert_eq!(projects[0].working_dir, "/srv/app", "目录归一化后入库");
        assert_eq!(projects[0].name, "app", "项目名取目录末段");
        assert_eq!(projects[0].environment, "linux");
        drop(projects);

        let runs = store.runs();
        assert_eq!(runs.len(), 2, "两条运行都保留");
        assert!(runs
            .iter()
            .all(|r| Some("proj-0".to_string()) == r.project_id));
        let agents: Vec<Option<String>> = runs.iter().map(|r| r.agent_id.clone()).collect();
        assert_eq!(
            agents,
            vec![Some("pi".to_string()), Some("opencode".to_string())],
            "agent 从配置命令推断"
        );
        assert_eq!(report.runs_attributed, 2);
        assert!(report.runs_dropped.is_empty());
        assert_eq!(report.tasks_bound, 1, "任务绑定键回填");
        assert!(store.run_columns.lock().unwrap().clone(), "补列步骤被执行");
        assert_eq!(report.indexes_dropped, 1, "旧名索引进账");
        assert!(
            store.indexes.lock().unwrap().is_empty(),
            "旧索引必须被清掉（否则同名旧索引与新索引并存）"
        );
        assert!(report.log_written);
        let log = store.log().expect("迁移日志");
        assert_eq!(log["at"], "2026-10-29T00:00:00Z");
        assert_eq!(log["runsAttributed"], 2);
    }

    /// 幂等：重跑不再改名 / 不再建项目 / 不再回填 / 不再写日志
    #[test]
    fn migration_is_idempotent() {
        let store = store_with_two_configs_same_dir();
        migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("first");
        let log_before = store.log().expect("first log");

        let second = migrate(&store, "2026-10-30T00:00:00Z", ids()).expect("second");
        assert!(second.renamed.is_empty());
        assert!(second.projects_created.is_empty(), "重跑不得新建项目");
        assert_eq!(second.runs_attributed, 0, "已归属的运行不重复回填");
        assert!(second.runs_dropped.is_empty());
        assert!(!second.log_written, "无事发生不写日志");
        assert_eq!(store.project_count(), 1);
        assert_eq!(store.log().expect("log kept"), log_before, "日志不被改写");
    }

    /// 跨执行环境不合并：同目录的 linux 与 wsl2 配置是两个项目
    #[test]
    fn same_dir_in_other_environment_stays_separate() {
        let store = MockContainerStore::with_tables(&[
            "sessions",
            "session_configs",
            "task_queue",
            "plugin_meta",
        ]);
        *store.configs.lock().unwrap() = vec![
            config("c1", "linux", "/srv/app", "pi"),
            config("c2", "wsl2", "/srv/app", "pi"),
        ];
        *store.runs.lock().unwrap() = vec![run("r1", "c1"), run("r2", "c2")];

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");
        assert_eq!(report.projects_created.len(), 2);
        let runs = store.runs();
        assert_ne!(
            runs[0].project_id, runs[1].project_id,
            "跨执行环境的运行不得落进同一项目"
        );
    }

    /// 无主运行（配置已删 / 配置目录为空）被丢弃并留日志
    #[test]
    fn orphan_runs_are_dropped_and_logged() {
        let store = MockContainerStore::with_tables(&[
            "sessions",
            "session_configs",
            "task_queue",
            "plugin_meta",
        ]);
        *store.configs.lock().unwrap() = vec![
            config("c1", "linux", "/srv/app", "pi"),
            config("c-empty", "linux", "  ", "pi"),
        ];
        *store.runs.lock().unwrap() = vec![
            run("r-keep", "c1"),
            run("r-missing-config", "c-gone"),
            run("r-empty-dir", "c-empty"),
            run("r-no-config", ""),
        ];
        *store.tasks.lock().unwrap() = vec![
            ("r-keep".to_string(), String::new(), String::new()),
            ("r-gone".to_string(), String::new(), String::new()),
            // 同一会话下两条任务：`tasks_unbound` 必须按任务行计数（与 tasks_bound 同单位）
            ("r-gone".to_string(), String::new(), String::new()),
        ];

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");

        assert_eq!(
            report.runs_dropped,
            vec![
                "r-empty-dir".to_string(),
                "r-missing-config".to_string(),
                "r-no-config".to_string()
            ],
            "无主运行按 id 升序记账"
        );
        let remaining: Vec<String> = store.runs().into_iter().map(|r| r.id).collect();
        assert_eq!(remaining, vec!["r-keep".to_string()]);
        assert_eq!(report.skipped_configs, vec!["c-empty".to_string()]);
        assert_eq!(report.tasks_bound, 1);
        assert_eq!(
            report.tasks_unbound, 2,
            "指向已删运行的任务按行计数（与 tasks_bound 同单位）"
        );

        let log = store.log().expect("迁移日志");
        assert_eq!(
            log["runsDropped"],
            serde_json::json!(["r-empty-dir", "r-missing-config", "r-no-config"]),
            "日志必须点名丢弃的运行"
        );
        assert_eq!(log["skippedConfigs"], serde_json::json!(["c-empty"]));
    }

    /// 半迁移态（sessions 与 runs 并存）：两侧都不动，登记歧义，按 runs 继续
    #[test]
    fn both_table_names_present_is_reported_not_merged() {
        let store = MockContainerStore::with_tables(&[
            "sessions",
            "runs",
            "session_configs",
            "task_queue",
            "plugin_meta",
        ]);
        *store.configs.lock().unwrap() = vec![config("c1", "linux", "/srv/app", "pi")];
        *store.runs.lock().unwrap() = vec![run("r1", "c1")];

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");
        assert!(report.renamed.is_empty(), "冲突时不得改名");
        assert_eq!(report.ambiguous, vec!["sessions|runs".to_string()]);
        assert!(store.has_table("sessions"), "旧表保留");
        assert_eq!(report.runs_attributed, 1, "仍按 runs 继续回填");
    }

    /// 配置表不在（新装 / 配置面降级）：运行保留为「未归属」，绝不批量删除
    ///
    /// 反例保护：把「读不到配置」当成「配置已删光」会把整段运行历史静默删掉——
    /// 这正是本 spec 反复强调的 fail-visible 口径。
    #[test]
    fn missing_config_table_keeps_runs_unattributed() {
        let store = MockContainerStore::with_tables(&["sessions", "plugin_meta"]);
        *store.runs.lock().unwrap() = vec![run("r1", "c1"), run("r2", "")];

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");

        assert!(report.runs_dropped.is_empty(), "不得删除任何运行");
        assert_eq!(
            report.runs_unattributed,
            vec!["r1".to_string(), "r2".to_string()],
            "两条都记为未归属（按 id 升序）"
        );
        assert_eq!(store.runs().len(), 2, "行原样保留");
        assert!(report.projects_created.is_empty(), "配置不可信时不建项目");
        assert!(report.log_written, "未归属也要留痕（可排障）");
        assert_eq!(
            store.log().expect("log")["runsUnattributed"],
            serde_json::json!(["r1", "r2"])
        );
    }

    /// 全新库：一次空跑，只把 projects 表建出来，不写日志
    #[test]
    fn fresh_database_is_a_no_op_except_schema() {
        let store = MockContainerStore::with_tables(&[]);
        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");
        assert!(report.renamed.is_empty());
        assert!(report.projects_created.is_empty());
        assert_eq!(report.runs_attributed, 0);
        assert!(!report.log_written, "空跑不写日志");
        assert!(store.has_table("projects"), "项目管理面可用");
    }

    /// 已归属的运行在重跑里也不被改写（用户手动改过的归属/标题不会被迁移覆盖）
    #[test]
    fn already_attributed_runs_keep_their_project() {
        let store = MockContainerStore::with_tables(&[
            "runs",
            "session_configs",
            "task_queue",
            "plugin_meta",
        ]);
        *store.configs.lock().unwrap() = vec![config("c1", "linux", "/srv/app", "pi")];
        *store.runs.lock().unwrap() = vec![RunRow {
            id: "r1".to_string(),
            config_id: "c1".to_string(),
            project_id: Some("manual-project".to_string()),
            agent_id: Some("claude".to_string()),
        }];

        let report = migrate(&store, "2026-10-29T00:00:00Z", ids()).expect("migrate");
        // 项目按配置建（配置是「项目 × agent 的启动参数」，即使它当前没有运行）；
        // 但不能因为同目录有配置就把已归属的运行抢过来
        assert_eq!(
            report.projects_created.len(),
            1,
            "配置仍要落成一条项目, got: {:?}",
            report.projects_created
        );
        assert_eq!(report.runs_attributed, 0, "已归属的运行不被改写");
        let runs = store.runs();
        assert_eq!(runs[0].project_id.as_deref(), Some("manual-project"));
        assert_eq!(runs[0].agent_id.as_deref(), Some("claude"));
    }

    /// 日志 JSON 形状（前端/排障按字段名读，键名漂移即排障失据）
    #[test]
    fn log_json_shape_is_stable() {
        let report = ContainerMigrationReport {
            renamed: vec!["sessions→runs".to_string()],
            runs_dropped: vec!["r9".to_string()],
            tasks_unbound: 2,
            ..Default::default()
        };
        let value: serde_json::Value =
            serde_json::from_str(&report.log_json("2026-10-29T00:00:00Z")).expect("json");
        for key in [
            "at",
            "renamed",
            "ambiguous",
            "projectsCreated",
            "runsAttributed",
            "runsDropped",
            "runsUnattributed",
            "tasksBound",
            "tasksUnbound",
            "skippedConfigs",
        ] {
            assert!(value.get(key).is_some(), "日志缺字段 {key}: {value}");
        }
        assert!(report.changed(), "有丢弃即有变更");
    }
}
