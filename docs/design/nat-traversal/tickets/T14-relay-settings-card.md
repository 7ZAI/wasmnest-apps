# [feat] T14 · 桌面「中转服务器」卡片：部署文本生成、地址导入与连通性检测

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T13（`print-addrs` 格式）｜ **状态**：实施中（2026-11-08 认领；实施记录见文末）
- **设计依据**：§4.2.1（桌面端配套）、§5.2
- **开工前确认**：落点已裁定为 **bedcode desktop 设置页**（应用级配置，非宿主级；见「实施记录 · 落点裁定」）

## 需求描述

让用户在桌面应用内完成自建 relay 的「最后一公里」：生成部署命令/Compose 文本、导入 relay 地址、检测连通性。**只生成文本，不在应用内 SSH 或保存服务器凭据**；不代替用户执行远端命令。

## 落点 app 与端

`bedcode` / 桌面（设置页「中转服务器」分组；应用级配置，落盘插件 KV `network.relay`）。

## 验收条件

- [x] 「生成部署命令 / 下载 compose」：输出 T13 交付物对应的文本（docker run / compose / install.sh），不含任何服务器凭据。
- [x] 「导入 relay 地址」：粘贴 `print-addrs` JSON / multiaddr / 二维码三形态；校验协议版本与 PeerId 格式；非法输入 fail-visible。（二维码内容即 JSON 文本；桌面无摄像头，扫码结果粘贴导入）
- [ ] 「检测连通性」：用 peer 引擎拨 relay，显示 PeerId 指纹与 RTT；失败给可操作原因（端口/防火墙/DNS/版本）。**阻塞：宿主 SDK 尚无 relay/tunnel 面（T06）**；当前按钮显性禁用并给服务器侧 `doctor` 出路，不伪造可用。
- [ ] 导入的地址进入应用 relay 配置（`relayAddrs`），供 §4.9 模式判定与拨号使用。**已落盘**；实际拨号/模式判定消费方在 T06/T07/T12，待接线。
- [ ] app `test:run` + 根 lint 绿；真实宿主目验；交互面 `data-testid` 锚点同步。（单测 / 根 lint 已绿；真实宿主与 E2E 被宿主运行时缺产物阻塞，见验证）

## 相关契约与锁

- 导入格式真源 = T13 `print-addrs --json` 输出；协议版本不匹配显性拒绝。
- 连通性检测复用 T02 引擎 relay 拨号；域名解析走宿主 `lookup_host`。
- 隐私：relay 地址不是秘密可入插件 storage；enrollment token 属凭据，不落日志、不进文档。

## 实施记录（2026-11-08，apps 仓 `.worktrees/wasmnest-apps/nat-traversal`）

### 1. 落点裁定（机制 vs 产品语义）

落在 **bedcode desktop 设置页**，理由：

1. `relayAddrs` 是应用自己的网络配置（设计 §4.9「设置项」），不是宿主内核状态；宿主只负责拨号与模式判定（T06），不替应用保存产品语义。
2. 四个桌面 app 里只有 bedcode 有**完整设置页**（`views/SettingsView.vue` + 静态分组表）；file-transfer 的设置是覆盖层弹窗，容纳不下部署文本 / 导入 / 探测三块。
3. bedcode 的「远程访问」正是 T07 的 expose + `allowWan` 消费方，中转配置与其同页最自然。

> 若 T15 的「桌面卡片导入」实际指 file-transfer，需回裁：那属于 T12 自己的 relay 设置（本票不复制一份到另一个 app，避免跨应用耦合）。

### 2. 代码面

| 文件 | 职责 |
| --- | --- |
| `apps/bedcode/desktop/src/relay/relayImport.ts` | 导入载荷解析：JSON（`print-addrs --json`）/ 文本（`print-addrs`）/ 多地址；PeerId 解码 + 指纹本地复算；地址形状与单 relay 一致性校验 |
| `apps/bedcode/desktop/src/relay/relayDeploy.ts` | 部署文本生成（Compose / docker run / systemd），只替换对外主机、端口、镜像版本 |
| `apps/bedcode/desktop/src/composables/useRelaySettings.ts` | 插件 KV `network.relay` 读写与存储结构校验（损坏只报错、不静默清除） |
| `apps/bedcode/desktop/src/components/RelaySettingsSection.vue` | 卡片正文：当前配置 / 部署文本 / 导入 / 连通性（显性禁用） |
| `useSettingsSections.ts` | 新增 `relay` 分组（order 250，配对与链路加密之间） |
| `src/i18n/{messages,zh-CN,en}.ts` | `relay.*` 文案（两份语言同步；无 JSON 花括号占位符） |
| `src/__tests__/relay{Import,Deploy,SettingsSection}.test.ts` | 39 条行为契约（解析 / 生成 / 组件） |
| `e2e/specs/bedcode.spec.ts` | 分组列表加 `relay`，新增卡片锚点用例（部署文本 / 非法导入 / 探测禁用） |

