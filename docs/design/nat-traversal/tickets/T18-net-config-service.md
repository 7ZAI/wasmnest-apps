# [feat] T18 · 穿透配置中心（服务型 wasm）：统一设置 + 业务注册

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T14（迁移来源）、T06（消费方接线；首轮已落地）｜ **状态**：待实施（2026-11-09 用户裁定走 B 方案）
- **设计依据**：§4.2.1、§4.9、§5.2；不变量 8 / 9 / 10
- **开工前裁定**：用户 2026-11-09 在「A 宿主设置面 / B 服务型 wasm 配置中心」中选定 **B**；本票只落地 B 的边界，不引入宿主级全局配置

## 问题陈述

**从用户视角**：要跨网访问 BedCode（手机在外网连桌面）必须先自建一个 relay，并把它的地址告诉应用。这个地址目前只能填在 BedCode 自己的设置页里；FileTransfer 等其它业务要跨网时，得再填一遍同样的地址。用户不理解「同一台 relay 为什么每个应用都要配一次」，也不清楚哪些业务在用。

**从系统视角**：穿透的**客户端机制**其实已经统一在宿主（隧道管理器按插件身份维护通道配置，建 reservation 时对所有相关插件的地址取并集去重），重复的只有「中继地址这一份配置」——它落在各应用私有的插件 KV 里，插件之间读不到。缺的是一个**跨应用共享的配置真源**，以及一张**哪些业务被允许走外网的注册表**。

## 解决方案

新增一个服务型 wasm「网络配置中心」（L2 内部业务），作为穿透配置的唯一真源：

- **一处填写**：中继地址在中心里导入一次（`print-addrs` JSON / 文本 / multiaddr 三形态），所有业务经互调只读取用。
- **业务注册**：中心持有一张按插件 id 的「是否允许外网（allowWan）」注册表，作为用户可见的统一视图；各业务仍按自己的权限与时机调宿主隧道原语。
- **页面**：中心的设置页承载原来 BedCode「中转服务器」卡片的全部内容（部署文本、地址导入、指纹展示、连通性出路），BedCode 侧退役为只读跳转。
- **消费方式**：业务前端读中心的只读 api，把地址随命令显式传给自己的后端，由后端写宿主 `tunnel-configure`；中心不参与拨号、不代任何业务建立隧道。

边界一句话：**B 统一的是配置来源，不是穿透执行**。业务侧的 `tunnel:serve` / `tunnel:connect` 权限、`expose` / `connect` 调用仍由各业务自己持有。

## 用户故事

**配置与迁移**

1. 作为桌面用户，我想在一个统一页面里填写自建 relay 的地址，以便所有需要跨网的业务都能用，而不用每个应用填一遍。
2. 作为桌面用户，我想把 `wasmnest-relay print-addrs --json` 的输出整段粘贴进来，以便不用手工拆字段。
3. 作为桌面用户，我想把 `print-addrs` 的纯文本输出（每行一个 multiaddr + 元数据）粘贴进来，以便没有 JSON 时也能导入。
4. 作为桌面用户，我想直接粘贴一条 `/ip4|dns4/<host>/tcp/<port>/p2p/<peerId>` 地址，以便快速试通单条地址。
5. 作为桌面用户，我想在导入成功后看到解析出的 PeerId、指纹、准入模式、配额与地址列表，以便确认连的是我自己的 relay。
6. 作为桌面用户，我想让应用**本地复算**指纹并与导入值比对，以便确认我看到的指纹不是载荷自报的。
7. 作为桌面用户，我想在导入格式错误、版本不匹配、协议不匹配、PeerId 非法、地址带 `/p2p-circuit` 时看到明确原因，以便自己修正而不是猜。
8. 作为桌面用户，我想在不知道地址怎么写时看到三种部署方式的命令文本（Compose / 单命令 / systemd），以便直接复制到服务器执行。
9. 作为桌面用户，我想下载 Compose 文件，以便不靠复制粘贴部署。
10. 作为桌面用户，我想看到「部署文本不含任何凭据、应用不会替你执行远端命令」的说明，以便知道本应用的安全边界。
11. 作为桌面用户，我想在需要移除配置时显式删除，以便知道不会留下半份配置。
12. 作为桌面用户，我想在存储内容损坏时看到报错而不是被静默清空，以便我的 relay 寻址信息不会无声消失。
13. 作为从旧版本升级的用户，我想让 BedCode 里已经填好的地址自动迁移到统一设置，以便不用重新导入。
14. 作为从旧版本升级的用户，我想在迁移失败时看到明确提示，以便知道该重新导入而不是以为已生效。

