# 项目取代终端会话成为 BedCode 桌面的一级容器

**状态**：accepted（2026-10-29）

## 背景与问题

桌面 bedcode 今天以「终端会话」为核心：`session_configs(name, environment, wslDistro,
workingDir, command, autoStart)` 把「在哪跑」和「跑什么」压成一行配置，agent 只是 `command`
字段里的一个字符串（`useLaunchSession.ts` 直接把 `agent.binary` 填进去）。侧边栏五项里四项
围绕会话，任务队列每条任务挂一个 `session_id`（`task_queue.session_id`），agent 自己的
session id 只能反查（`task_session_mapping.claude_sid`）。

用户要的工作方式是：先有项目（一个目录），再在同一个项目里挑不同 agent 反复干活、并发对比。
「会话」这个容器装不下两件事——它既不是目录（同一目录可有多份配置，配置名与目录无约束关联），
也不是分组（无法表达「这个项目的全部活动」）。

## 决定

1. **一级容器 = 项目**：`projects(id, environment, wsl_distro, working_dir, name, created_at,
   updated_at, last_opened_at)`，唯一键 `(environment, working_dir)`。同目录重复建项目直接
   复用并跳转，不建第二条（同目录在两个执行环境下是两个项目）。去重键的归一化规则
   （末尾分隔符、Windows 大小写）在 `project/ops.rs`，唯一索引只是兜底。
2. **运行（run）取代终端会话**：账本式重命名 `sessions` → `runs`，加列 `project_id` /
   `agent_id` / `agent_session_id` / `title` / `model` / `truncated`。PTY 仍由插件自持
   （`host-pty`），一个运行一条 PTY；`task_session_mapping.claude_sid` 的语义并入
   `runs.agent_session_id`——**写入方随 M3 桥接落地**，在那之前任务域仍以反查表为真源
   （2026-10-30 评审修订：M2 只建列与视图，不改任务读写面）。**行不再随宿主重启清空**：
   启动对账只把非终态运行收敛成 `Error` 并清空 `pty_id`（句柄是进程内存，行是历史）。
3. **`session_configs` 降级为启动模板**：保留表，语义改为「项目 × agent 的启动参数」
   （command / args / env / autoStart），不再是独立导航对象，只在项目内编辑。
4. **一个项目可并发多个运行**：不设每项目上限，由 `ptyQuota: 8` 兜底。独立终端窗口
   （`/terminal-window/:id`，bareWindow）保留为一等逃生口。
5. **任务域改绑定键，不改执行语义**：`task_queue.session_id` → `project_id + agent_id`；
   任务投递给该项目下该 agent 的活跃运行，没有活跃运行则停留 pending 并显性提示。
   「定时任务自动拉起运行」是独立后续票，不在本轮（否则 2200 行调度状态机要重写）。
6. **移动端不改**：`session.*` 命令面与互调 api 形状保留，`sessionId` 即 `runId`；移动端
   会话列表按项目分组展示（后端补字段，不-breaking）。
7. **迁移**：`session_configs` 按 `(environment, workingDir)` 去重生成 `projects`；旧
   `sessions` 按 config 归属进 `runs`；**无法归属的（`config_id` 空 / 配置已删 / 配置目录为空）
   历史运行直接丢弃并记日志**（`plugin_meta` 的 `project.migration_log` 逐个点名）——研发期
   无真实用户，不背这个包袱。**例外**：`session_configs` 表本身不在（新装 / 配置面降级）时
   不删任何运行，只标未归属——一次读取失败不等于「配置已删光」。

## 后果

- 侧边栏六项：设备配对 100 / **项目 190** / 终端会话 200 / Agent 管理 205 / Agent 任务 210 /
  设置 9999。项目与终端会话**并存**（用户 2026-10-29 裁定：新增项目入口，不替换旧入口；
  退役时机待 M3 对话面成形后评估）——2026-10-30 按实现修订，原文「项目 200 / 终端会话退役」
  已作废。
- 路由：`/projects`（列表）、`/projects/:id`（工作台）、`/terminal-window/:runId`（不变）。
- 命令面：新增 `project.*`；`session.*` 28 条保留为运行的兼容投影，不再新增能力，
  新能力只进 `project.*` / `run.*`。
- 迁移必须在各域 `ensure_schema` **之前**执行（沿用 `schema.rs` 的账本式重命名纪律：
  先建新名会让旧数据永久留在无人读的名字下，现象是「升级后列表变空」）。
- E2E：`e2e/specs/bedcode.spec.ts` 的侧边栏断言改为六项，并新增项目路径用例（建项目 →
  起两条运行 → 终端真实字节 → 运行间切换 → 整页刷新后列表仍在）；断言状态位而非文案。
- 跨仓面不动：`appId` / `rustLibrary` / `release-manifest.json` 均无需变更。
