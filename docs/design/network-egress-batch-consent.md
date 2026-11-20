# 网络出站批量授权（batch egress consent）

> **目的**：让「一次操作会访问多个不同域名」的应用只打扰用户一次，而不是每个
> origin 各弹一次授权窗。首个消费方是 bedcode 的 Agent Hub npm 源测速。
>
> **性质**：跨仓提案。WIT 真源在能力仓 `wasmnest-server-http`，宿主实现与弹窗在
> 平台仓，本仓只做需求、设计输入与消费方接入。本文定义的接口形状、授权语义与
> 错误码是评审输入，不代表真源已经变更。
>
> **范围**：只做「运行时提前询问」，不做静态免询问白名单；桌面先落地，移动端
> v1 显式返回 `consent.unsupported`。不改变现有单 origin 授权路径。
>
> **跟踪**：GitHub issue #29。

---

## 0. 一句话总结

应用在发起一批已知的出站请求前，把候选 URL 集合交给宿主；宿主归一化、去重、
过滤已授权 / 已拒绝目标后，把剩余 origin 放进**一个**弹窗，用户一次裁决，宿主按
origin 逐条落授权记录。实际 `fetch` 仍走原有判定链，批量入口不发放绕过闸门的
通行证。

---

## 1. 问题与证据

### 1.1 现状

| 事实 | 证据 |
| --- | --- |
| 授权询问粒度是单个 origin | `../wasmnest/wasmnest-desktop/src/shell/auth/NetworkAuthDialog.vue:114` 的请求载荷只有 `origin: string` |
| 只有同 origin 会合并，窗口 2 秒 | `../wasmnest-lib/wasmnest-wasm-core/src/security/network_auth.rs:79`（`PROMPT_MERGE_WINDOW`） |
| 跨 origin 不合并 | 询问队列键是 `(属主, origin)`，见同文件 `PromptKey` 与 `OriginPrompt` |
| host-http 契约只有一个函数 | `../wasmnest-lib/wasmnest-server-http/wit/http.wit:24` |
| 文件授权已有批量先例 | `../wasmnest-lib/wasmnest-wasm-core/src/security/fs_auth.rs:1148`（`request_user_auth_batch`） |
| 桌面不支持 `preauthUrls` | `../wasmnest/docs/contracts.md:76`；桌面 manifest 结构虽有字段，但判定链未接线 |

### 1.2 首个消费方：Agent Hub 测速

`apps/bedcode/desktop/rust/src/hub/install/registry.rs:55` 的 `speed_test` 会顺序探测
候选源：

- 内置 5 个源（`registry.rs:25`）：`npmmirror`、`npmjs`、`huawei`、`tencent`、`yarn`；
- 用户自定义源（`mirror.customSources`）追加在候选表之后；
- wasm 单线程、`http_fetch` 同步阻塞，因此请求是**串行**的。

结果是首次测速时每个不同 origin 各弹一次；若应用策略是「总是询问」，每次测速
都会重新弹。串行请求也意味着宿主无法靠「聚合并发请求」推断后续目标——应用必须
先告诉宿主这一批要访问什么。

---

## 2. 目标与非目标

### 2.1 目标

1. 一次批量询问覆盖 N 个不同 origin，用户只做一次裁决。
2. 授权记录仍按 origin 逐条落账，用户可在「设置 → 应用授权」逐条撤销。
3. 批量入口只提前询问；实际请求仍经过既有 `fetch` 判定链（声明门 → 硬拒绝 →
   策略档 → 记录 → 询问）。
4. 失败路径显性：不可归一化的 URL、超量、策略不支持、无弹窗通道都必须返回稳定
   错误码，不静默放行、不静默降级。
5. 无新增权限词汇：批量询问不扩大权限面，仍受 `network:http` 声明门约束。

### 2.2 非目标