**跨业务复用与注册**

15. 作为 BedCode 用户，我想让 BedCode 直接使用统一设置里的 relay 地址，以便只维护一份配置。
16. 作为 FileTransfer 用户，我想在接入后同样使用统一地址，以便不用第二次填写（接入实施归后续票）。
17. 作为桌面用户，我想看到一张「哪些业务被允许走外网」的列表，以便知道当前有哪些暴露面。
18. 作为桌面用户，我想逐个业务开关外网访问，以便不让所有应用共享同一个授权决定。
19. 作为桌面用户，我想在业务注册表里看到每个业务的最近更新时间，以便判断配置是否陈旧。
20. 作为桌面用户，我想在某个业务关闭外网后，它立即不再建立中继预留（LAN 入口不受影响），以便关闭行为符合预期。
21. 作为应用开发者，我想通过一个稳定的只读互调 api 取到当前 relay 地址，以便新业务接入时不用复制解析逻辑。
22. 作为应用开发者，我想让「读取地址」失败时得到明确错误而不是空数组，以便区分「没配置」和「中心不可用」。
23. 作为应用开发者，我想保持自己的 `tunnel:serve` / `tunnel:connect` 权限声明与调用时机，以便接入不会扩大别人的权限。
24. 作为应用开发者，我想在中心不可用时用自己的本地缓存继续工作，以便不因服务禁用而丢失跨网能力。
25. 作为应用开发者，我想让中心**不能**代我 `expose` / `connect`，以便权责边界清晰、审计可追。

**运行与可观测**

26. 作为桌面用户，我想在中心服务被禁用或未激活时看到显性提示，以便知道统一设置不可用而不是以为配置丢了。
27. 作为桌面用户，我想在服务返回的地址版本不认识时看到拒绝提示，以便旧/新版本混用时不会被误解析。
28. 作为桌面用户，我想在地址变更保存后让各业务下次配置时自然生效，以便不用重启全部应用。
29. 作为桌面用户，我想在连通性探测能力尚未装配时看到禁用按钮与服务器侧自检命令，以便不被伪造的「可用」误导。
30. 作为桌面用户，我想让 relay 地址只作为普通配置存储（不是凭据），同时确保 enrollment token 从不进入页面、日志与文档，以便安全边界可解释。
31. 作为维护者，我想让中心先于业务应用装配完成，以便业务启动时调用它不会出现「先调后起」。
32. 作为维护者，我想让中心在发布清单、宿主路由与边界锁里各登记一次，以便装配链不出现半落地。
33. 作为维护者，我想让统一设置页有稳定的测试锚点，以便真实宿主 E2E 可以断言导入、校验与注册表。

## 实现决策

### 1. 组件形态

- 新工程落在 `servers/` 分组的桌面端，插件 id 为 `com.wasmnest.net-config`，装配角色声明为 `internal-business`（L2），`pluginType` 为 `full`。
- **选 L2 的理由是加载序**：宿主固定按 L1 → L2 → L3 装配，L2 先于所有业务应用（L3）就绪，业务启动时调用中心不会「先调后起」。中心**不**注册任何网关裁决，不改变 L2 的机制语义，只借用该档位的装配顺序。
- 权限只声明 `storage`：中心不碰网络、隧道、进程，不需要 `network:http` / `tunnel:*`。
- 页面挂在宿主挂载槽（服务型 wasm 同样走挂载面），路由前缀 `/network`。

