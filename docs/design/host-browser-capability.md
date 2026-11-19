# 宿主浏览器能力（host-browser）设计与 news 借鉴项参考

> **目的**：把「浏览器抓取进宿主、wasm 只调度」的裁定落成可执行设计，并汇总 news 可借鉴开源热点项目的能力与实现方式。
>
> **性质**：跨仓提案。能力仓 `wasmnest-server-browser` 已落地契约分片与纯引擎机制（闸门 / 提取脚本 / 上限 / 端口 / 错误分类）；端实现（桌面 Obscura sidecar、移动 stub）与平台装配尚未落地。`host-browser` 的契约真源在能力仓 WIT，实现在平台仓；本文只定义形状、闸门与验收口径，不替代真源。
>
> **依据**：2026-11-19 对平台仓 CSP / WIT / 出站闸门的代码核查；Obscura README 与 Cargo.toml；TrendRadar、NewsNow、DailyHotApi 的公开文档；news v1 源码核查。
>
> **范围**：能力仅桌面可用；WIT 双端同形，移动端由 stub 返回 `unsupported`。不改变 news v1 已交付能力。

---

## 0. 一句话总结

宿主新增一条通用原语 `host-browser.fetch-rendered`：插件传 URL 与声明式选择器，宿主在独立浏览器进程里执行 JS、提取结构化结果；桌面由 Obscura sidecar 实现，移动端是显式 stub。news 的借鉴项分两批：**不依赖浏览器的正确性与体验项先做**，依赖浏览器的任意网页源、正文阅读、中文热榜后置。

---

## 1. 裁定与边界

| 项 | 裁定 |
| --- | --- |
| 能力落位 | 宿主（平台仓 Rust），不进 wasm |
| 插件视角 | 一条 WIT 原语 + 一个权限位，不感知宿主内部实现 |
| 端 | 能力仅桌面可用；契约双端同形，移动 stub 返回 `unsupported` |
| 浏览器引擎 | 桌面用 Obscura（Rust + V8 + CDP），不依赖 Chromium |
| 进程形态 | 宿主管理的 loopback sidecar（推荐），不内嵌进宿主主进程 |
| 抓取对象 | 用户显式添加的源；不自建签名爬虫，不预置需登录态的站点 |
| 提取方式 | 声明式 CSS 选择器；**不暴露任意 `eval`** |
| 与 `http_fetch` 的关系 | 两条独立能力：静态 HTTP 仍走 `network:http`；需要执行 JS/读 DOM 才走 `network:browser` |

**真源声明**：

- WIT 真源：能力仓新建 `wasmnest-server-browser/wit/browser.wit`（参照 `wasmnest-server-http/wit/http.wit` 的能力域自持契约分片），**双端同形**。不能做成桌面独有分片：news 两端共用同一份 wasm 产物（ADR 0050），world 的 import 必须全部满足，否则移动端实例化即失败；移动宿主提供 stub 实现，返回 `browser.unsupported`。端生成物由 `compose-wit.mjs` 拼装，双端 `compose.json` 的 caps 都指向本分片。
- 权限词汇真源：平台仓 `wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`。
- 实现真源：平台仓桌面宿主；本文的 WIT 草案只是评审输入。
- 路径基准：本仓根；跨仓路径以 `../` 开头。

---

## 2. 为什么必须进宿主

三条路都不成立，才轮到宿主能力：

| 路径 | 否因 |
| --- | --- |
| wasm 内嵌 Obscura | V8 是 native JIT；wasm guest 无 socket、无进程、无线程模型，70 MiB 产物也不适合移动端 |
| 宿主 WebView 当抓取浏览器 | 生产 CSP 为 `default-src 'self' asset:`、`connect-src 'none'`，无 `frame-src`；跨域 iframe 读不到 DOM；插件也没有创建 webview 的绑定 |
| `host.http_fetch` 拿静态响应 | 只能拿到服务端返回的 HTML，无法执行站点 JS，签名参数不会出现 |

