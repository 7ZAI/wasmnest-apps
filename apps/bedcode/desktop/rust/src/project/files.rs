//! 项目工作目录的文件浏览（桌面命令面）
//!
//! 项目工作台的右栏要展示「当前项目的文件目录树」，与移动端文件浏览同语义：
//! 按 `working_dir` 收敛根、单层懒加载、排除重目录、文件内容只读。
//!
//! **为什么是命令而不是复用 file_browse 的 HTTP 端点**：桌面前端没有 HTTP 面
//! （`PluginContext` 里 `http` 已随宿主下沉退役，前端零资源访问红线），所有取数
//! 只走 `context.commands.execute`。本域因此把同一套 `file_browse::ops` 编排
//! 包成 `project.file-tree` / `project.file-content` 两条命令——树扫描、containment、
//! 排除规则、大小上限全部复用，不在这里重写一份文件系统语义。
//!
//! 授权口径与 HTTP 面一致：先经 `fs_request_auth` 申请工作区访问（项目目录通常
//! 在 `project.pick-dir` 时已被宿主记住，重复申请直接返回 true），再读目录。
//! 失败显性上抛（未授权 / 目录不存在 / 越界），不静默返回空树。

use crate::file_browse::ops::{self, ExcludeFilter};
use crate::file_browse::source::FsPort;

/// 目录树默认排除项（与移动端文件树 `DEFAULT_SETTINGS.filterPatterns` 同口径）
pub const DEFAULT_EXCLUDES: &[&str] = &["node_modules", "target", ".git", "dist", "build"];

/// 默认排除项的所有权形式（命令面缺省值）
pub fn default_excludes() -> Vec<String> {
    DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect()
}

/// 把相对目录解析成绝对路径：空 / `.` = 工作目录根；绝对路径显性拒绝
///
/// 与 `file_browse` 的 `file-tree-children` 端点同语义：目录穿越的最终裁决仍在
/// [`ops::is_within_root`]（canonicalize 后组件级比较），这里只挡明显不合法的输入。
pub fn resolve_target_dir(working_dir: &str, dir_path: &str) -> Result<String, String> {
    let trimmed = dir_path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Ok(working_dir.to_string());
    }
    if ops::is_absolute_path(trimmed) {
        return Err("dir_path must be relative to working directory".to_string());
    }
    Ok(ops::join_path(working_dir, trimmed))
}

/// 读取工作目录下某一层的子节点（懒加载的一次展开）
///
/// 目标必须存在且是目录（404 语义），canonicalize 后必须仍在工作目录内（403
/// 语义）——错误文案与 HTTP 面逐字一致，双端最终看到的是同一句话。
pub fn list_children(
    fs: &impl FsPort,
    working_dir: &str,
    dir_path: &str,
    filters: &[ExcludeFilter],
) -> Result<Vec<serde_json::Value>, String> {
    let target = resolve_target_dir(working_dir, dir_path)?;
    let is_dir = fs.stat(&target)?.map(|stat| stat.is_dir).unwrap_or(false);
    if !is_dir {
        return Err(format!("Directory not found: {}", dir_path.trim()));
    }
    if !ops::is_within_root(fs, working_dir, &target) {
        return Err("Access denied: directory is outside working directory".to_string());
    }
    ops::scan_dir_single_level(fs, working_dir, &target, filters)
}

/// 读取工作目录内的一个文件（复用 file_browse 的大小上限 / 越界 / 二进制判定）
pub fn read_content(
    fs: &impl FsPort,
    working_dir: &str,
    file_path: &str,
) -> Result<serde_json::Value, String> {
    match ops::read_file_content(fs, working_dir, file_path) {
        Ok(Ok((content, file_name))) => Ok(serde_json::json!({
            "content": content,
            "fileName": file_name,
        })),
        Ok(Err((_code, message))) => Err(message),
        Err(e) => Err(e),
    }
}

// ==================== wasm：项目解析 + 授权 + 端口 ====================