### 2. 数据与真源

中心持两份应用级配置（插件 KV），都是版本化结构：

```json
// network.relay（沿用 T14 形态，字段语义不变）
{ "version": 1, "relayAddrs": ["/dns4/…/tcp/4001/p2p/12D3…"],
  "peerId": "12D3…", "peerIdSha256": "<64 hex>", "accessMode": "open|allowlist|null",
  "relayVersion": "x.y.z|null", "controlProtocol": "/wasmnest/relay-control/1|null",
  "quota": { "maxCircuitBytes": 0, "maxCircuitDurationSecs": 0 } | null,
  "importedAt": "<ISO8601>", "source": "json|text" }

// network.wanPolicy
{ "version": 1, "apps": { "<pluginId>": { "allowWan": true, "note": "", "updatedAt": "<ISO8601>" } } }
```

- `relayAddrs` 是唯一地址真源，保持 T14 的 `version: 1` 与字段名，消费方读法不变。
- `wanPolicy` 只存策略，不存端口与暴露规则——端口是运行期事实，仍由各业务自己 `expose`。
- 存储损坏的语义沿用 T14：**只报错、不静默清除**；显式移除才删键。

### 3. 互调 api（只读面）

- 暴露两条只读 api：取当前 relay 配置、取业务 WAN 注册表。
- 写操作（导入 / 移除 / 改注册表）**不暴露为互调**，只走本服务的命令面与设置页，避免任意插件改全局地址。
- 唯一例外：一条幂等的「收养」api 供 BedCode 迁移本地旧配置（目标已有值时不覆盖，返回是否采纳）。它只接受与 `network.relay` 同构的载荷，不接受任意键值。
- 互调不需要权限位：宿主 `host-api-call` 的准入判据是目标 api 的声明登记，不是权限（既有机制，本票不新增权限词汇）。

### 4. 消费方接入方式

- 业务前端调用中心只读 api 拿到 `relayAddrs`，再随自己的命令**显式传参**给后端；后端只做校验与 `tunnel-configure`，**不在后端内做跨应用调用**。
- 好处：后端无新的互调依赖、单测不需要模拟 api 总线；配置来源只有一处（前端取数点）。
- `allowWan` 仍逐业务决定，不因地址统一而自动打开：地址共享 ≠ 允许被外网访问。这与既有不变量（未匹配 peer 不能开流、relay 不是授权点）一致。
- 中心**不**代任何业务调用 `expose` / `connect` / `issue-pairing-ticket`：这些权限按插件授予、租约按插件身份记账，代持等于开权限借用后门。

### 5. 与 T14 的关系（迁移与退役）

- BedCode 设置页的「中转服务器」分组退役：删除分组条目与顺序槽位；保留一个只读入口（说明「已移至统一网络设置」并跳转），避免用户找不到。
- 迁移发生在 BedCode 首次启动：若中心为空且本地 `network.relay` 可解析，则调用收养 api 写入中心；成功后本地键**保留为缓存**（不删，服务不可用时兜底）。
- 中心的设置页承接 T14 的全部交互与文案（T14 的解析与部署文本生成逻辑迁入中心，BedCode 不再保留副本），避免两处校验口径漂移。

### 6. 失败语义（fail-visible）

- 中心不可用 / 被禁用 / api 未登记 → 调用方得到显性错误；界面显示「统一设置不可用」，并使用本地缓存（若有），**不**静默当成「未配置」。
- 中心读到无法解析的存储 → 返回显性错误并保留原数据；设置页显示「配置无法解析，请重新导入或显式移除」。
- 版本 / 控制协议不匹配 → 导入期直接拒绝，不写入，不猜测字段语义。
- 地址已配置但 `allowWan` 关闭 → 业务侧不建中继预留，LAN 入口照常；状态展示区分「未配置地址」与「已配置但关闭外网」。

### 7. 装配与清单