结论：要「执行 JS + 读 DOM」，只能由宿主起一个真正的浏览器；插件侧保留一条最小原语。

---

## 3. 能力契约（WIT 草案）

命名与现有能力域一致：`package wasmnest:browser@0.0.1;`，接口前缀 `host-`，world `cap-browser` 双端同形，只 import，不 export。

```wit
package wasmnest:browser@0.0.1;

/// 浏览器渲染与结构化提取（双端同形；移动实现返回 unsupported）
interface host-browser {
    enum wait-until {
        load,
        dom-content-loaded,
        network-idle,
    }

    /// 列表提取：item 选中条目容器，其余字段相对容器
    record list-spec {
        item: string,
        title: option<string>,
        url: option<string>,        // CSS 或 "attr:href"
        time: option<string>,       // CSS 或 "attr:datetime"
        summary: option<string>,
    }

    /// 正文提取：只取一个容器内的可读文本
    record page-spec {
        content: option<string>,    // 正文容器 CSS；缺省则取整页可读文本
    }

    record request {
        url: string,
        wait-until: wait-until,
        timeout-ms: u32,             // 宿主 clamp 到 1..=30000
        allow-private-network: bool, // 只是申请；最终由宿主授权记录裁决
        extract-list: option<list-spec>,
        extract-page: option<page-spec>,
    }

    record extracted-item {
        title: string,
        url: string,                 // 宿主已解析为绝对 URL
        time-text: option<string>,   // 原始时间文本，时间语义由插件解析
        summary: option<string>,
    }

    record response {
        status: u16,
        final-url: string,
        title: option<string>,
        text: option<string>,        // 整页可读文本，≤256 KiB
        content-text: option<string>,// 正文文本，≤256 KiB
        items: list<extracted-item>, // ≤200 条
        truncated: bool,             // 任一字段被截断即 true
    }

    fetch-rendered: func(req: request) -> result<response, string>;
}

world cap-browser {
    import host-browser;
}
```

设计约束：

1. **不接受任意表达式**。`list-spec` 只接收 CSS 选择器；宿主执行固定提取逻辑。否则等于给插件一个「宿主内 RCE + 读任意页面」的入口。
2. **不返回整页 HTML**。返回 `text` / `content-text` / `items`，避免把大载荷拷进 guest 线性内存；插件也不需要 HTML 解析器（wasm guest 没有 `scraper`）。
3. **时间不做语义解析**。`time-text` 原样返回，由 news 现有 `datetime.rs` 解析；宿主不猜相对时间。
4. **URL 由宿主绝对化**。相对链接按 `final-url` 解析；插件拿到即可入库，不需要 `url` crate。
5. **错误用稳定前缀**，便于插件分类与 UI 文案：

| 错误前缀 | 含义 | 插件处理 |
| --- | --- | --- |
| `browser.denied` | 用户拒绝该 origin | 源标红，给「重新授权」入口 |
| `browser.unsupported` | 当前端不支持（移动） | 显性提示，不重试 |
| `browser.blocked-private` | 私网目标被闸门拒绝 | 提示需在设置页显式允许 |
| `browser.timeout` | 导航/脚本超时 | 进退避 |
| `browser.http-error` | 目标返回 4xx/5xx | 进退避，展示状态码 |
| `browser.parse-error` | 选择器无命中或页面结构变化 | 进退避，提示源可能失效 |
| `browser.too-large` | 超过响应上限 | 截断返回或失败，按实现定 |
| `browser.unavailable` | 宿主浏览器进程不可用 | 源标红，提示重启宿主 |
| `browser.invalid-request` | 请求形状非法（协议 / 选择器 / 超时区间） | 不重试，修正源配置 |

---

## 4. 权限与安全闸门

### 4.1 权限