- 不做「一次点击授权所有未来域名」；批量列表必须由应用显式提交并完整展示。
- 不做应用侧自授权或前端代授权；入口只能由 wasm guest 经 WIT 调用。
- 不在本轮接通桌面 `preauthUrls` 静态预授权（见 §8 备选）。
- 不在 v1 做逐项勾选 UI；v1 是「全部允许 / 本次拒绝 / 以后都拒绝」三态。
- 不在 v1 做移动端批量弹窗；移动端返回显式 `consent.unsupported`。
- 不改变现有单 origin 事件、命令与弹窗行为。

---

## 3. 契约草案（WIT，评审输入）

真源位置：能力仓 `../wasmnest-lib/wasmnest-server-http/wit/http.wit`。按现行契约风格，函数入参
与出参都用 JSON 字符串，避免为批量结果引入一套双端生成物 record。

```wit
// 版本号按实际当前版本 patch bump，此处只示意形状。
package wasmnest:http@0.0.2;

interface host-http {
    fetch: func(request-json: string) -> result<option<string>, string>;

    /// 出站批量授权提前询问。
    ///
    /// 只询问、不发请求；实际出站仍由 `fetch` 的判定链裁决。
    /// 入参为 `{ "urls": [...] }`，出参按入参索引返回每一项的
    /// `origin` / `decision` / `source`，并附带未落账条数。
    request-egress-consent: func(request-json: string) -> result<string, string>;
}

world cap-http {
    import host-http;
}
```

版本策略：

- 新增函数属于函数级追加，按现行政策 bump `wasmnest:http` 的 **patch** 版本；
- 包版本进入 import 名，**所有 import `host-http` 的应用都需要重建**（这是既有
  ABI 规则，不是本设计新增的代价）；
- 双端同形：移动端也生成该函数，v1 实现返回 `consent.unsupported`。

不把入口放进新的独立能力域：当前只有 host-http 需要它；宿主实现落在
`NetworkAuthChecker`，未来 host-browser 若需要批量询问，复用同一宿主安全层，
WIT 入口可按需再评估是否抽到通用网络域。

---

## 4. 请求与响应形状

### 4.1 请求

```json
{
  "urls": [
    "https://registry.npmjs.org/semver/latest",
    "https://registry.npmmirror.com/semver/latest"
  ]
}
```

规则：

- `urls` 必须是字符串数组，长度 1..=50；空数组返回成功空结果，不弹窗。
- 每个 URL 必须可归一化为 `http` / `https` 的 origin；`file:` / `data:` /
  `javascript:` / 无 scheme / 无 host 一律记为该索引 `invalid`，不参与弹窗。
- 同一 origin 的多个 URL 只占弹窗一行；响应仍按入参索引逐项返回，应用不需要
  自己做归一化。
- 请求里不接收任何 UI 文案或原因字段：应用不能替宿主写授权说明，避免诱导。

### 4.2 响应

```json
{
  "results": [
    { "index": 0, "origin": "https://registry.npmjs.org:443", "decision": "allow", "source": "user" },
    { "index": 1, "origin": "https://registry.npmmirror.com:443", "decision": "deny", "source": "user-denied-always" },
    { "index": 2, "decision": "invalid" }
  ],
  "droppedRecords": 0
}
```

字段：

- `decision`: `allow` | `deny` | `invalid`。
- `source`（仅 allow / deny）：
  - `record`：命中既有 allow 记录；
  - `always-allow`：策略为「始终允许」，免询问放行并留痕；
  - `user`：本次用户允许；
  - `deny-record`：命中既有 deny 记录，未询问；
  - `user-denied`：用户本次拒绝，不落账；
  - `user-denied-always`：用户选择「以后都拒绝」，已落 deny 记录。
- `droppedRecords`：因授权记录容量上限（`AUTH_RECORDS_CAP = 500`）未能落账的
  allow 条数。放行方向不变（与「始终允许」档同口径），但应用应能看到并提示
  「部分授权未记住，下次仍会询问」，宿主同时写 core-monitor 计数与 warn。
- `invalid` 项不回显原始 URL（可能含 token），只回索引。

### 4.3 整体错误码（`result` 的 err 字符串）