### 3. 契约与数据形态

- **导入来源**：`wasmnest-relay print-addrs --json`（产出方真源 `wasmnest-relay/src/addrs.rs`，`v=1` / `kind=wasmnest-relay` / `peer_id` / `peer_id_sha256` / `control_protocol=/wasmnest/relay-control/1` / `addrs` / `access.mode` / `quota`）。
- **身份校验**：PeerId 必须是 ed25519 libp2p PeerId（base58 → identity multihash → protobuf `08 01 12 20` + 32 字节公钥）；指纹由前端用 WebCrypto 复算 `sha256(公钥)`，与载荷自报值不一致即拒绝。
- **地址**：只接受 `/ip4|ip6|dns|dns4|dns6/<host>/tcp/<port>/p2p/<peerId>`；带 `/p2p-circuit` 的是拨号目标，直接拒绝；一次只能导入一个 relay PeerId。
- **落盘**（`network.relay`）：`{ version: 1, relayAddrs, peerId, peerIdSha256, accessMode, relayVersion, controlProtocol, quota, importedAt, source }`。`relayAddrs` 即 §4.9 的消费字段；T07/T12 读取该键即可，无需再导入。
- **二维码**：内容就是导入 JSON；卡片把扫码结果按 JSON 文本解析（桌面无摄像头，不引扫码依赖）。

### 4. 关键取舍

1. **不伪造连通性检测**：当前 apps 使用的 SDK / 宿主（平台仓 `dev`，`lib-v0.0.1`）没有 relay/tunnel 面，T02 引擎 relay 拨号与 `lookup_host` 都未暴露到 WIT。按钮保持禁用并展示原因 + 服务器侧 `doctor` / `print-addrs` 命令；不新增临时宿主字段或假 command（避免把未定契约钉进跨仓面）。T06 落地后把按钮接到宿主探测命令即可，身份与 RTT 展示结构已就位。
2. **`relayAddrs` 存应用 KV 而不是宿主设置**：符合「产品语义住应用」的三仓边界；宿主侧跨应用共享 relay 配置若要做，属 T06 的宿主设置面，另裁。
3. **部署文本不带 token**：enrollment token 只经服务器侧 `token create` 产出并带外交付；卡片不提供输入框、不落日志。
4. **systemd 形态不伪造端口能力**：`install.sh` / unit 固定 4001；选非默认端口时生成文本显式提示同步改 `/etc/wasmnest-relay/config.toml` 与防火墙。

### 5. 验证

| 项 | 结果 |
| --- | --- |
| 新增单测 | `relayImport` 18 + `relayDeploy` 9 + `relaySettingsSection` 12 = **39 passed** |
| SettingsView / plugin-contract / i18n | 3 + 26 + 4 passed（`SettingsView` 的六分组断言与静态表已同步） |
| 全量 app 单测 | 3 个 shard × `--maxWorkers=2`：26/26、26/26、24/24 文件全绿（291 + 522 + 460 = **1273 passed**）；整包单进程会 OOM，按 shard 隔离跑 |
| 根 lint | `pnpm run lint`：**0 errors**，44 warnings（既有基线，均不在 `relay*` 文件） |
| 真实宿主目验 / E2E | **未跑（环境阻塞）**：`host-runtime.lock.json` 的 `artifacts` 为空，取不到宿主运行时；`docs/E2E.md` 链路需要 `tauri-driver` + WebKitWebDriver。锚点已按 `docs/E2E.md` 同步到 `e2e/specs/bedcode.spec.ts`，待宿主产物发布后补跑 |
| 环境说明（非代码缺陷） | 验证期用 `scripts/link-platform-sdk.mjs --no-install` 把 SDK 指到平台仓 `dev`（旧副本缺 `./ui/app-update`，会让 SettingsView / plugin-contract collect 失败）；跑完已 `unlink-platform-sdk.mjs` 并按 HEAD 还原 package.json / pnpm-lock / `.cargo/config.toml`，**link 状态未提交** |

### 6. 后续接线

- **T06**：宿主 relay 探测命令（拨 relay + 返回 PeerId / 指纹 / RTT / 失败原因）落地后，替换 `RelaySettingsSection` 的禁用块；错误文案按设计 §7.1 词表映射端口 / 防火墙 / DNS / 版本。
- **T07/T12**：从 `network.relay` 读 `relayAddrs` 参与 §4.9 拨号与状态 UI；确认 `allowWan` 门控仍由宿主/应用各自持有，不在本卡片引入开关。
- **T15**：真实 VPS 一键起 relay → 本卡片导入 → file-transfer 跨 NAT；届时补真实宿主目验与 E2E 实跑结果。