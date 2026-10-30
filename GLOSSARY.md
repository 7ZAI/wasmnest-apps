# wasmnest-apps

应用仓（wasm 应用业务主场）的领域词汇。只收本仓特有的概念，不收通用编程词汇与实现细节。

## Language

**环境（Environment）**：
宿主机器上的 Node.js 运行时（含 npm）。bedcode 的 Agent 管理域（原 agent-hub）只认这一种编程环境。
shell 侧的三取值（linux / wsl2 / windows）**不叫环境**，见「执行环境」。
_Avoid_: 依赖、工具链、开发环境、runtime

**探测（Probe）**：
只读采集某样东西在宿主机上是否存在及其版本，不产生任何安装副作用。
_Avoid_: 检测、扫描

**未安装（Not installed）**：
探测成功，并且确认目标不存在。
_Avoid_: 未检测到、缺失、未找到

**探测失败（Probe failed）**：
探测本身没有得到结论（进程失败、超时、输出无法解析），目标是否存在未知。
_Avoid_: 未安装、error、失败

**引导（Bootstrap）**：
把环境装到宿主机上并让它在 PATH 上可见的过程。
_Avoid_: 安装（用于 CLI）、部署、环境初始化

**安装（Install）**：
把某个 agent CLI 装到宿主机上。
_Avoid_: 引导（用于 node）

**就绪（Ready）**：
探测成功、版本满足最低要求、且对后续命令可见。
_Avoid_: 已安装、ok

## 项目与运行（bedcode 桌面主线）

**项目（Project）**：
BedCode 桌面的一级容器：一个本地目录 + 一个执行环境。同一目录在不同执行环境下是两个项目。
_Avoid_: 工作区、workspace、仓库、repo

**执行环境（Execution environment）**：
`linux` / `wsl2` / `windows` 三取其一，描述命令在哪种 shell 里执行。项目的身份维度之一。
_Avoid_: 环境（与 Node 环境混用）、平台、系统

**运行（Run）**：
一次 agent 进程的启动及其之后的全部对话。一个运行 = 一条 PTY + 一个会话。取代旧称「终端会话」。
_Avoid_: 会话、终端、session（用于本义）、任务

**会话（Session）**：
**只指 agent 自己的会话**（pi 的 session id、opencode 的 `ses_*`），存在 agent 账本里，BedCode 只引用不拥有。
_Avoid_: 用于 BedCode 的 PTY 运行

**账本（Ledger）**：
agent 自己持久化的事件记录（pi 的 JSONL、opencode 的 SQLite）。BedCode 只读，从不代写。
_Avoid_: 日志、log、记录、历史

**桥接（Bridge）**：
注入到项目目录里的 agent 原生扩展：把 agent 事件推给 BedCode，把 BedCode 的命令拉下去执行。
_Avoid_: 钩子、hook、插件（与 agent 自己的插件区分）

**驱动（Driver）**：
每个 agent 一份的适配声明：怎么探测、怎么启动、注入哪份桥接、支持哪些能力（流式粒度 / 写入 / 权限代传 / 恢复）。
_Avoid_: 适配器、adapter、profile、agent 类型（用于泛指）

**归一事件（Normalized event）**：
跨 agent 统一的事件形状（`kind` + `payload`），前端只认它，不认任何一家的原始格式。
_Avoid_: 消息、message、日志行