| 错误码 | 含义 | 应用处理 |
| --- | --- | --- |
| `consent.invalid-request` | JSON 形状非法、`urls` 非数组或元素非字符串 | 不重试，修正请求 |
| `consent.too-many` | 超过 50 个 URL | 应用分批提交或缩小候选集 |
| `consent.permission-denied` | 未声明 `network:http` | 清单缺口，修 manifest |
| `consent.always-ask` | 当前策略为「总是询问」，批量语义不成立 | 提示用户切到「默认」档；或逐个 `fetch`（每次都会问） |
| `consent.unsupported` | 当前端未实现批量询问（v1 移动端） | 回退到逐个 `fetch`（单 origin 授权弹窗仍可见），不伪造批量成功 |
| `consent.unavailable` | 无弹窗通道（无头 / 测试 / 事件投递失败） | 显性报错，不假装已授权 |
| `consent.store-failed` | 授权记录读取失败，无法判定 | 显性报错，不降级放行 |
| `consent.internal` | 其他宿主内部错误 | 显性报错 |

错误串只带稳定错误码与必要的归一化 origin / 索引，不带原始 URL。

---

## 5. 授权语义矩阵

批量入口只复刻判定链的前三步，第 4 步替换为「一次批量询问」：

| 策略档 | 行为 |
| --- | --- |
| `always_allow` | 不弹窗；对每个未落账 origin 落 `always_allow` allow 记录；返回 `allow/always-allow`。 |
| `default` | 先按 deny 记录 → allow 记录过滤；只把未决 origin 放进一个弹窗。 |
| `always_ask` | **直接返回 `consent.always-ask`**：不弹窗、不落账。该档的语义是「每次都问」，批量提前询问与它冲突；应用可回退到逐个 `fetch` 或提示用户切档。 |
| 策略读取失败 | 与单 origin 一致，fail-safe 退化为「询问 + 落账」（按 `default` 处理）。 |

### 5.1 `default` 档的弹窗决定

- **允许**：对所有未决 origin 落 `user` allow 记录，返回 `allow/user`。
- **本次拒绝**（`deny`）：不落账，返回 `deny/user-denied`；应用下次再申请仍会询问。
- **以后都拒绝**（`deny_always`）：逐条落 `user_deny` deny 记录，返回
  `deny/user-denied-always`；后续同 origin 在判定链第 1 步被硬拒绝，不再询问。
- **关闭弹窗 / Esc / 30 秒超时**：按「本次拒绝」处理，不落账。
- **事件投递失败**：整体 `consent.unavailable`，不落账。

### 5.2 记录粒度

- 只落 origin（`scheme://host:port`，默认端口显式化），path 不参与授权。
- 与现有单 origin 授权、`always_allow` 留痕完全同粒度，避免界面与库值形状不一致。
- 批量允许不会产生「应用级网络全放行」记录；每条 origin 记录仍可单独撤销。

---

## 6. 弹窗与事件契约

### 6.1 为什么新增事件与命令，而不是改造现有单 origin 路径

现有 `plugin:network-auth-request` 的载荷只有一个 `origin`，命令
`plugin_network_auth_respond` 也只接受单个决定。把载荷改成数组会让现有弹窗、
测试与兼容字段同时承担两种形状，回归面大于收益。批量走独立事件与命令，单
origin 路径零改动。

### 6.2 事件

`plugin:network-auth-batch-request`

```json
{
  "requestId": "uuid",
  "batchId": "uuid",
  "pluginId": "com.wasmnest.bedcode",
  "origins": [
    "https://registry.npmjs.org:443",
    "https://registry.npmmirror.com:443"
  ],
  "remembers": true
}
```

- `origins` 是去重后的未决 origin，按稳定顺序（建议按首次出现顺序）展示。
- `remembers` 与单 origin 语义一致：默认档为 `true`（允许会落账）；批量入口不会
  在「总是询问」档发出事件，因此不会出现 `false` 的批量弹窗。
- `batchId` 同时写入审计日志，便于把一次弹窗与 N 条记录对应起来。

### 6.3 命令

