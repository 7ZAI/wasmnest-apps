# Nest 助手（servers/assistant）

系统级个人助手「Nest / 巢」：情感陪伴对话 + 应用调度执行，独立于 BedCode。
设计真源 = 平台仓 `.scratch/2026-11-11-personal-assistant/spec.md`（D1–D17 定稿），
票单 = `.scratch/2026-11-11-personal-assistant/issues/`。

## 结构（spec §5.1）

- `shared/` — TS 共享核（不单独发布）：双端同构的共享类型与共享 UI 组件（D3）。
- `rust/plugin/` — 共享 Rust crate（sharedRustManifest 模式，双端单产物，ADR 0050）。
- `desktop/` / `mobile/` — 双端工程：只写入口与宿主适配，构建产物随宿主分发。

## 变更记录

### 0.0.1（2026-11-12）— 票 05：双端骨架

- 建立 `servers/assistant` 双端 wasm 应用骨架（`type: internal-business`，L2 系统服务）。
- 共享 Rust crate `wasmnest-plugin-assistant`：双端单产物，骨架阶段导出
  `assistant.ping` 一条命令，验证「前端调用 → 共享 crate 命令 → 宿主返回」链路。
- 共享 TS 核起步：`shared/types.ts` + 共享占位视图 `PlaceholderView.vue`（端无关，纯 props）。
- 双端占位页：挂载后自动跑一次 ping，链路状态显性呈现（fail-visible，spec §2.4）。
- manifest（spec 附录 A 草案的骨架子集）：
  - 权限 `storage` / `apps:control` / `ui:globalEntry`（`network:http` / `broadcast`
    随票 08 流式落地时补）；
  - `contributes.globalEntries` 注册全局入口「Nest」（order 10）；
  - 命令面只含 `assistant.ping`，真实命令（chat-stream / vault-* / memory-* /
    audit-list）随票 07–14 加入共享 crate 与清单。
- 平台接线：桌面 `PLUGINS` 注册表收录 `com.wasmnest.assistant`；
  `release-manifest.json` 增 `servers/assistant` 条目；边界锁
  `hostAppBoundaryLock.test.ts` 收录本应用 `entry.ts` 契约。
- 待办（后续票）：对话主链路（08）、多会话（09）、provider 适配（10）、
  人格与首次使用（11）、数据底座与保险库（07）、记忆（12）、工具运行时（13）、
  记忆工具与注入（14）、应用工具接入（15）、验收与文档（16）。
