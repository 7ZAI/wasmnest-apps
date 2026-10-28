# agent-hub 并入 bedcode：AI coding agent 的安装 → 启动会话 → 卸载闭环

**状态**：accepted（2026-10-28）

## 背景与问题

agent-hub 作为独立桌面应用管理四家 CLI coding agent（claude / codex / opencode / pi）的
安装、卸载、Skills、供应商、用量统计与会话日志——但它**从不启动 agent**（无终端能力），
「使用」这条腿天然缺位。bedcode 是会话真源：会话配置的 `command` 字段经登录 shell 包裹后
`pty_spawn`，且 rust 侧已有同四家 agent 的识别（`AGENT_PROFILES`）与任务钩子。两份 agent
注册表长期并存（agent-hub rust `AGENTS` 表 vs bedcode `AGENT_PROFILES`）是持续的漂移源。

用户目标：**一个入口形成闭环**——安装 → 启动终端会话使用 → 观察（统计/日志）→ 卸载。

## 决定

1. **物理并入，不保留独立应用**：agent-hub 的全部域（探测/安装卸载/Node 引导/Skills/
   供应商/用量统计/会话日志）整体迁入 bedcode（rust `src/hub/`、前端 `src/agents/`），
   agent-hub 从两个仓的登记面退役删除。命令面前缀 `agent-hub.*` → `agent.*`（46 条），
   事件通道 `plugin:agent-hub:*` → `plugin:bedcode:*`。
2. **闭环 glue**：
   - 启动：agent 卡片「启动会话」→ 弹窗（工作目录 / 环境 / 启动命令，预填
     `session.formDefaults`）→ 配置复用或新建（同 (environment, workingDir, command) 命中
     复用）→ `session.create {start:true}` → 开终端窗 → 跳 `/sessions`。
     `agent.list-agents` 载荷补 `binary` 字段作为 command 取值来源（缺省 = id）。
   - 卸载护栏：rust 侧在卸载前查运行中会话（`session::list_views_via_host(filter=running)`
     × `config::list_via_host` 关联 command × `detect_agent` 归属），命中即拒
     （业务码 `hub.inst.error.sessionRunning` 点名会话）。护栏查询失败不拦截（只收窄）。
   - Provider 注入维持 apply 模式（写各 CLI 自己的配置文件），会话内 agent 直接读；
     不做 `LaunchSpec.env` 注 key（通道已留，后续可选）。
3. **存量数据一次性迁移**：插件私有库按 plugin id 分库（`app_data_dir()/plugins/<id>`），
   agent-hub 退役后其库不可达。用量/检测/会话日志可从磁盘会话文件重扫重建（不计迁移）；
   **Provider 预设（含 API Key 明文）走文件桥**：agent-hub `agent-hub.export-presets` 导出
   全量预设到 `~/.wasmnest/agent-hub/runs/presets-export.json`（第一方免审目录，只落本机），
   bedcode `agent.import-presets` 读入按 name 幂等 upsert（单路径授权弹窗）。导出文件含
   明文 Key：绝不入仓、不进日志，导入完成后由用户删除。
4. **命名与权限**：bedcode manifest 补 `app:path`（Node 引导 register-path）与 `fs:pick`
   （目录选取）；hub 家目录豁免并入平台 `first_party_dirs.rs` 的 bedcode 条目。i18n 键保持
   `hub.*` 前缀并入 bedcode 三件套（不重排命名空间）。

## 后果

- 双注册表漂移源消除；agent 安装态与会话域在同一插件内，闭环动作原子。
- agent-hub 应用、其 e2e 套件（9 用例）与跨仓登记面（平台仓 PLUGINS / 路由 / 边界锁 /
  manifest / first_party_dirs / dev-shell mock）退役。
- 移动端不受影响（agent-hub 本就无移动端；bedcode 移动端远端启动会话经既有 HTTP 面）。
- agent-hub 独立发版 tag（`agent-hub-v*`）随之作废。