`plugin_network_auth_batch_respond`

```json
{
  "requestId": "uuid",
  "decision": "allow",
  "credential": "宿主面凭证"
}
```

- `decision`: `allow` | `deny` | `deny_always`。
- 应答沿用现有宿主面凭证绑定：应用无法替用户批准自己的授权。
- 未知 / 已作答 / 超时的 `requestId` 返回失败并记 warn，不改变已落定的决定。

### 6.4 弹窗 UI

- 新增 `NetworkAuthBatchDialog.vue`，复用 `NetworkAuthDialog` 的 modal 蓝图、
  样式 token 与宿主凭证应答路径。
- 内容：标题「网络访问授权（N 个地址）」、应用名、完整 origin 列表、授权含义说明。
- 三个动作与单 origin 一致：
  - 允许这 N 个地址（`allow`）；
  - 拒绝（`deny`）；
  - 以后都拒绝（`deny_always`）。
- 列表不得折叠、不得只显示「等 N 个地址」；用户必须能逐字核对每个 origin。
- 批量弹窗与单 origin 弹窗共用同一紧急层，一次只显示一个；后到事件排队，不得
  覆盖在途弹窗（现有单 origin 组件直接覆盖 `request` 的写法不能复用）。
- v1 不做逐项勾选；若后续需要，可把 `allow` 扩展为「选中的索引」，但接口与
  错误码必须保持向后兼容。

---

## 7. 宿主实现落点

### 7.1 能力仓（真源）

- `../wasmnest-lib/wasmnest-server-http/wit/http.wit`：新增 `request-egress-consent`，bump patch。
- `../wasmnest-lib/wasmnest-server-http/src/plugin_binding/ports.rs`：`HttpPorts` 新增批量端口，
  例如 `authorize_outbound_batch(plugin_id, urls) -> Vec<OutboundAuth>`；保持同步
  签名，与现有 `authorize_outbound` 同风格（能力域不做弹窗编排）。
- `../wasmnest-lib/wasmnest-server-http/src/plugin_binding`：新增入口实现，负责 JSON 解析、上限、
  归一化前置校验、逐项结果序列化、错误码映射；权限门复用 `network:http`。
- 测试：请求形状、50 上限、重复 origin 按索引回填、非法协议、权限拒绝、端口
  返回逐项结果时的顺序稳定性。

### 7.2 平台仓（桌面）

- `NetworkAuthChecker` 新增 `authorize_batch(plugin_id, urls) -> Vec<BatchVerdict>`：
  - 复用现有 `normalize_target`、`records_for_match`、`read_strategy` 与
    `AuthPolicyStore::grant` / `deny`，不另写一套判定；
  - 新增批量询问队列、事件投递、应答、超时与落账；单 origin 路径不动；
  - 「总是询问」档返回 `AlwaysAsk` 错误，不弹窗；
  - 记录容量触顶时返回 `droppedRecords`，不改变放行方向。
- `HostHttpPorts::authorize_outbound_batch`：同步桥接 `NetworkAuthChecker`。
- 宿主命令 `plugin_network_auth_batch_respond` + 前端事件
  `plugin:network-auth-batch-request`。
- 桌面前端新增批量弹窗组件，ShellHost 挂载；补组件测试（载荷渲染、三态映射、
  宿主凭证、事件到达时弹窗、应答后关闭）。
- `bin/manifest-gen.js` / `permission.rs` 不需要新增权限词汇；确认
  `manifest-gen` 对 `network:http` 的映射不变。
- `witVersion` bump、`compose-wit` 重拼、SDK 发布、宿主 runtime 发布。

### 7.3 平台仓（移动）

- 实现 `request-egress-consent` 返回 `consent.unsupported`，不伪造成功；错误码
  必须与桌面同词。
- 移动端单 origin 授权链保持不变；后续若要批量 UI，再对齐本设计的语义。

### 7.4 应用仓（消费方）

- 升级 `@binblink/wasmnest-plugin-sdk-desktop` 与 `wasmnest-plugin-api` 精确版本，
  同步 `host-runtime.lock.json`。