- 新增 `network:browser`（词汇真源 `permission.rs`；`manifest-gen` 映射同步）。
- 与 `network:http` **不互相隐含**：只授 `network:browser` 不能发静态 HTTP，反之亦然。
- 授权按 **origin** 记录，默认 `ask`；首次调用弹用户确认，可记「始终允许」。
- 插件在 `plugin.json` 显式声明；未声明即加载期拒绝。

### 4.2 闸门（缺一不可）

| 闸门 | 规则 |
| --- | --- |
| SSRF | **默认拒绝**回环、RFC1918、链路本地、云元数据地址；`allow-private-network` 只是申请，必须与用户对该 origin 的授权记录一致；公网 → 私网重定向一律 Stop |
| 协议 | 只允许 `http` / `https`；拒绝 `file:` / `data:` / `javascript:` / `blob:` |
| 上限 | `text` / `content-text` ≤ 256 KiB；`items` ≤ 200；`truncated=true` 显性标记 |
| 超时 | 总 30s（对齐 Obscura 默认 script deadline）；插件可传更小，宿主 clamp |
| 并发 | 全局 1–2 个 browser context；按插件串行，不抢占宿主主线程 |
| Cookie | 默认不持久化、不与宿主共享；每个插件独立 storage dir；需要登录态由用户在 sidecar 侧配置，插件拿不到 cookie |
| 审计 | 每次记 `plugin_id / origin / status / duration`；不记正文、不记 header/cookie |
| 提取 | 只接受 CSS 选择器；限制选择器长度与执行预算，拒绝 `:has()` 等可能爆炸的组合可另行评估 |
| 供应链 | Obscura 版本 pin + 二进制 sha256；Apache-2.0，分发保留 LICENSE / NOTICE |

### 4.3 与 `http_fetch` 的差异

`http_fetch` 允许私网直连（局域网文件服务需要），只阻断「公网 → 私网」重定向。浏览器能力**更严**：默认连私网都不去，因为「拿宿主浏览器打内网」是更高价值的攻击面。这个差异必须在用户文档里写清，避免用户以为两个能力的网络策略一致。

---

## 5. 桌面实现：Obscura sidecar

### 5.1 事实（2026-11-19 核查）

| 项 | 值 |
| --- | --- |
| 仓库 | `h4ckf0r0day/obscura`，Apache-2.0，2026-04 创建，36k stars，活跃 |
| 引擎 | 纯 Rust + V8，自带 DOM / 网络 / 渲染；不依赖 Chromium |
| 体积 | 二进制 ~70 MiB；内存 ~30 MB；Docker 镜像 ~57 MB 压缩 |
| 服务 | `obscura serve --port 9222` 提供 CDP；`obscura fetch` / `scrape` 提供 CLI |
| 依赖 | `tokio` full、`reqwest`（rustls/socks）、V8；stealth 变体还要 BoringSSL |
| wasm | 无 wasm/wasi 目标；不能作为 wasm guest 依赖 |

### 5.2 进程形态

```text
host-browser (Rust, 平台仓)
  ├─ 进程管理：按需启动 / 健康检查 / 退出清理 / token
  ├─ 传输：CDP over loopback（ws://127.0.0.1:<port>/devtools/browser）
  ├─ 提取：Page.navigate + Runtime.evaluate(内置选择器脚本)
  └─ 子进程：obscura serve --host 127.0.0.1 --port <p>
                OBSCURA_CDP_TOKEN=<随机>
```

- **不内嵌**进宿主主进程：V8 执行第三方 JS，崩溃与漏洞应按子进程隔离；也避免所有用户的安装包凭空 +70 MiB。
- 分发：走 Tauri `externalBin` 或宿主自带的运行时下载缓存；版本 pin + sha256 校验，失败 `browser.unavailable`。
- 生命周期：随宿主启动预热，或首次调用时启动；空闲超时退出；崩溃后重启一次，再失败则标记不可用。
- 隔离：非 root、仅 loopback、独立 storage dir；插件之间不共享 profile。

### 5.3 为什么不是内嵌

