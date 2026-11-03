# notenote 剪贴板能力：跨仓后端实现，不局限于前端 API

**状态**：proposed（2026-11-02）

## 背景与问题

notenote 需要访问系统剪贴板，实现"从剪贴板粘贴"和"复制到剪贴板"功能。当前 WasmNest 平台**完全没有剪贴板后端能力**：

- WIT 层：所有 `*.wit` 文件中无 `clipboard` 相关接口
- SDK Rust trait 层：`host/` 目录下无 `clipboard.rs`
- 权限词汇表：`permission.rs` 的 36 条权限中无 clipboard 相关条目
- Tauri 宿主：未引入 `tauri-plugin-clipboard`，capabilities 中无 clipboard 权限声明

现有剪贴板代码仅存在于前端 TypeScript 层（移动端 WebView 内），使用浏览器 `navigator.clipboard.writeText()` + `document.execCommand('copy')` fallback。

### 两种实现路径

**路径 A：仅用前端浏览器 API**
- 在 notenote 前端直接调用 `navigator.clipboard.readText()` / `writeText()`
- 零后端改动，立即可用
- 缺点：需要用户授权弹窗、某些 WebView 环境可能受限、无法监听剪贴板变化

**路径 B：添加完整的后端剪贴板能力**
- 跨 3 个仓库（能力仓、平台仓、应用仓）逐层添加支持
- 工程量大，但提供原生体验、无浏览器限制、可复用于其他应用

## 决定

**采用路径 B：跨仓实现后端剪贴板能力**，分 6 层逐层添加：

### 第 1 层：能力仓（WIT 接口定义）

在 `wasmnest-lib/wasmnest-wasm-core/wit/` 新建 `cap-clipboard.wit`：

```wit
interface host-clipboard {
    read-text: func() -> result<option<string>, string>;
    write-text: func(text: string) -> result<_, string>;
}
```

在 `wasmnest.wit` 的 `world plugin` 中 `include cap-clipboard`。

### 第 2 层：平台仓 SDK Rust trait

在 `wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/host/clipboard.rs` 定义：

```rust
pub trait HostClipboard {
    fn clipboard_read_text(&self) -> Result<Option<String>, HostError>;
    fn clipboard_write_text(&self, text: &str) -> Result<(), HostError>;
}
```

### 第 3 层：权限词汇

在 `plugin-sdk-desktop/rust/src/permission.rs` 添加两条权限：

```rust
pub const PERMISSION_CLIPBOARD_READ: &str = "clipboard:read";
pub const PERMISSION_CLIPBOARD_WRITE: &str = "clipboard:write";
```

更新 `permission-vocabulary.json` 生成器。

### 第 4 层：Tauri 宿主插件

在 `wasmnest-desktop/src-tauri/Cargo.toml` 添加依赖：

```toml
tauri-plugin-clipboard-manager = "2"
```

在 `src-tauri/src/lib.rs` 注册插件：

```rust
.setup(|app| {
    app.handle().plugin(tauri_plugin_clipboard_manager::init())?;
    Ok(())
})
```

### 第 5 层：宿主实现桥接

在 `wasmnest-desktop/src-tauri/src/plugin/clipboard.rs` 实现 WIT interface 到 Tauri plugin 的桥接：

```rust
impl HostClipboard for PluginContext {
    fn clipboard_read_text(&self) -> Result<Option<String>, HostError> {
        let clipboard = self.app.clipboard();
        Ok(clipboard.read_text().ok().flatten())
    }
    
    fn clipboard_write_text(&self, text: &str) -> Result<(), HostError> {
        let clipboard = self.app.clipboard();
        clipboard.write_text(text).map_err(|e| HostError::new(e.to_string()))
    }
}
```

### 第 6 层：capabilities 声明

在 `wasmnest-desktop/src-tauri/capabilities/default.json` 添加：

```json
{
  "permissions": [
    "clipboard:default"
  ]
}
```

### 应用仓使用

notenote 的 `plugin.json` 声明权限：

```json
{
  "permissions": ["clipboard:read", "clipboard:write"]
}
```

Rust 后端调用：

```rust
let text = ctx.clipboard_read_text()?;
ctx.clipboard_write_text("Hello")?;
```

## 理由

### 选择后端能力的优势

1. **原生体验**：无浏览器授权弹窗、无 WebView 限制
2. **跨应用复用**：bedcode 的终端复制/粘贴、ai-chatbox 的消息复制等场景均可受益
3. **扩展能力**：未来可轻松添加 `readImage` / `writeImage` / `onClipboardChange` 等能力
4. **一致性**：与现有 `host-fs` / `host-http` 等能力的设计模式一致

