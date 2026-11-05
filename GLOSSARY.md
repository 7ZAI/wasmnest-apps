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

## 烂笔头（lanbitou 应用）

**笔记（Note）**：
烂笔头的一等公民：一段 Markdown 文本 + 元数据（id/title/createdAt/updatedAt）。
一个笔记对应磁盘上一个 `.md` 文件，但"笔记"是业务概念，"文件"是存储概念。
_Avoid_: 文档、document、文件（用于磁盘实体时见"笔记文件"）

**笔记文件（Note file）**：
笔记在磁盘上的物理载体，路径为 `~/.wasmnest/lanbitou/notes/<id>.md`。
笔记文件是 UTF-8 编码的纯文本，可被任何编辑器打开。
_Avoid_: 文件（泛指时）、data file

**笔记列表（Note list）**：
烂笔头左侧栏显示的所有笔记索引，按 updatedAt 降序排列。
列表由 `index.json` 元数据 + `notes/` 目录扫描合成，标题取正文首行。
_Avoid_: 文件树、目录、folder

**工作上下文（Working context）**：
用户当前的编辑状态：最后打开的笔记 ID、光标位置、滚动位置、最后编辑时间。
持久化到 `~/.wasmnest/lanbitou/context.json`，用于应用重启后恢复现场。
_Avoid_: 会话、session（与 agent 域冲突）、状态

**时间分隔符（Time divider）**：
按配置位置（顶部 / 末尾 / 光标处，默认末尾）插入的时间标记，格式可配置
（默认 `--- {{date}} {{weekday}} {{time}} ---`）。
触发条件：打开笔记且距上次编辑 > 阈值（默认 5 分钟）。
用户手动删除后，该笔记不再自动插入（记录到工作上下文）。
_Avoid_: 时间戳、timestamp、分隔线

**系统剪贴板（System clipboard）**：
操作系统级的剪贴板能力，跨应用共享。
烂笔头通过后端 WASM 调用宿主提供的 `host-clipboard.read-text` / `write-text`
（权限 `clipboard:read` / `clipboard:write`）。
_Avoid_: 剪贴板（泛指时）、paste buffer

**保存模式（Save mode）**：
笔记的自动保存策略：实时保存（默认，500ms 防抖）/ 失焦保存 / 手动保存。
配置项持久化到 `~/.wasmnest/lanbitou/settings.json`。
_Avoid_: 自动保存、autososave（是保存模式的一种）

**笔记索引（Note index）**：
持久化的元数据缓存，路径 `~/.wasmnest/lanbitou/index.json`。
只存每个笔记的 id/createdAt/updatedAt；标题始终由正文首行派生。
索引损坏时不阻塞启动：整份回退为空索引，列表扫描目录重建（时间戳回退为当前时间）。
_Avoid_: 数据库、catalog、目录

**Markdown 预览（Markdown preview）**：
编辑区右侧的实时渲染视图，使用 marked 库将 Markdown 源码转换为 HTML。
预览独立滚动（同步滚动尚未实现）。
_Avoid_: 渲染、render、WYSIWYG