- bedcode `plugin.json` 仍只声明 `network:http`，不加权限。
- `speed_test` 在探测前调用批量授权：
  - 用 `all_sources(&state)` 生成候选 URL（`{url}/semver/latest`）；
  - `consent.unsupported` → 回退现有逐个 `fetch`；
  - `consent.always-ask` → 在测速卡片显示「当前授权策略为总是询问，无法批量授权」
    并提供跳转「设置 → 应用授权」的入口，不静默改档；
  - 其他错误 → 按现有测速失败路径显性展示；
  - 被拒绝的候选源在 `sources` 里标记 `reachable: false` 与原因 `denied`，不伪装成
    「网络不可达」。
- 单测：批量调用一次、拒绝源标记、错误码分支、回退路径。
- 真实宿主目验：首次测速弹一次批量窗；允许后 5 个源都进入测速；第二次测速零
  弹窗；在设置页撤销一个 origin 后，再次测速只询问该 origin。

---

## 8. 备选方案与否决理由

### 8.1 桌面接通 `preauthUrls`（静态预授权）

- 做法：桌面把 manifest `preauthUrls` 接入 egress 判定链（移动端已有 L2 声明先例）。
- 优点：内置 5 源可在安装 / 启用审批时一次批准，运行时零弹窗；不需要 WIT 变更。
- 否决为主方案的原因：
  1. 只覆盖构建期已知域名；用户自定义源仍然要逐个运行时授权。
  2. 固定声明通常不可逐条撤销，与「授权记录可撤销」的现有口径不一致。
  3. 审批弹窗目前只显示权限位，不显示 URL 清单；要补展示与撤销语义，工作量并不
     比批量询问小。
- 可作为后续优化单独评估，不阻塞本设计。

### 8.2 宿主聚合同一应用短窗口内的不同 origin 请求

- 做法：把 2 秒合并窗口从「同 origin」扩到「同应用任意 origin」。
- 否决：
  1. agent-hub 的 `http_fetch` 是串行阻塞，后续请求在第一次询问结束时还没发生，
     宿主没有可聚合的目标。
  2. 一次点击放行「尚未看到的后续域名」等于让用户为未知目标背书，安全语义变差。
  3. 与「总是询问」档的每次询问语义直接冲突。

### 8.3 应用侧自建 HTTP / 前端代授权

- wasm guest 没有 socket；前端与宿主同域但不是安全边界，不能替插件申请授权。
- 否决。

### 8.4 把测速改为并发请求

- wasm 单线程 + 同步阻塞 `http_fetch`，并发编排无法实现；即便未来有异步 fetch，
  也不能解决「用户看不到后续目标」的授权问题。
- 否决。

---

## 9. 安全与日志

- **不扩大权限面**：批量入口仍要求 `network:http`；每个 origin 仍由用户逐条裁决。
- **不绕过闸门**：批量入口不发送网络请求，只写授权记录；实际请求仍走 `fetch`
  的声明门、SSRF、重定向与响应上限。
- **不隐藏目标**：弹窗必须完整展示 origin；不支持折叠、模糊化或「等 N 个」。
- **不静默降级**：`always_ask`、无头、记录库失败、超量都返回稳定错误码；应用
  不得把它们伪装成「网络不可达」。
- **凭据红线**：授权记录与日志只出现归一化 origin；原始 URL 的 query / fragment /
  userinfo 不落库、不上屏、不进错误串。
- **审计**：记录 `plugin_id` / `batch_id` / `request_id` / 请求数 / 去重数 / 允许数 /
  拒绝数 / 非法数 / 落账丢弃数 / 耗时；逐条 origin 只进 debug 日志。
- **记录容量**：批量落账接近 `AUTH_RECORDS_CAP` 时必须显性返回 `droppedRecords`
  并写 core-monitor，不允许静默丢弃。

---

## 10. 跨仓落地顺序（不可颠倒）