### 不用前端 API 的理由

1. **用户体验差**：浏览器 `navigator.clipboard.readText()` 需要用户授权弹窗，打断工作流
2. **环境受限**：某些 WebView 配置可能禁用 Clipboard API，导致功能不可用
3. **无法扩展**：前端 API 只能读写文本，无法支持图片、HTML 等格式
4. **重复造轮子**：其他应用（bedcode、ai-chatbox）也有剪贴板需求，前端 API 无法共享

### 跨仓工程的合理性

虽然跨 3 个仓库改动量大，但：

1. **符合架构原则**：WasmNest 的设计就是"能力仓提供机制，应用仓实现语义"
2. **一次性投入**：剪贴板是基础能力，一次实现永久受益
3. **版本钉法清晰**：能力仓打 WIT tag → 平台仓更新 SDK 版本 → 应用仓更新依赖
4. **不影响现有应用**：新增能力是纯增量，不破坏已有接口

## 后果

### 正面

- notenote 获得原生剪贴板体验，无授权弹窗
- 其他应用可复用剪贴板能力（bedcode 终端、ai-chatbox 消息等）
- 平台能力面更完整，接近 Tauri 原生应用的体验

### 负面

- 跨仓工程量大（预计 3-5 天工作量）
- 需要协调 3 个仓库的发布节奏
- 新增 2 条权限词汇，增加权限管理的复杂度

### 风险与缓解

- **跨仓同步失败**：能力仓 WIT 变更与平台仓 SDK 变更不同步
  - 缓解：使用 tag 钉住版本（`wit-v0.0.x` + `sdk-v0.0.x`），CI 校验一致性
- **权限泄露**：应用滥用剪贴板能力读取敏感信息
  - 缓解：权限显式声明（`clipboard:read` / `clipboard:write`），宿主侧弹窗授权
- **Tauri 插件兼容性**：`tauri-plugin-clipboard-manager` 在某些平台有 bug
  - 缓解：充分测试 Windows/macOS/Linux 三端，必要时 fallback 到前端 API

## 实施计划

### 阶段 1：能力仓（0.5 天）

1. 新建 `wit/cap-clipboard.wit`，定义 `host-clipboard` interface
2. 在 `wasmnest.wit` 中 `include cap-clipboard`
3. 打 tag `wit-v0.0.x`

### 阶段 2：平台仓（2 天）

1. SDK Rust trait：`host/clipboard.rs`
2. 权限词汇：更新 `permission.rs` + `permission-vocabulary.json`
3. Tauri 插件：添加 `tauri-plugin-clipboard-manager` 依赖 + 注册
4. 宿主实现：`plugin/clipboard.rs` 桥接 WIT 到 Tauri
5. capabilities：更新 `default.json`
6. 测试：cargo test + 手动验证三端
7. 打 tag `host-v0.0.x` + 更新 SDK npm 版本

### 阶段 3：应用仓（1 天）

1. notenote `plugin.json` 声明权限
2. Rust 后端调用 `clipboard_read_text` / `clipboard_write_text`
3. 前端 UI：工具栏"从剪贴板粘贴"按钮
4. 测试：vitest + E2E
5. 更新 `host-runtime.lock.json`

### 阶段 4：集成验证（0.5 天）

1. 平台仓 `pnpm run check:manifest` 通过
2. notenote 在真实宿主中测试剪贴板读写
3. 回归测试：确认其他应用（bedcode、ai-chatbox）未受影响

## 替代方案

### 方案 A：仅用前端浏览器 API

- 在 notenote 前端直接调用 `navigator.clipboard`
- 优点：零后端改动，1 小时内完成
- 缺点：用户体验差（授权弹窗）、无法复用、无法扩展
- 结论：**拒绝**，短期省事但长期代价高

### 方案 B：部分后端能力（仅 readText）

- 只实现 `clipboard_read_text`，写入仍用前端 API
- 优点：减少一半工作量
- 缺点：能力不完整，其他应用仍需自己实现写入
- 结论：**拒绝**，能力面应该完整

### 方案 C：延迟到有需要时再实现

- notenote 先用前端 API，等其他应用也需要时再统一实现
- 优点：避免过早优化
- 缺点：notenote 用户体验差，且未来仍需迁移
- 结论：**拒绝**，用户明确要求后端能力

## 参考

- Tauri Clipboard Plugin：`https://github.com/tauri-apps/plugins-workspace/tree/v2/packages/clipboard-manager`
- W3C Clipboard API：`https://www.w3.org/TR/clipboard-apis/`
- WasmNest 权限模型：`wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`
- 用户需求评审：2026-11-02（用户明确选择"后端能力，跨仓实施"）
