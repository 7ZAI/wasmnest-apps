/**
 * 桌面插件 WASM 构建统一配置（票 03 构建链全量 wasip3）
 *
 * 单一事实来源 = 平台仓 `scripts/wasip3-toolchain.sh`（WASIP3_NIGHTLY）；本文件
 * 自三仓拆分起由应用仓持有（票 03 登记方案①：app build.js 的直接 import 在本仓，
 * 平台仓 wasip3-toolchain.sh 的 `health` 以 `<appsRoot>/target/wasm-apps` 与
 * WASM_TARGET_DIR 对齐）。stable 1.99（预计 2026-10 中）发布后移除 nightly pin，
 * 见旧仓 `docs/knowledge/wasip3-toolchain.md`。各 app `scripts/build.js` 与本文件同步。
 */

/** 桌面插件统一 wasm target（wasm32-wasip3 产物 cdylib 直出 Component） */
export const WASM_TARGET = 'wasm32-wasip3'

/** 提供 wasm32-wasip3 预编译 std 的 pinned nightly（stable 1.98.1 无该 target） */
export const WASIP3_NIGHTLY = 'nightly-2026-09-16'

/**
 * wasm 应用共享 target 目录（**相对各 wasm 应用工程目录**，即 build.js 的 ROOT）
 *
 * 背景：各 wasm 应用各自独立 workspace，cargo 默认把产物写进**各自 crate 根的
 * `rust/target/`**，于是各应用共用的依赖（SDK `wasmnest-plugin-api`、proc-macro
 * `wasmnest-plugin-api-macros`、wit-bindgen、serde…）被重复编译并重复占盘
 * （2026-09-26 实测：4 个应用合计 5.8G）。改由 `--target-dir` 指向本目录后，
 * 依赖图只编译一次。
 *
 * 三仓拆分后落点 = 应用仓根的 `target/wasm-apps`（app 工程目录在
 * `<appsRoot>/apps/<slug>/<end>`，故相对深度为三级）。与平台仓的测试夹具目录
 * （`wasmnest-desktop/target/fixtures`）**刻意分开**：夹具 crate 定义了
 * `[profile.release] opt-level="s" / lto=true`，而 wasm 应用无 `[profile.*]`
 * （用 cargo 默认）；profile 参与产物指纹，同目录会为同一份依赖图产出两份产物。
 *
 * 同步点：平台仓 `scripts/wasip3-toolchain.sh` 的 `health` 子命令同样构建这几个
 * 应用，那里按 `<appsRoot>/target/wasm-apps` 取值（两处注释互相指认）；手工 cargo
 * 调用由应用仓根 `.cargo/config.toml` 的 `build.target-dir` 兜底到同一目录。
 */
export const WASM_TARGET_DIR = '../../../target/wasm-apps'

/** cargo 构建时注入 pinned nightly 的 env 片段（execSync env 选项用） */
export function wasip3CargoEnv() {
  return { ...process.env, RUSTUP_TOOLCHAIN: WASIP3_NIGHTLY }
}