- 中心进入桌面构建清单与 dev watch 清单；发布清单新增一条（`path` 为 `servers/net-config`）。
- 宿主挂载路由表新增 `/network` 与对应路由；桌面边界锁的挂载包清单随之从 6 个变为 7 个（逐字校验中心入口；中心仍需提供 `mountPreview` 并遵守预览只读约束）。
- 不新增 WIT、不新增权限词汇、不新增宿主契约：只复用现有 `host-storage`、`host-api-call`、`host-tunnel`。因此本票是应用仓 feature，跨仓影响限于构建清单 / 路由 / 发布清单 / 平台锁。

### 8. 隐私与凭据

- relay 地址不是秘密，可入插件 KV 与页面展示；PeerId 指纹由本地复算后展示。
- enrollment token 属凭据：中心只给「服务器侧如何生成」的文本出路，不提供输入框、不落存储、不进日志与文档。

## 测试决策

**好测试的判据**：只断言外部可观察行为——api 的输入输出、命令的入参、页面渲染的文本与锚点、存储读写结果；不测内部函数调用次数、不依赖实现细节。

**最高接缝（优先复用既有）**：

1. **宿主 api-call 边界**：对中心只读 api 的契约测试（输入 → JSON 形状；未配置 / 损坏 / 版本不支持 → 显性错误）。这是跨应用复用的唯一接缝。
2. **业务命令边界**：BedCode 前端取数后传给后端的 `relayAddrs` 与 `allowWan`；断言「地址来自中心」「服务失败时用缓存且可见提示」。
3. **插件 KV 边界**：存储结构与损坏数据的行为（不静默清除、显式移除才删）。
4. **装配锁**：桌面边界锁（7 个挂载包）、路由表、发布清单一致性。

**测试分布**：

- 中心 Rust 单测：存储 schema 解析与版本拒绝、只读 api 输出形状、收养 api 的幂等与「非空不覆盖」、损坏数据不删除。
- 中心前端单测：导入三种形态（复用 T14 既有 40 条用例，迁入后保持同等覆盖）、部署文本生成、指纹展示、业务注册表渲染、服务错误态。
- BedCode 单测：迁移（空中心 → 写入；非空 → 不覆盖）、服务失败时的回退与提示、设置页只读入口、`tunnel.rs` 接受显式入参后的地址校验。
- 平台锁：边界锁与路由测试全量。
- E2E：统一设置页的导入成功/失败、指纹显示、注册表可见；锚点统一 `net-config-` 前缀，并同步到桌面 E2E spec。

**Prior art**：T14 的 `relayImport` / `relayDeploy` / `relaySettingsSection` 测试（行为契约式，40 条）；auth-center 的互调 api 与 plugin-contract 测试；BedCode `tunnelStatus` 的纯函数式状态映射测试。

## 不在范围内

- relay 服务端本身（部署、配额、准入、镜像）——T13 已完成，本票不动。
- QUIC / DCUtR 打洞、UPnP、官方公共 relay——P3 评估（T16），§9.2#1 仍为「不做」。
- 代替其它业务执行 `expose` / `connect` / 签发配对票据——机制与安全边界都不允许。
- 宿主设置面方案（A）——本次不选；若将来要全局默认地址，另开票并走跨仓契约变更。
- FileTransfer 的实际接入（读地址 + 声明 `tunnel:serve` / `tunnel:connect` + 多地址拨号）——归 T12/T11 后续票。
- 连通性探测的真实实现——宿主 relay 拨号面（T06）尚未提供该原语，本票维持「禁用 + 服务器侧自检出路」。
- 移动端统一设置页——移动端是纯拨号方，地址随配对载荷携带，不需要本页面。
- 多租户、计费、enrollment token 管理、公共 relay 运营。
- 凭据存储与远端命令执行。

## 补充说明

