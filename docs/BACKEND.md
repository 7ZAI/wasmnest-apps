# BACKEND —— Rust（WASM）后端规范

> 适用范围：各 app 的 `rust/` crate 与 `apps/file-transfer/rust/{core,plugin}`。
> 结构导航见 `docs/CODE-MAP.md`；前端规范见 `docs/FRONTEND.md`；裁决与硬约束见 `AGENTS.md`。
>
> SDK 的 API / 类型真源在平台仓（`wasmnest-{desktop,mobile}/packages/plugin-sdk-*/rust`）；WIT / ABI 真源在能力仓，**都不在本仓改**。

---

## 1. crate 全景（实测）

| crate 包名 | 位置 | 端 | 产物 / rustLibrary | `[features]` |
| --- | --- | --- | --- | --- |
| `wasmnest-plugin-agent-hub` | `apps/agent-hub/desktop/rust` | desktop | `wasmnest_plugin_agent_hub` | `default=["native"]`, `native`, `wasm` |
| `wasmnest-plugin-ai-chatbox` | `apps/ai-chatbox/desktop/rust` | desktop | `wasmnest_plugin_ai_chatbox` | `default=["wasm"]`, `wasm`（**无 native**） |
| `wasmnest_plugin_ai_chatbox` | `apps/ai-chatbox/mobile/rust` | mobile | `wasmnest_plugin_ai_chatbox` | `default=[]`, `wasm` |
| `wasmnest-plugin-monitor` | `servers/monitor/desktop/rust` | desktop | `wasmnest_plugin_monitor` | `default=["wasm"]`, `wasm`（无 native） |
| `wasmnest_plugin_monitor` | `servers/monitor/mobile/rust` | mobile | `wasmnest_plugin_monitor` | `default=[]`, `wasm` |
| `bedcode-plugin-terminal-session` | `apps/bedcode/desktop/rust` | desktop | `bedcode_plugin_terminal_session` | `default=["native"]`, `native`, `wasm` |
| `bedcode_plugin_terminal_session` | `apps/bedcode/mobile/rust` | mobile | `bedcode_plugin_terminal_session` | `default=[]`, `wasm` |
| `wasmnest-plugin-file-transfer` | `apps/file-transfer/rust/plugin` | **双端单产物** | `wasmnest_plugin_file_transfer` | `default=["native"]`, `native`, `wasm` |
| `wasmnest-file-transfer-core` | `apps/file-transfer/rust/core` | 共享业务核（无 SDK 依赖） | 不直接出产物 | 无 features |

> **feature 口径并不统一**（`ai-chatbox/desktop` 的 default 就是 `wasm`，移动端 crate 没有 `native`）。构建链统一用 `--no-default-features --features wasm`，因此不受影响；但**手工 `cargo test` / 新增 feature 分支前，先读该 crate 的 `[features]`**。

---

## 2. Cargo.toml 口径

```toml
[lib]
crate-type = ["cdylib"]          # 只 cdylib；**不要加 rlib**

[dependencies]
# 桌面（apps/<slug>/desktop/rust 深度 = 5 级上溯）
wasmnest-plugin-api = { path = "../../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/rust", features = ["wasm"] }
# 移动
wasmnest-plugin-api-mobile = { path = "../../../../../wasmnest/wasmnest-mobile/packages/plugin-sdk-mobile/rust", features = ["wasm"] }
```

- **只 `cdylib`，不加 `rlib`**：一旦声明可链接形式，cargo 会连带为宿主目标构建 x86_64 cdylib，而本 crate 的 wit-bindgen 导出名在 ELF version script 里非法 ⇒ 链接期直接失败（bedcode 票 08 实测）。因此跨端契约测试写成 `src/*_test.rs` 的 `#[cfg(test)]` 模块，而不是 `tests/*.rs` 集成目标。
- **`rustLibrary` = Cargo 包名的下划线归一化**：`bedcode-plugin-terminal-session` → `bedcode_plugin_terminal_session.wasm`。填连字符形式会找不到产物（`manifest-validate` 也要求 `pluginType=rust-ts` 时必须给 `rustLibrary`）。
- **相对路径深度随目录层级变**：file-transfer 的 rust 层历史上移过两次（`desktop/rust` → `rust-plugin` → `rust/plugin`），SDK path 现在是 5 级上溯。移动这些目录时，`Cargo.toml` 的 SDK path、`lib.rs` 的 `include_str!`、`auth_center.rs` 的 `#[plugin_api(manifest = …)]` **三处必须同改**。

