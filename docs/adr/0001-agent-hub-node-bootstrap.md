# agent-hub 的环境引导：插件侧在线安装 Node.js，宿主只提供 PATH 登记机制

**状态**：superseded by 0002（2026-10-28）——agent-hub 已整体并入 bedcode；Node 引导逻辑原样迁入 bedcode Agent 管理域（rust/src/hub/env/），机制决策继续有效

一台什么都没装的机器上，agent-hub 既探测不出「agent 未安装」，也没有任何装 node/npm 的通道。决定：把「引导 Node.js（含 npm）」作为 agent-hub 插件的职责——**不随包、不装 git/bash/python**，通过 shell 脚本在线下载官方产物并以钉死的 sha256 校验；PATH 采用**用户级**（Windows `HKCU\Environment`、Linux `~/.local/bin`），**不做机器级安装、不引入提权面**；宿主只新增一个纯机制原语 `host-app.register-path / unregister-path`（复用已有的 `REG_EXPAND_SZ` 保留与 `WM_SETTINGCHANGE` 广播实现），插件不自行 `reg add` 改写用户环境。同时把探测结果拆成三态（`not-installed` / `ready` / `unavailable`），禁止把「探测失败」显示成「未安装」。

## Considered Options

- **把 node 随应用打包**：安装包 +36–58 MB，且与「应用产物纯净度」锁冲突、版本滞后。否。
- **调 winget / 跑 MSI**：版本不可控；`host-process` 无窗口、`stdin=null`，MSI 的 UAC 与交互都无法完成；老 Win10 没有 winget。否。
- **机器级安装（Program Files / `/usr/local`）**：需要 UAC / root，宿主没有提权原语，Linux 的 `sudo` 在无 tty 下直接失败。否。
- **插件自己调 `reg add` 写 PATH**：要在 guest 重写一遍 `REG_EXPAND_SZ` 类型判定（写错就毁用户 `%VAR%` 条目），且拿不到 `WM_SETTINGCHANGE` 广播（新终端要等 Explorer 刷新）。否。
- **npm 全局 prefix 跟 node 目录走**：升级 node 换目录会把已装的全局 CLI 从 PATH 上抹掉。否——prefix 固定在独立目录（Windows）或 `~/.local`（Linux）。

## Consequences

- 平台仓一次 ABI bump（`host-app` 新增两函数 + 新权限位）、双端 WIT 同步、`release-manifest.json` 与 `host-runtime.lock.json` 重钉；研发期无兼容负担。
- 干净机器首装需要联网；企业代理 / 离线安装包不在本期。
- 用户自己终端里 `npm i -g` 的落点与我们管理的 CLI 不同（写在文档与界面提示里，不做隐式统一）。
- Windows 上没有 bash，执行壳只能是 `cmd`（PowerShell 仅作单命令兜底）；bash 只出现在 Linux 侧。
- 引导失败必须 fail-visible（阶段 + 失败码 + 原始输出尾部），不得静默降级为「未安装」。

设计细节与验收清单：`.scratch/2026-10-22-agent-hub-node-bootstrap/spec.md`。