- **与既有设计的关系**：B 不改变 §4.9 的模式判定与不变量；它只把「地址配置」从单应用私有提升为跨应用共享。宿主侧行为（地址并集去重、0→1/1→0 引用计数、`allowWan` 门控）完全不变。
- **为什么不是 A**：A 需要宿主级设置面与 `TunnelConfig` 的默认继承，属平台/能力仓契约变更；B 只新增应用仓一个服务，跨仓影响限于清单与路由。代价是业务侧仍需各自的权限声明与命令接线。
- **主要风险**：① 中心被禁用时的可观测性（必须 fail-visible + 缓存兜底）；② L2 档位承载的是「装配顺序」而非「网关裁决」，需在中心文档里写明，避免后来者误把它注册成裁决方；③ 迁移只在 BedCode 首次启动触发，若用户先打开中心再开 BedCode，中心会先显示「未配置」，属预期。
- **待裁定（默认按此执行）**：BedCode 保留「已移至统一设置」的只读入口（不保留可编辑卡片）；若要求完全移除入口，删除该分组即可，不影响数据。
- **issue 落仓**：`7ZAI/wasmnest-apps`，标签 `kind:feature`。当前环境未安装 `gh`，GitHub Issue 尚未创建；本文档为 issue 正文真源，待 `gh` 可用时按标题「[feat] 穿透配置中心（服务型 wasm）：统一设置 + 业务注册」补建。

## 实施记录（2026-11-09，apps 仓 `dev`）

### 1. 落点与结构

- 新服务 `servers/net-config/desktop`：`com.wasmnest.net-config` / `full` /
  `type: internal-business`（L2 只借装配顺序）/ `rustLibrary: wasmnest_plugin_net_config` /
  权限仅 `storage`。不新增 WIT、权限词汇或宿主契约。
- 数据面：插件 KV `network.relay`（T14 形态，`relayAddrs` 为唯一地址真源）与
  `network.wanPolicy`（按插件 id 的 `allowWan` + `note` + `updatedAt`）。
- 互调 api：`relay-config` / `wan-policy` 只读；`relay-adopt` 幂等收养（目标已有值
  返回 `adopted:false`，不覆盖）。导入 / 移除 / 改注册表只走本服务命令面。
- 页面：当前配置（PeerId / 本地复算指纹 / 准入 / 配额 / 地址 / 来源）、部署文本
  （Compose / Docker / systemd）、地址导入（JSON / 文本 / multiaddr）、连通性探测
  出路（宿主未装配时按钮禁用）、业务 WAN 注册表；`mountPreview` 只读。

### 2. 代码面

| 文件 | 职责 |
| --- | --- |
| `servers/net-config/desktop/rust/src/{model,ops,store}.rs` | schema 校验 / 版本拒绝 / 不静默清除 / 收养幂等 / 策略 upsert / ISO 时间 |
| `servers/net-config/desktop/rust/src/lib.rs` | 命令面（`net-config.*`）+ 互调 api + activate |
| `servers/net-config/desktop/src/relay/{relayImport,relayDeploy}.ts` | 自 T14 整体迁入（解析 / 部署文本），BedCode 副本已删 |
| `servers/net-config/desktop/src/components/{NetConfigView,WanPolicyCard}.vue` | 设置页正文 + 业务注册表 |
| `apps/bedcode/desktop/rust/src/relay_center.rs` | 中心消费：`relay-config` 读取、缓存兜底、首启 `relay-adopt` 迁移与状态记录 |
| `apps/bedcode/desktop/rust/src/tunnel.rs` | 通道配置改显式入参（`validate_relay_addrs` + `sync_channel_config` / `prepare_channel`） |
| `apps/bedcode/desktop/src/components/RelayMovedSection.vue` | 设置页只读入口（状态 / 缓存降级 / 迁移失败 / 跳 `/network`） |
| 平台仓 `useShellApps.ts` / `router/index.ts` / `plugin-build.js` / `plugin-precheck.mjs` / `release-manifest.json` / 边界锁 | `/network` 路由、构建与 watch 清单、发布条目（7 个挂载包） |
| `e2e/{pages/netConfig.ts,specs/net-config.spec.ts}` + `e2e/specs/bedcode.spec.ts` | 新锚点用例；BedCode 中转用例改为只读入口断言 |