---

## 3. 实现面

- 骨架：`WasmPlugin` trait（`ID` / `manifest()` / `activate()` / `deactivate()` / `invoke_command()` / 消息回调）+ `wasm_entry!(Struct)`。
- 命令：在 `invoke_command(name, args)` 里 `match name`，未知命令**必须** `Err(anyhow!("unknown command: {name}"))`，不静默返回空。
- `plugin.json.contributes.commands` 与实现**同步**（manifest-gen 可按源码自动补命令面，但**自动填充是便利不是真源**）。
- 消息：桌面宿主要求 `on_message(topic, sender, payload)`，移动宿主要求 `on_bus_message(topic, payload)`（WIT events 并集）。双端同构 crate **两个都实现**并路由到同一内部处理。

### 跨插件互调

经平台 `host-api-call` + JSON-RPC 2.0（ADR 0017）：被调方在 `plugin.json.api` 声明可被调用的命令，调用方经 `#[plugin_api(manifest = "<对侧 plugin.json 路径>")]` 声明 trait 生成 Client。**未声明不可调**。

```rust
// apps/file-transfer/rust/plugin/src/auth_center.rs
#[cfg(target_arch = "wasm32")]        // native 测试不消费 client，跳过宏展开避免死代码告警
#[plugin_api(manifest = "../../../bedcode/desktop/plugin.json")]
pub(crate) trait SessionCenterApi {
    #[api("consent-decide")]
    fn consent_decide(request: ConsentRequest) -> Result<ConsentDecision, String>;
}
```

> ⚠ `#[cfg(target_arch = "wasm32")]` 意味着 **native `cargo test` 不展开该宏** —— 对侧契约漂移只在 wasm 构建时暴露。改互调面后必须跑一次 wasm 目标构建。

### 双端单产物的平台分支（file-transfer）

同一份 `.wasm` 两端加载，差异不靠两份产物表达：

- 激活时经 `host-platform.platform()` 探测端值，**未知 / 空 = 拒绝激活**（猜错平台会让桌面分支静默跑在移动宿主上）。
- 差异收敛为「同一端口 trait 的双实现 + 运行期分支」（`platform.rs` / `adapters.rs` / `adapters_mobile.rs`）；编排层不出现散落的 `if platform == …`。
- 桌面专属能力（`reveal-in-dir` / `pick-download-dir` 等）在移动分支**显性报错**，不打进 unsupported 桩。
- 该 crate 依赖的是**桌面** SDK `wasmnest-plugin-api`（非移动 SDK），这是单产物例外，不是笔误。

---

## 4. 构建目标（两类，别混）

| 类别 | 目标 | 适用 | 工具链 |
| --- | --- | --- | --- |
| 一般桌面应用 | `wasm32-wasip3`（cdylib 直出 Component，免 componentize） | agent-hub / ai-chatbox / bedcode / monitor（servers）的 desktop | pinned nightly，由 `scripts/plugin-wasm-config.mjs` 的 `WASIP3_NIGHTLY` 注入 `RUSTUP_TOOLCHAIN`（单一事实源对齐平台 `scripts/wasip3-toolchain.sh`） |
| 移动应用 + 双端共享核 | `wasm32-unknown-unknown` + 组件化工具 | 全部 mobile crate；`file-transfer/rust/plugin` | stable 可编；经桌面 SDK 包自带的 `tools/componentize`（真源平台仓 `wasmnest-desktop/packages/plugin-sdk-desktop/tools/componentize`）编码为 Component（原地覆盖，幂等） |

统一经各 app `pnpm run build` / `build:rust`，**不要在命令行自带 target / toolchain 字面量**（真源在 `scripts/plugin-wasm-config.mjs`）。`WASMNEST_PLUGIN_DEBUG=1` 出 debug wasm（保留 DWARF）。

共享 target 目录 = `<appsRoot>/target/wasm-apps`（见 `docs/CODE-MAP.md` §4）。

---