| 维度 | 内嵌 crate | sidecar |
| --- | --- | --- |
| 崩溃隔离 | 差（V8 与宿主同进程） | 好（可降权、可重启） |
| 宿主包体 | +~70 MiB | 不变，按需下载 |
| 升级 | 跟宿主版本 | 独立升级 |
| 移动 | 不可行 | 不可行 |

---

## 6. 移动端行为

- WIT 必须双端同形，移动宿主提供 stub 实现，调用返回 `browser.unsupported`。原因不是产品语义，而是装配约束：news 两端共用同一份 wasm 产物，world 的 import 必须全部满足，桌面独有分片会让移动端在实例化阶段就失败，连「显示不支持」的机会都没有。
- 插件必须在 UI 上显性提示「此能力仅桌面端可用」，不把源静默隐藏；权限存在不等于能力可用。
- 未来若要补，唯一可行路径是系统 WebView（Android `WebView` / iOS `WKWebView`）+ JS 注入；那是另一期工程，不在本文范围。
- 移动端仍可用 `network:http` 接 RSS / JSON 源；`host-browser` 不是移动新闻功能的必要条件。

---

## 7. news 侧消费方式

1. `plugin.json` 增 `network:browser`。双端都声明：`manifest-gen` 静态扫描到 `fetch-rendered` 就要求该权限，共享产物两端同形；移动端声明了也不会成功调用，只会拿到 `browser.unsupported`。
2. core `Ports` 增 `browser: &dyn BrowserPort`；native 测试用 fake，不触网。
3. `SourceKind` 增 `web`（或 `rendered`），源配置带：
   - `url`
   - `waitUntil`（默认 `dom-content-loaded`）
   - `list` 选择器（item/title/url/time/summary）
   - `allowPrivateNetwork`（默认 false）
4. 抓取路径：`web` 源 → `browser.fetch-rendered` → `RawItem`（`external_id` 用条目 URL 归一化值或源内序号）→ 现有去重/入库/打分链路。
5. 失败路径：所有 `browser.*` 错误进 `fetch_log`，按现有 5/15/60 退避；连续 3 次失败标红；不静默回退到空列表。
6. v2 正文阅读复用同一原语：`page.content` + `content-text` 落收藏归档；不新增第二条抓取通道。

---

## 8. news 可借鉴项总表

来源项目：TrendRadar（`sansan0/TrendRadar`）、NewsNow（`ourongxing/newsnow`）、DailyHotApi（`imsyy/DailyHotApi`）；「Hot Radar」未能在 GitHub 唯一锁定，仅按功能描述参考。

### 8.1 正确性修复（P0，不依赖浏览器）

| 项 | 来源 | news 现状 | 实现方式 | 依赖 |
| --- | --- | --- | --- | --- |
| 源内稳定 ID 去重 | TrendRadar「guid > url」；NewsNow `NewsItem.id` | `RawItem` 无 guid，`dedup::decide` 只用归一化 URL + 同源标题指纹（`apps/news/rust/core/src/dedup.rs:36`） | `RawItem.external_id`；RSS 读 `<guid>`/Atom `<id>`；`item_origins.external_id` + 索引；判定顺序：同源 external_id → 归一化 URL → 同源标题指纹 | 无 |
| AI 摘要与源摘要分离 | TrendRadar「已分析不重复消耗 token」 | **缺陷**：`items.summary` 同时存两种摘要；`save_item_summary` 无条件覆盖（`apps/news/rust/core/src/store.rs:805`），注释却写「只补空」；批量无幂等（`apps/news/rust/core/src/engine.rs:947`） | 新增 `ai_summary / ai_title / ai_at / ai_model`；`summary` 只存源摘要；读取 `ai_summary ?? summary`；批量只取 `ai_summary IS NULL` | 无 |
| AI 失败回退 | TrendRadar「AI 筛选失败自动切回关键词匹配，推送不中断」 | 失败时条目仍在，但没有「降级说明」，也没有原文摘要回退标记 | 失败不写 `ai_*`；详情显示「AI 摘要不可用（原因）」+ 原文摘要；不静默替换 | 无 |