1. **能力仓**
   - 修改 `../wasmnest-lib/wasmnest-server-http/wit/http.wit`（新增函数 + patch bump）；
   - 扩展 `HttpPorts` 与入口实现；
   - 补单测、clippy、fmt、默认形态依赖门禁；
   - 提交并打能力仓 tag（按现行发布流程）。
2. **平台仓**
   - `compose-wit` 重拼双端生成物，`witVersion` bump；
   - 桌面 `NetworkAuthChecker` 批量入口 + 宿主命令 + 批量弹窗；
   - 移动端显式 `consent.unsupported`；
   - SDK 绑定与发布、宿主 runtime 发布；
   - `check:wit` / `check:manifest` 双绿。
3. **应用仓**
   - 升级 SDK 与 `host-runtime.lock.json`；
   - bedcode `speed_test` 接入；
   - `test:run`、Rust 单测、构建、真实宿主目验；
   - 若涉及桌面交互面，补 E2E 锚点与用例。

应用仓不能先写调用：import 名带包版本，契约未发布前产物无法实例化。

---

## 11. 验收判据

### 11.1 能力仓

- 新增函数在双端 WIT 组合中可见；包版本只 bump 被改的 `wasmnest:http`。
- 单测覆盖：空列表、1 项、50 项、51 项、重复 origin、非法协议、非法 JSON、
  权限拒绝、端口逐项返回顺序。
- 默认形态编译、单测、clippy、fmt 通过。

### 11.2 平台仓 / 桌面

- `NetworkAuthChecker` 单测：
  - 默认档 3 个未决 origin → 只 emit 一次批量事件；允许后落 3 条 `user` 记录；
    再次批量 → 零弹窗、全部 `record`。
  - 混合已有 allow / deny：只询问未决部分；deny 不弹窗且返回 `deny-record`。
  - 「总是询问」档 → `consent.always-ask`，零弹窗、零落账。
  - 「始终允许」档 → 零弹窗，全部落 `always_allow`。
  - 超时 / 关闭 / 事件投递失败 → 不落账且结果显性。
  - 容量触顶 → 放行方向不变，`droppedRecords` 与 monitor 计数一致。
  - 同一 origin 的多个 URL → 弹窗一行、响应按索引逐项回填。
- 前端组件测试：N 个 origin 渲染、三个按钮映射、宿主凭证、事件到达即弹窗、
  应答后关闭、未知 requestId 的失败路径。
- 现有单 origin 授权测试全部保持绿（批量路径不得回归旧路径）。

### 11.3 应用仓

- bedcode Rust 单测：测速前只调用一次批量授权；拒绝源标记 `denied`；错误码分支。
- bedcode `test:run` 与 Rust 单测全绿。
- 真实宿主：首次测速一次批量弹窗；允许后全部源进入测速；第二次零弹窗；撤销
  单个 origin 后只询问该 origin；「总是询问」档给出显性提示。
- 不出现「批量授权失败但界面显示测速成功」的假绿路径。

---

## 12. 待评审的取舍

1. **v1 三态 vs 逐项勾选**：本设计推荐三态（全部允许 / 本次拒绝 / 以后都拒绝），
   把逐项勾选留给后续。理由是测速候选都是应用自己的源，三态已覆盖「全信 / 全不信
   / 临时拒绝」，逐项勾选会引入每项独立结果与部分落账的 UI 复杂度。
2. **是否新增权限词汇**：推荐不新增。批量询问不扩大能力面，`network:http` 已能
   表达「该应用可以出网」；若新增 `network:consent-batch` 会让权限位变成「操作方式」
   而非「能力」，与现行词汇的设计不一致。
3. **移动端优先级**：推荐 v1 只做桌面，移动端显式 `unsupported`。bedcode 是桌面
   应用；移动批量弹窗需要独立壳 UI，不应阻塞首个消费方。
4. **是否同时覆盖 host-browser**：推荐先把批量入口落在宿主 `NetworkAuthChecker`，
   让未来 host-browser 可以复用同一安全层；WIT 入口先挂 host-http，等 host-browser
   落地时再评估是否抽通用网络授权分片。