## 5. 清单与权限

- `plugin.json` 必填：`id`（另有反域名格式校验）、`name`、`version`、`platform`、`main`、`pluginType`、`permissions`、`contributes`（真源 = SDK `bin/manifest-validate.js`；宿主反序列化无缺省，缺失即拒装）。
- `platform`：按工程所在端取 `desktop` / `mobile`；仅真正的双端单产物工程（file-transfer）写 **`both`** —— 注意它的 **desktop 与 mobile 两份 plugin.json 都写 `both`**。写错会被两端宿主在扫描与 zip 安装两条入口 fail-visible 拒绝。
- `pluginType`：桌面内置应用 `rust-ts`（必须给 `rustLibrary`）；移动应用 `wasm`。
- `wasmHash`：由构建链注入**产物目录**的 `plugin.json`（`bin/wasm-hash.js` 按 `<rustLibrary>.wasm` 现算 SHA-256）；**源清单不写该键**，手写会被 `manifest-validate` 告警且发布打包复核不一致即失败。
- **权限无默认授予**：必须在 `permissions` 显式声明（`storage` 也一样）。词汇唯一真源 = 平台 SDK `permission.rs`；`manifest-gen` 的映射表是消费方，**词汇表没有的位加载即抛错**，不得自造。
- 高风险面按域拆分（`pty:spawn` / `pty:io`、`ws:client` / `ws:server`、`task:run`），需要多少声明多少；文件系统走宿主授权链（预授权目录 → 已授权前缀 → 弹窗），**不要试图绕过**。
- 移动端另有 `preauthDirs`（支持 `${downloads}` 等占位）/ `preauthUrls`（出站 URL 白名单），宿主在 preauthorize 阶段收齐后一次弹窗；这两个键桌面上无效。

---

## 6. 日志与错误

- 日志经 SDK `HostLog`（`h.log_info` / `log_warn` / `log_error`），target / 前缀由宿主机制统一，**不要自建日志门面**。
- 跨边界失败走错误信封（ADR 0030）：`bail_with_code(code, params)`，**`code` 即前端 i18n key**；技术细节（错误原文 / 堆栈）不出产生方，**UI 不显示错误码**。
- 权限请求用 SDK 原语，不要在应用里自建安全机制。
- 非致命分支**留痕**：订阅 / 退订 / 句柄回收失败只记日志不翻成激活失败，但不留痕会让「插件关了却仍有订阅残留」这类问题无从排查。

---

## 7. 测试

```bash
cargo test --manifest-path <crate>/Cargo.toml            # 通用
cargo test --manifest-path apps/file-transfer/rust/core/Cargo.toml
cargo test --manifest-path apps/file-transfer/rust/plugin/Cargo.toml
pnpm run test:rust                                        # 仅 bedcode/desktop 提供
```

- 共享业务核（`rust/core`）与双端同构 crate（`rust/plugin`）**各在自身 crate 根测**；core 不依赖 SDK，是纯逻辑单测的主场。
- 构造 SDK 结构体夹具时**只列本用例断言字段 + `..Default::default()`** —— 逐字段列全会把 SDK 追加可选字段变成批红。
- **native 测试的覆盖边界**：`cargo test` 不展开 `#[plugin_api]` 宏、不产 wasm 产物。改动涉及宏路径 / 互调面 / 构建目标时，native 全绿**不等于**验证通过，必须再跑一次 wasm 目标构建（`pnpm run build` 或 `build:rust`）。
- 跨端真实互连测试在 `../wasmnest-test/cross-end-tests`（本仓改动涉及传输 / 认证面时去那边跑）。

---

## 8. 新增命令的检查清单

1. `invoke_command` 加分支（未知命令仍走 `Err`）。
2. `plugin.json.contributes.commands` 同步（跑一次构建或 `manifest --check` 确认无漂移）。
3. 需要的新权限位在 `permissions` 声明（核对 `permission.rs` 词汇）。
4. 若供其他应用组合，加进 `plugin.json.api` 并对侧加 `#[plugin_api]`。
5. 前端调用点改用新命令（`docs/FRONTEND.md` §4：只能经 `appInvoke` / `context.commands.execute`）。
6. 跑该 crate `cargo test` + 一次构建产物写出。