### 8.2 不依赖浏览器的体验增强（P1/P2）

| 项 | 来源 | news 现状 | 实现方式 | 依赖 |
| --- | --- | --- | --- | --- |
| 每圈/每源展示配额 | TrendRadar `max_news_per_keyword` | 今日只按分数排序，单一话题可刷屏 | 纯函数 `apply_quota(items, perCircle, perSource)`，排序后执行；超出折叠为「还有 N 条」，不丢数据；默认 0 = 不限制 | 无 |
| 「本次新增」标记 | TrendRadar 5.0「🆕 本次新增」 | 已有 `first_seen_at`，UI 未使用 | `first_seen_at > last_viewed_at` 显示 NEW；实时视图本质已是新增流 | 无 |
| stale 语义显性化 | DailyHotApi 60 分钟缓存；NewsNow 30 分钟缓存 | 条目持久化，失败不丢旧数据；UI 只显示 last_error | `Feed` 加 `stale / data_age_ms`；顶部标注「数据截至 HH:MM，最近一次抓取失败」 | 无 |
| 按源自适应轮询 | NewsNow「adaptive interval，最低 2 分钟」 | 固定 15 分钟节拍（`apps/news/rust/core/src/schedule.rs:7`），所有源同频 | `sources.poll_interval_secs` 默认 900；连续 0 新增则翻倍、上限 3600；有新增回落 900；手动刷新永远绕过 | 无 |
| 榜单快照 + 排名轨迹 | TrendRadar「排名时间线 / 趋势箭头 / 爆火检测」；Hot Radar「趋势对比」 | `Item` 只有派生 `score`，无每轮排名；HN/GitHub Trending 适配器无 position | 新表 `item_rank_snapshots(item_id, source_id, position, captured_at)`；展示 `↑3 / ↓2 / NEW / 在榜 6h`；爆火 = 在榜 ≥3 轮且 rank_delta > 0 且 origin_count 增加；**不并入 score** | 无（RSS 无 rank 不参与） |
| 瞬时失败立即重试一次 | TrendRadar「RSS 临时失败立即重试一次」 | 失败直接进 5 分钟退避 | 仅对 GET + 5xx/超时重试 1 次，4xx 不重试；仍失败才退避 | 无 |
| 源域名校验 | TrendRadar `expected_domain` | 只校验 http/https，未校验链接域名归属 | `sources.expected_domain` 可选；不匹配丢弃并记 warn；默认关闭（RSS 常跨域） | 无 |
| 导出 RSS | DailyHotApi「JSON / RSS 双模式」 | 已有 JSON 导出 | 用 `Feed` 手写 RSS 2.0；`guid` 用 `item.id`；只导出文件，不开 HTTP 服务 | 无 |
| 标题翻译 | TrendRadar AI 翻译 | 内置源多为英文，v1 只有 60 字中文摘要 | prompt 一次返回 `{title_zh, summary_zh}` JSON；只对 `lang != zh`；不新增请求数 | 无 |
| 关键词/兴趣过滤 | TrendRadar 关键词分组 + 正则语法 | 圈子是「源分组 + 权重」，无条目级过滤 | 圈子增 `include_keywords / exclude_keywords`；大小写不敏感 substring 匹配，不引入 regex；被过滤条目在「显示全部」下可见 | 无 |
| 助手工具面统一结构 | TrendRadar MCP `{success, summary, data, error}` + 日期枚举 | 已有 4 个 assistant tools | 统一返回结构；日期参数用 `today / yesterday / last7d` 枚举，不让模型算时间戳；只读资源清单（源、圈子、可查询日期） | 无 |

### 8.3 依赖聚合口或 host-browser（P2 / v2）

