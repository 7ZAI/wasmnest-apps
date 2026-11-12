//! 项目存储端口：真源 = 插件私有库（`host-plugin-database`，`storage` 权限）
//!
//! 端口按**行语义**暴露（不是 SQL）：去重 / 排序 / 视图派生留在 [`super::ops`]，
//! 可被 native 单测完整覆盖；SQL 与列映射只存在于 wasm 实现里（与
//! `config/store.rs` / `session/store.rs` 同模式——native 链接不引用 wasm 专属
//! import 符号）。
//!
//! 表结构：
//! - `projects`：一行一个项目；唯一索引 `(environment, working_dir)` 是去重的
//!   最后一道闸（应用层已按归一化键判重，索引防止并发/迁移期漏判写出两条）
//! - `plugin_meta`：跨域键值（迁移日志与 marker；与配置域共用同一张表，语句幂等）
//!
//! **按 `all()` 在内存里判重**是有意的：项目数量级是「十几个到几十个」，而
//! 归一化规则（windows 大小写折叠、末尾分隔符、根目录特例）写在 Rust 里，SQL
//! 复述一遍就会有两份漂移的实现。用唯一索引兜底写入，用 Rust 判定语义。

use super::model::Project;

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS projects (\
     id TEXT PRIMARY KEY, \
     environment TEXT NOT NULL, \
     wsl_distro TEXT, \
     working_dir TEXT NOT NULL, \
     name TEXT NOT NULL, \
     created_at TEXT NOT NULL, \
     updated_at TEXT NOT NULL, \
     last_opened_at TEXT)",
    // 去重闸：同目录同执行环境只允许一条（应用层判重之外的兜底）
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_dir ON projects(environment, working_dir)",
    "CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at)",
    "CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