### 3. 关键取舍（与 §4 字面的一处偏离）

- **§4「业务前端调用中心只读 api」在现有机制下不可实现**：挂载包前端的
  `env.invoke` 白名单（`APP_FRONTEND_INVOKE_WHITELIST`）没有跨插件调用命令，
  `host-api-call` 只在 wasm guest 侧可用。故改为 **BedCode 后端薄转发**
  （`relay_center.rs` 调中心 `relay-config`，5s 超时）：前端仍是唯一取数点，把
  `relayAddrs` 显式传给 `session.tunnel.prepare`；后端只读取与写宿主通道配置，
  不决策、不缓存写入、不代业务 `expose` / `connect`。
- **缓存兜底分两种**：中心不可用 + 本地缓存可解析 → `source=cache` + `centerError`
  上屏；中心明确 `configured:false` → 不使用缓存（避免复活用户已删除的配置）。
- **迁移在 activate 内 best-effort**：成功保留本地键为缓存；失败写
  `network.relay.migration = {state:"failed", detail}`，设置页显性提示，不阻断激活。
- **QR 载荷**：`peer` 生产前先解析中心/缓存；两者都拿不到时退化为仅 LAN，并把
  原因放 `relayError`（不产出残缺 peer）。
- **WAN 注册表闸门**：`session.tunnel.prepare` 与 QR `peer` 生成都会读
  `wan-policy`；显式 `allowWan:false` → 地址清空（仅 LAN，不建中继预留）；
  未登记 / 字段缺失 → 默认 `true`；注册表读不到 → 保持默认并带出原因，不静默
  关掉用户已配置的外网。

### 4. 验证

| 项 | 结果 |
| --- | --- |
| 中心 Rust（native） | `cargo test --manifest-path servers/net-config/desktop/rust/Cargo.toml`：**23 passed** |
| BedCode Rust（native） | `cargo test --manifest-path apps/bedcode/desktop/rust/Cargo.toml --lib`：**1058 passed / 1 ignored**（含 `relay_center` 15 条：缓存兜底 / 迁移 / WAN 闸门） |
| BedCode wasm 构建 | `node scripts/build.js --rust-only`：**EXIT=0**（新增 `#[plugin_api]` 的 `wan-policy` 方法宏路径已过 wasm 目标） |
| 中心前端 | `servers/net-config/desktop`：**3 文件 / 46 passed**（导入 18 + 部署 9 + 页面 19） |
| BedCode 前端 | 逐文件跑完全部 **80 个测试文件全绿**（整包单进程在本机会被环境打断；首次 40 个受 ENOSPC 影响的文件已全部重跑通过） |
| 平台锁 | `hostAppBoundaryLock.test.ts` + `router/index.test.ts`：**17 passed**（7 个挂载包 / `/network` 路由） |
| 根 lint | `pnpm run lint`：**EXIT=0（0 errors）** |
| 构建与发布条目 | `node scripts/ci/build-app.mjs --app net-config --end desktop` 成功：`dist/release/net-config-desktop-v0.0.1.zip`（259311 B，sha256 `d6443d0c73c87b2af67cf690bc7c458151cc3326f6436ea7879a14a1aa951892`），已写入平台 `release-manifest.json` |
| `check:manifest` | 本条目通过；剩余 5 项为既有漂移/环境（能力仓 HEAD 无 tag、WIT sha 漂移、lanbitou 缺 package/sha、应用仓 HEAD 无 tag） |
| 真实宿主 / E2E | **未跑**：需宿主产物 + tauri-driver/WebKitWebDriver；锚点与用例已就位（`e2e/specs/net-config.spec.ts`、`bedcode.spec.ts` 只读入口），待环境可用补跑 |

### 5. 后续

- T06 落地 relay 拨号原语后，把 `net-config-probe-button` 接到宿主探测命令（身份与
  RTT 展示结构已就位）。
- T12/T11 接入方读中心 `relay-config`（`relayAddrs`）时，按 §4.9 并集去重；本中心
  不代任何业务暴露 / 连接。