| 项 | 来源 | 现状 | 实现方式 | 依赖 |
| --- | --- | --- | --- | --- |
| 通用 JSON 源 | DailyHotApi「路由即源」；NewsNow `defineSource` | `SourceKind` 只有 `reddit` 专用 JSON，无通用 `json`（`apps/news/rust/core/src/domain.rs:107`） | 受限字段映射：点分路径取 `items / title / url / time / summary`；不允许注入脚本 | 无（接 RSSHub/DailyHotApi 实例） |
| 任意网页源（CSS 选择器） | TrendRadar `rss` / 自定义源；Hot Radar 双平台抓取 | v1 明确不做任意网页 CSS 选择器 | `SourceKind::web` + `list-spec`；由 `host-browser` 执行；选择器不命中返回 `browser.parse-error` | `host-browser` |
| 正文阅读（v2） | TrendRadar `read_article` / Jina Reader；news v2 spec | v2 已规划「桌面正文阅读 + 收藏文本归档」 | `host-browser` 返回 `content-text`；落收藏归档；不新增第二条抓取通道 | `host-browser` |
| 中文热榜 | TrendRadar 35+ / DailyHotApi 40+ | 未预置中文源 | 优先接 RSSHub / DailyHotApi 的公开路由；需要执行 JS 或登录态的站点才走 `host-browser`；不自建签名爬虫 | 聚合口或 `host-browser` |

### 8.4 明确不抄

| 不抄项 | 理由 |
| --- | --- |
| 抖音/小红书/微博签名爬虫 | 破解签名属于绕过风控；App 端私有算法与设备指纹不是浏览器 stealth 能保证的 |
| Playwright / Puppeteer / Twint / Scweet | wasm 无浏览器/进程；Twint 已停维护；登录态抓取违反本仓口径 |
| GitHub OAuth + 云同步 | news 无后端、隐私本地优先 |
| MCP server / 常驻 Web 服务 / 多渠推送 | 插件无常驻进程；无可信凭证托管；推送不可靠 |
| AI 兴趣打分排序 | 与 v1「确定性、可解释、可回归」冲突；AI 只做摘要/翻译，不排序 |
| Docker / GitHub Actions 一键部署 | 服务端形态，不是 wasm 应用 |
| 运营日报 | 面向内容运营团队，不是个人新闻应用 |

### 8.5 源策略分层（架构原则）

| 层 | 形态 | 例子 | 维护方 |
| --- | --- | --- | --- |
| 一级 | 官方 RSS / 公开 JSON | BBC、The Verge、HN、Reddit | 源站 |
| 二级 | 自托管聚合口 | RSSHub、DailyHotApi、NewsNow 实例 | 用户或社区 |
| 三级 | 需执行 JS 的页面 | 榜单页、SPA 站点 | `host-browser` |
| 不自建 | 签名爬虫 / 登录态爬取 | 抖音、小红书、微博 | 不做 |

原则：**多平台覆盖靠「接聚合口」，不是「写 35 个适配器」**。TrendRadar 本身也是调用 NewsNow 的 API，不是自己抓 35 个站点。news 每新增一个预置源都是长期维护负担，所以一级源优先、二级源让用户自填、三级源只在必须执行 JS 时启用。

---

## 9. 跨仓落地顺序与验收

顺序不能反：应用仓先写调用会因 import 名带版本而实例化失败。

1. **能力仓（已落地）**：`wasmnest-server-browser` 持有 `wit/browser.wit`（双端同形，只 import 不 export）与纯引擎机制——协议 / 私网闸门、提取脚本生成与输出解析、响应上限、稳定错误码、`BrowserPorts` 端口；`network:browser` 已进权限词汇真源。平台装配（compose 接线 / 移动 stub）与端后端在下一步。
2. **平台仓**：
   - `permission.rs` 增 `network:browser` + 授权档位；
   - `manifest-gen.js` 映射 `fetch-rendered` → `network:browser`；
   - 桌面宿主实现（Obscura sidecar + 进程管理 + CDP 调用 + 提取器）；
   - `compose-wit.mjs` / `compose.json` 接线；
   - `witVersion` bump；桌面宿主产物与下载源更新；
   - 契约锁：WIT 形状、权限门、SSRF、上限、错误码、移动 `unsupported`。
