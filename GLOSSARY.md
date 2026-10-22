# wasmnest-apps

应用仓（wasm 应用业务主场）的领域词汇。只收本仓特有的概念，不收通用编程词汇与实现细节。

## Language

**环境（Environment）**：
宿主机器上的 Node.js 运行时（含 npm）。agent-hub 只认这一种编程环境。
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
