# news 的抓取出网只经宿主 HTTP 代理

**状态**：accepted（2026-11-18）

## 背景与问题

新闻聚合的核心动作是「按用户配置的源周期性发 HTTP 请求并解析响应」。直觉上应在 Rust 侧直接用 `reqwest`，因为解析与重试都需要细粒度控制。

WasmNest 的沙箱不允许 wasm 组件自己开 socket：

- WASI 装配只做 linker 注册与目录 preopen，从不调用 `allow_tcp` / `allow_udp` / `inherit_network`（`wasmnest-lib/wasmnest-wasm-core/src/manager/runtime/wasi.rs`）。
- 双端插件唯一的出网原语是 `Wasmnest:http@0.0.1` 的 `host-http.fetch`，签名只有一个字符串入参（`wasmnest-lib/wasmnest-server-http/wit/http.wit`），由宿主用 reqwest 代发。
- 宿主在发请求前做权限门与出站授权（`wasmnest-lib/wasmnest-server-http/src/plugin_binding/egress.rs`），并对「公网 → 私网」的重定向一律停止（防 SSRF），响应体上限 32 MiB。

## 决定

`news` 的所有出网（抓取源、AI 摘要、用户自定义端点）只经 `FetchPort` → 宿主 `host.http_fetch`，权限位只声明 `network:http`。应用侧不引入 `reqwest` / `ureq` / `tokio`，也不把请求交给前端。

请求级控制只保留宿主允许的部分：`method` / `url` / `headers`（含自定义 `User-Agent` / `Cookie` / `Authorization`）/ `body`（字符串）/ `stream`。超时、重定向、响应体上限、代理选择全部由宿主决定。

## 后果

**正面**：

1. 抓取自动继承权限门、SSRF 裁决、超时与响应体上限，应用不需要自己实现安全策略。
2. 双端同一份请求代码；移动端还能复用宿主的链路加密信封。
3. 用户可自定义域名，但「能不能访问」始终由宿主授权链路裁决，应用无法绕过。

**负面**：

1. **没有取消、没有请求级超时**。原设计的「单次 20 秒超时」不可实现，只能依赖宿主的连接 10s / 总 120s 上限；一个慢源会占住当前抓取轮次。
2. **没有二进制 body**，也无法控制重定向策略；某些需要 multipart 或特殊 TLS 配置的源不可能支持。
3. **移动端必须先声明**：`preauthUrls` 是静态清单，用户后加的域名必然首次 `NeedConsent`；桌面则是运行期 origin 授权，第一次访问弹一次并记住。两端体验天然不同，产品必须明示。

## 替代方案

- **应用内直接 `reqwest`**：wasm 侧无 socket 放行，编译出来也无法建立连接。否决（不是「不推荐」，是做不到）。
- **前端 `fetch`**：被 eslint 静态锁禁用，且绕开 Rust 侧授权与 SSRF 裁决。否决。
- **走 `ws:client` 自建 HTTP**：引入第二条传输能力、失去 HTTP 语义，且 `ws:client` 本身是独立授权的 SSRF 面。否决。
- **让宿主补「可取消 + 可设超时」的 fetch 变体**：正确方向，属跨仓改动（能力仓 WIT + 双端宿主 + SDK）。本 ADR 是它落地前的做法，落地后可平滑替换（请求形状不变，只加字段）。