/// 项目存储端口（真源读写；去重与排序归调用方）
pub trait ProjectStore {
    /// 建表（幂等）
    fn ensure_schema(&self) -> Result<(), String>;
    /// 全表（不排序——业务排序归 [`super::ops::sort_projects`]）
    fn all(&self) -> Result<Vec<Project>, String>;
    fn get(&self, id: &str) -> Result<Option<Project>, String>;
    /// 按 id 覆盖写（`ON CONFLICT(id)` upsert；`(environment, working_dir)` 冲突显性报错）
    fn put(&self, project: &Project) -> Result<(), String>;
    /// 删除，返回是否命中（未知 id 幂等 false）
    fn remove(&self, id: &str) -> Result<bool, String>;
    fn marker(&self, key: &str) -> Result<Option<String>, String>;
    fn set_marker(&self, key: &str, value: &str) -> Result<(), String>;
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    /// 行（snake_case 列名，宿主 `query_to_json` 输出）→ 模型
    fn row_to_project(row: &serde_json::Value) -> Result<Project, String> {
        let required = |key: &str| -> Result<String, String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("project row missing column '{}': {}", key, row))
        };
        Ok(Project {
            id: required("id")?,
            environment: required("environment")?,
            wsl_distro: row
                .get("wsl_distro")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            working_dir: required("working_dir")?,
            name: required("name")?,
            created_at: required("created_at")?,
            updated_at: required("updated_at")?,
            last_opened_at: row
                .get("last_opened_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    fn rows_to_projects(rows: Option<serde_json::Value>) -> Result<Vec<Project>, String> {
        let rows = rows.unwrap_or_else(|| serde_json::json!([]));
        let array = rows
            .as_array()
            .ok_or_else(|| format!("plugin db query did not return an array: {}", rows))?
            .clone();
        array.iter().map(row_to_project).collect()
    }

    impl ProjectStore for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            for stmt in SCHEMA {
                self.plugin_db_execute(stmt)
                    .map_err(|e| format!("plugin db execute failed: {}", e.message))?;
            }
            Ok(())
        }

        fn all(&self) -> Result<Vec<Project>, String> {
            self.plugin_db_query("SELECT * FROM projects")
                .map_err(|e| format!("plugin db query failed: {}", e.message))
                .and_then(rows_to_projects)
        }

        fn get(&self, id: &str) -> Result<Option<Project>, String> {
            let rows = self
                .plugin_db_query_params("SELECT * FROM projects WHERE id = ?1", &sql_params![id])
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            Ok(rows_to_projects(rows)?.into_iter().next())
        }

        fn put(&self, project: &Project) -> Result<(), String> {
            // 不用 INSERT OR REPLACE：SQLite 在二级唯一索引（同目录同环境）冲突时会
            // 先删冲突行再插入——漏判重就会把别人的项目整行删掉。upsert 只认 id，
            // 目录冲突留给唯一索引显性报错。
            self.plugin_db_execute_params(
                "INSERT INTO projects \
                 (id, environment, wsl_distro, working_dir, name, created_at, updated_at, last_opened_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
                 ON CONFLICT(id) DO UPDATE SET \
                 environment = excluded.environment, \
                 wsl_distro = excluded.wsl_distro, \
                 working_dir = excluded.working_dir, \
                 name = excluded.name, \
                 created_at = excluded.created_at, \
                 updated_at = excluded.updated_at, \
                 last_opened_at = excluded.last_opened_at",
                &sql_params![
                    project.id,
                    project.environment,
                    project.wsl_distro,
                    project.working_dir,
                    project.name,
                    project.created_at,
                    project.updated_at,
                    project.last_opened_at
                ],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn remove(&self, id: &str) -> Result<bool, String> {
            let affected = self
                .plugin_db_execute_params("DELETE FROM projects WHERE id = ?1", &sql_params![id])
                .map_err(|e| format!("plugin db delete failed: {}", e.message))?;
            Ok(affected > 0)
        }

        fn marker(&self, key: &str) -> Result<Option<String>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT value FROM plugin_meta WHERE key = ?1",
                    &sql_params![key],
                )
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            let rows = rows.unwrap_or_else(|| serde_json::json!([]));
            Ok(rows
                .as_array()
                .and_then(|a| a.first())
                .and_then(|r| r.get("value"))
                .and_then(|v| v.as_str())
                .map(str::to_string))
        }

        fn set_marker(&self, key: &str, value: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO plugin_meta (key, value) VALUES (?1, ?2)",
                &sql_params![key, value],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 内存实现（native 单测注入）：行语义与私有库对齐，并模拟唯一索引的冲突拒绝
    #[derive(Default)]
    pub struct MockProjectStore {
        rows: Mutex<Vec<Project>>,
        markers: Mutex<Vec<(String, String)>>,
    }

    impl MockProjectStore {
        pub fn new(rows: Vec<Project>) -> Self {
            Self {
                rows: Mutex::new(rows),
                markers: Mutex::new(Vec::new()),
            }
        }

        pub fn project(id: &str, environment: &str, dir: &str, name: &str) -> Project {
            Project {
                id: id.to_string(),
                environment: environment.to_string(),
                wsl_distro: None,
                working_dir: dir.to_string(),
                name: name.to_string(),
                created_at: "2026-10-01T00:00:00Z".to_string(),
                updated_at: "2026-10-01T00:00:00Z".to_string(),
                last_opened_at: None,
            }
        }
    }

    impl ProjectStore for MockProjectStore {
        fn ensure_schema(&self) -> Result<(), String> {
            Ok(())
        }

        fn all(&self) -> Result<Vec<Project>, String> {
            Ok(self.rows.lock().unwrap().clone())
        }

        fn get(&self, id: &str) -> Result<Option<Project>, String> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .find(|p| p.id == id)
                .cloned())
        }

        fn put(&self, project: &Project) -> Result<(), String> {
            let mut rows = self.rows.lock().unwrap();
            // 唯一索引 (environment, working_dir) 的语义：其他行占用同一键 → 拒绝
            if rows.iter().any(|p| {
                p.id != project.id
                    && p.environment == project.environment
                    && p.working_dir == project.working_dir
            }) {
                return Err(format!(
                    "UNIQUE constraint failed: projects.environment, projects.working_dir ({} / {})",
                    project.environment, project.working_dir
                ));
            }
            match rows.iter_mut().find(|p| p.id == project.id) {
                Some(slot) => *slot = project.clone(),
                None => rows.push(project.clone()),
            }
            Ok(())
        }

        fn remove(&self, id: &str) -> Result<bool, String> {
            let mut rows = self.rows.lock().unwrap();
            let before = rows.len();
            rows.retain(|p| p.id != id);
            Ok(rows.len() != before)
        }

        fn marker(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self
                .markers
                .lock()
                .unwrap()
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone()))
        }

        fn set_marker(&self, key: &str, value: &str) -> Result<(), String> {
            let mut markers = self.markers.lock().unwrap();
            match markers.iter_mut().find(|(k, _)| k == key) {
                Some(slot) => slot.1 = value.to_string(),
                None => markers.push((key.to_string(), value.to_string())),
            }
            Ok(())
        }
    }

    /// 内存实现的行语义（put 覆盖 / 唯一键拒绝 / remove 命中 / marker 覆盖）
    #[test]
    fn mock_store_roundtrip() {
        let store = MockProjectStore::new(vec![]);
        store.ensure_schema().expect("schema");
        store
            .put(&MockProjectStore::project("p1", "linux", "/srv/a", "a"))
            .expect("put");
        assert_eq!(store.all().unwrap().len(), 1);

        let mut renamed = MockProjectStore::project("p1", "linux", "/srv/a", "改名");
        renamed.last_opened_at = Some("2026-10-02T00:00:00Z".to_string());
        store.put(&renamed).expect("update");
        assert_eq!(store.all().unwrap().len(), 1, "同 id 覆盖不新增行");
        assert_eq!(store.get("p1").unwrap().unwrap().name, "改名");

        let dup = store
            .put(&MockProjectStore::project("p2", "linux", "/srv/a", "dup"))
            .expect_err("同键第二条必须被拒");
        assert!(dup.contains("UNIQUE constraint"), "got: {dup}");
        assert!(store.get("p2").unwrap().is_none(), "被拒的写不得落库");

        assert!(store.remove("p1").unwrap());
        assert!(!store.remove("p1").unwrap(), "未知 id 幂等 false");

        assert!(store.marker("k").unwrap().is_none());
        store.set_marker("k", "v1").unwrap();
        store.set_marker("k", "v2").unwrap();
        assert_eq!(store.marker("k").unwrap().as_deref(), Some("v2"));
    }
}