/// 取项目工作目录并申请 fs 授权（本域命令的公共前置；git 读面复用）
#[cfg(target_arch = "wasm32")]
pub(super) fn authorized_working_dir(project_id: &str) -> Result<String, String> {
    use super::store::ProjectStore;
    use wasmnest_plugin_api::host::HostFs;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    let project = ProjectStore::get(&WasmHost, project_id)?
        .ok_or_else(|| format!("Not found: project not found: {project_id}"))?;
    let dir = project.working_dir;
    if !dir.is_empty() {
        match WasmHost.fs_request_auth(&[dir.clone()]) {
            Ok(true) => {}
            Ok(false) => {
                return Err(format!(
                    "Not authorized: workspace access not granted for {dir}"
                ))
            }
            Err(e) => {
                return Err(format!(
                    "Not authorized: workspace access request failed for {dir}: {}",
                    e.message
                ))
            }
        }
    }
    Ok(dir)
}

/// 项目目录单层子节点：`{projectId, dirPath?, excludeDirs?}` → `{children}`
#[cfg(target_arch = "wasm32")]
pub fn tree_via_host(
    project_id: &str,
    dir_path: &str,
    exclude_dirs: Option<&[String]>,
) -> Result<serde_json::Value, String> {
    use wasmnest_plugin_api::wasm_host::WasmHost;

    let root = authorized_working_dir(project_id)?;
    let excludes = exclude_dirs
        .map(|values| values.to_vec())
        .unwrap_or_else(default_excludes);
    let filters = ops::build_exclude_filters(&excludes);
    let children = list_children(&WasmHost, &root, dir_path, &filters)?;
    Ok(serde_json::json!({ "children": children }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tree_via_host(
    _project_id: &str,
    _dir_path: &str,
    _exclude_dirs: Option<&[String]>,
) -> Result<serde_json::Value, String> {
    Err("project files unavailable outside wasm runtime".to_string())
}

/// 项目文件内容：`{projectId, filePath}` → `{content, fileName}`
#[cfg(target_arch = "wasm32")]
pub fn content_via_host(project_id: &str, file_path: &str) -> Result<serde_json::Value, String> {
    use wasmnest_plugin_api::wasm_host::WasmHost;

    let root = authorized_working_dir(project_id)?;
    read_content(&WasmHost, &root, file_path)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn content_via_host(_project_id: &str, _file_path: &str) -> Result<serde_json::Value, String> {
    Err("project files unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_browse::source::tests::MockFs;

    fn temp_workspace() -> (std::path::PathBuf, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("work");
        std::fs::create_dir_all(&root).expect("create root");
        (root, dir)
    }

    #[test]
    fn list_children_returns_sorted_relative_nodes_and_applies_excludes() {
        let (root, _dir) = temp_workspace();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("main.rs"), "fn main(){}").unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("README.md"), "# readme").unwrap();

        let fs = MockFs;
        let filters = ops::build_exclude_filters(&["node_modules".to_string()]);
        let children = list_children(&fs, &root.to_string_lossy(), "", &filters).unwrap();

        let names: Vec<&str> = children
            .iter()
            .map(|node| node["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec!["src", "README.md"],
            "文件夹在前 + 排除 node_modules"
        );
        assert_eq!(children[0]["path"], "src");
        assert!(
            children[0].get("children").is_none(),
            "单层扫描不带 children"
        );
        assert_eq!(children[1]["nodeType"], "file");
    }

    #[test]
    fn list_children_rejects_absolute_and_escaped_dirs() {
        let (root, dir) = temp_workspace();
        std::fs::create_dir_all(root.join("src")).unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();

        let fs = MockFs;
        let root_str = root.to_string_lossy().to_string();

        let absolute = list_children(&fs, &root_str, "/etc", &[]).unwrap_err();
        assert_eq!(absolute, "dir_path must be relative to working directory");

        let escaped = list_children(&fs, &root_str, "../outside", &[]).unwrap_err();
        assert_eq!(
            escaped,
            "Access denied: directory is outside working directory"
        );

        let missing = list_children(&fs, &root_str, "ghost", &[]).unwrap_err();
        assert_eq!(missing, "Directory not found: ghost");
    }

    #[test]
    fn read_content_returns_wire_shape_and_errors() {
        let (root, _dir) = temp_workspace();
        std::fs::write(root.join("ok.txt"), "hello").unwrap();

        let fs = MockFs;
        let value = read_content(&fs, &root.to_string_lossy(), "ok.txt").unwrap();
        assert_eq!(value["content"], "hello");
        assert_eq!(value["fileName"], "ok.txt");

        let missing = read_content(&fs, &root.to_string_lossy(), "ghost.txt").unwrap_err();
        assert_eq!(missing, "File not found: ghost.txt");
    }
}
