# [feat] T14 · 桌面「中转服务器」卡片：部署文本生成、地址导入与连通性检测

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T13（`print-addrs` 格式）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.2.1（桌面端配套）、§5.2
- **开工前确认**：落点 app——设计写「桌面端设置页」，候选 bedcode desktop 设置页；若属宿主级设置则需重新裁决归属（机制 vs 产品语义）

## 需求描述

让用户在桌面应用内完成自建 relay 的「最后一公里」：生成部署命令/Compose 文本、导入 relay 地址、检测连通性。**只生成文本，不在应用内 SSH 或保存服务器凭据**；不代替用户执行远端命令。

## 落点 app 与端

应用仓桌面端（落点 app 待确认，候选 `bedcode` / 桌面）。

## 验收条件

- [ ] 「生成部署命令 / 下载 compose」：输出 T13 交付物对应的文本（docker run / compose / install.sh），不含任何服务器凭据。
- [ ] 「导入 relay 地址」：粘贴 `print-addrs` JSON / multiaddr / 二维码三形态；校验协议版本与 PeerId 格式；非法输入 fail-visible。
- [ ] 「检测连通性」：用 peer 引擎拨 relay，显示 PeerId 指纹与 RTT；失败给可操作原因（端口/防火墙/DNS/版本）。
- [ ] 导入的地址进入应用 relay 配置（`relayAddrs`），供 §4.9 模式判定与拨号使用。
- [ ] app `test:run` + 根 lint 绿；真实宿主目验；交互面 `data-testid` 锚点同步。

## 相关契约与锁

- 导入格式真源 = T13 `print-addrs --json` 输出；协议版本不匹配显性拒绝。
- 连通性检测复用 T02 引擎 relay 拨号；域名解析走宿主 `lookup_host`。
- 隐私：relay 地址不是秘密可入插件 storage；enrollment token 属凭据，不落日志、不进文档。