3. **平台仓发布**：新 SDK + 新宿主 runtime（`host-v<版本>` + sha256）。
4. **应用仓**：`host-runtime.lock.json` 同步；news 接入 `web` 源；双端构建（桌面真实宿主、移动 unsupported 路径）。
5. **release-manifest**：`witVersion` / `hostRuntime` / 应用条目不漂移。

验收判据：

- 契约测试：合法请求返回结构化结果；非法 origin 被拒；私网默认被拒；超限 `truncated=true`；移动端 `browser.unsupported`。
- 真实宿主目验：桌面装载 news，添加一个 `web` 源，真实抓到 ≥1 条；失败源标红且原因可见。
- 安全：`javascript:` / `file:` / 云元数据地址 / 公网→私网重定向全部拒绝；任意 `eval` 不可达。
- 不做「单测全绿 = 完成」的表述：UI 与真实宿主路径必须目验。

---

## 10. 风险与开放问题

1. **V8 攻击面**：Obscura 执行第三方 JS；必须 sidecar + 非 root + loopback + token，不能内嵌主进程还开任意 `eval`。
2. **包体/下载**：sidecar 需要分发或按需下载；离线用户首次使用会失败，必须 `browser.unavailable` 显性提示。
3. **风控不保证**：`host-browser` 只保证「执行 JS + 读 DOM」，不保证过抖音/小红书/微博的签名与设备指纹；抓登录态仍有 ToS/封号风险。
4. **Obscura 成熟度**：仓库 2026-04 创建、workspace version 0.1.0、迭代快；升级要 pin 版本并跑契约测试，不追 latest。
5. **权限粒度**：`network:browser` 是否按 origin 逐条授权、是否允许用户「始终允许」、撤销后是否立即中断在途抓取，需平台仓定。
6. **私网申请**：`allow-private-network` 只是申请；宿主必须把它与用户授权记录绑定，不能由插件单方面放宽。
7. **正文版权**：`content-text` 落收藏归档属于本地副本；导出/分享边界需在 v2 spec 里写清。
8. **不支持移动**：需要在插件市场/详情页标注「仅桌面」，避免移动用户装完才发现。契约双端同形只是为了共享 wasm 能实例化，不代表移动具备该能力。

---

## 11. 附录

### 11.1 Obscura 关键事实

- 仓库：`h4ckf0r0day/obscura`；许可证 Apache-2.0；2026-11-19 核查时 36k stars。
- 能力：V8 执行 JS、CDP、Puppeteer/Playwright 连接、截图/PDF、stealth 变体、Docker。
- 体积：二进制 ~70 MiB、内存 ~30 MB、Docker ~57 MB 压缩。
- 无 wasm/wasi 目标；只能宿主进程或 sidecar。

### 11.2 参考项目

| 项目 | 仓库 | 主要参考点 |
| --- | --- | --- |
| TrendRadar | `sansan0/TrendRadar` | guid 去重、排名轨迹、AI 增量分析、失败回退、关键词分组 |
| NewsNow | `ourongxing/newsnow` | 声明式源定义、自适应轮询、`NewsItem.id` |
| DailyHotApi | `imsyy/DailyHotApi` | 路由即源、JSON/RSS 双输出、缓存 |
| Hot Radar | 未唯一锁定 | 趋势对比、AI 选题解读（按功能描述参考） |

### 11.3 文件路径索引

- news v1 契约与验收：`docs/verification/news.md`
- news 出网裁定：`docs/adr/0010-news-egress-only-via-host-http.md`
- news 助手代抓裁定：`docs/adr/0011-news-assistant-fetch-stays-unimplemented.md`
- 平台 HTTP 契约：`../wasmnest-lib/wasmnest-server-http/wit/http.wit`
- 平台权限真源：`../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`
- 宿主 CSP：`../wasmnest/wasmnest-desktop/src-tauri/tauri.conf.json`