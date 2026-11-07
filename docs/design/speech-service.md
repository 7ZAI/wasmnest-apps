# 语音识别公共服务（speech）——设计定稿

> **状态**：design-locked（2026-11-07，经 12 轮设计评审逐条裁定）
> **定位**：`servers/speech`——服务型 wasm（L1 基础服务），给平台内任何应用提供「音频字节 → 文本」的识别服务。
> **本文档的效力**：实现以本文档为准；与代码 / 跨仓真源冲突时先修本文档再改代码。

---

## 0. 先说清楚三条边界（它们解释了后面所有取舍）

1. **这个服务不采集音频**。它接收字节（容器格式 + 采样率 + 声道 + 数据），不碰麦克风。宿主当前无任何音频能力（权限词汇 38 条无音频项、`core.wit` 与全部 cap 分片无采集接口、`wasmnest-apps` 全仓无 `getUserMedia`）。
2. **「本地识别」= 用户自建的本地 HTTP 端点，不是离线识别**。桌面 `127.0.0.1` 指用户自己的机器，可以在上面跑 faster-whisper-server / whisper.cpp server / sherpa-onnx 的 OpenAI 兼容层。移动端 `127.0.0.1` 指手机自己，默认不可用（见 §6.3）。真正的离线识别（模型进宿主）是独立的跨仓工程，不在本服务 v1 范围。
3. **重型操作在宿主端、wasm 只做调度**——这句在这次设计里**只部分成立**：v1 里 wasm 确实只做调度（编排、回退判定、请求构造、结果归一），但宿主端的「录音 + 重采样」能力**还不存在**，所以 v1 的音频必须由调用方提供（§8）。宿主音频能力是独立的跨仓申请。

---

## 1. 已裁定的决策一览

| # | 决策 | 理由摘要 |
| --- | --- | --- |
| D1 | 双端**单 wasm 产物**，沿用 file-transfer 模式（`rust/core` + `rust/plugin` + `wasmnest.sharedRustManifest`） | 识别逻辑（base64、字节校验、回退判定、结果归一）是纯函数，双端各写必漂移 |
| D2 | `local` 通道 = 自建 HTTP 端点（`127.0.0.1` / 局域网），非 wasm 内推理 | wasm 有 128MiB 线性内存 + 64G 燃料硬顶（`wasmnest-host-kit/src/limits.rs:41,63`），跑不动 ASR 模型；且组件无法链接 native 库（`cdylib` 限制） |
| D3 | API Key **归服务持有**，调用方不接触 Key | 否则「公共服务」退化成「公共 HTTP 代理」，权限面更大 |
| D4 | 桌面 Key 存 **secret-store**（`auth_secret_*`，`auth` 权限）；移动端无此能力，存 `storage` + UI 明确警告 | 移动端 `host/auth` 是设备入场认证引擎面、凭据零过境，全仓无 `set_secret`（§6.4） |
| D5 | v1 **Final-only**，接口按流式预留（Segment 带 `isFinal`） | 所有 Segment 都是 `isFinal=true`；`http_fetch` 本身不是长连接，流式靠宿主事件通道透传，v1 没有采集链路驱动它 |
| D6 | 优先级 = `mode`（`local-only` / `remote-only` / `auto`）+ `order`（仅 `auto` 生效） | 见 §5 |
| D7 | `auto` 下**只有连接类错误才回退**；本地「接了但识别失败」不回退 | 回退会掩盖真实问题，并让同一段音频被发两次 |
| D8 | 不缓存「本地可用性」 | 回退判定合并进本请求，零额外开销；缓存会造成「刚启动本地服务却仍走云端」 |
| D9 | 协议族：`openai-compatible`（本地 + 自定义）与 `dashscope`（国内厂商） | 国内 ASR 请求形态差异大（DashScope 私有 JSON + 异步轮询；腾讯 TC3 签名；讯飞 WS），不能一套通吃 |
| D10 | 音频传输用 **base64-in-JSON**，不用 multipart | `http_fetch` 的 `body` 必须是字符串（`egress.rs:316-317`），无 multipart 承载 |
| D11 | 语种默认 `auto`，可显式 `zh` / `en`；不承诺中英混说 | 多数 provider 对 code-switching 支持不一致 |
| D12 | 识别结果**不持久化**；只留 `transcription_records` 元数据（无音频、无文本） | 服务不是转写历史库；元数据用于排查「这次为什么走云端」 |
| D13 | `auto` 判据 = 连接被拒 / 解析失败 / 连接超时 / `502,503,504` | 结构化错误集，见 §7 |
| D14 | 单次识别音频**原始字节 ≤ 8 MiB**，超出报 `audio-too-large` | base64 膨胀 1.33×，加上 JSON 与 JS 字符串副本，逼近 128MiB |
| D15 | 异步形态：`transcribe-submit` → `jobId` → 事件 `speech.transcription.done` + `transcribe-result` 补拉 | 云端 ASR 2-20s，长音频更久；同步 RPC 超时给不足 |
| D16 | `preference.mode` 可由调用方覆盖，`order` 不可覆盖 | 防止调用方悄悄改优先级顺序 |
| D17 | 不分发 sidecar / 模型；只给默认端点建议 + 启动说明 | 模型分发（校验/多平台矩阵）是独立工程 |
| D18 | v1 面向调用方的音频由调用方提供；宿主音频能力走独立跨仓申请 | §8 |

---

## 2. 目录结构

```
servers/speech/
├── desktop/
│   ├── plugin.json              id=com.wasmnest.speech, platform=desktop, rustLibrary=wasmnest_plugin_speech
│   ├── package.json             独立 workspace；build → scripts/build.js
│   ├── scripts/build.js        （从 file-transfer/desktop/scripts/build.js 派生：
│   │                            manifest-path ../rust/plugin/Cargo.toml，
│   │                            target wasm32-unknown-unknown + componentize）
│   ├── vite.config.ts / vitest.config.ts / tailwind.config.js / postcss.config.js
│   ├── icon.svg
│   └── src/
│       ├── entry.ts            mountApp(root, env) + mountPreview(root, env)
│       ├── appContext.ts
│       ├── views/SpeechSettingsView.vue    设置面（通道、优先级、Key、自定义厂商）
│       ├── views/SpeechTestView.vue        导入音频做真实识别（v1 的唯一端到端入口）
│       ├── composables/useSpeechSettings.ts
│       ├── composables/useSpeechTest.ts
│       ├── i18n/{zh-CN,en}.ts
│       └── __tests__/
├── mobile/
│   ├── plugin.json              id 同上, platform=mobile, rustLibrary 同名
│   ├── package.json            wasmnest.sharedRustManifest: "../rust/plugin/Cargo.toml"
│   ├── vite.config.ts
│   └── src/
│       ├── index.ts            activate(context) / deactivate()
│       ├── views/SpeechSettingsView.vue
│       ├── i18n/
│       └── __tests__/
├── rust/
│   ├── core/                   零 SDK 依赖（仅 serde/serde_json；dev: base64）
│   │   ├── Cargo.toml          name = "wasmnest-speech-core"
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── audio.rs        AudioClip 校验（容器/采样率/声道/体积上限）
│   │       ├── base64.rs       RFC 4648 编解码（无第三方运行时依赖）
│   │       ├── settings.rs     SpeechSettings 默认值与校验（mode/order/通道配置）
│   │       ├── route.rs        通道选择与回退判定（纯函数，最核心）
│   │       ├── error.rs        结构化错误分类（是否可回退 / 是否可重试）
│   │       ├── segment.rs      Segment 归一与拼接
│   │       └── boundary_lock.rs 静态锁：核里不得出现 wasmnest_plugin_api
│   └── plugin/                 双端同构 wasm 源（不属任何一端）
│       ├── Cargo.toml          name = "wasmnest-plugin-speech"
│       └── src/
│           ├── lib.rs          activate / deactivate / invoke_command / on_message
│           ├── api.rs          #[plugin_api(manifest = "../plugin.json")] SpeechApi
│           ├── dispatch.rs     job 表：submit / poll / result / cancel
│           ├── channel_local.rs
│           ├── channel_remote_openai.rs
│           ├── channel_remote_dashscope.rs
│           ├── secrets.rs      Key 读写（桌面 secret-store / 移动 storage 双实现）
│           └── records.rs      transcription_records（私有库）
└── CHANGELOG.md
```

**crate 内的相对路径**（照 file-transfer 的上溯约定，`rust/plugin/src/` 起算上溯三级到应用根）：
`include_str!("../../../desktop/plugin.json")`、`#[plugin_api(manifest = "../../../desktop/plugin.json")]`。

---

## 3. `plugin.json` 骨架（desktop）

```json
{
  "id": "com.wasmnest.speech",
  "name": "Speech",
  "version": "0.0.1",
  "platform": "desktop",
  "type": "internal-business",
  "pluginType": "full",
  "rustLibrary": "wasmnest_plugin_speech",
  "icon": "icon.svg",
  "main": "index.js",
  "description": "语音识别公共服务：为平台内应用提供「音频字节 → 文本」的识别能力。支持本地自建端点与国内云厂商两条通道，可配置优先级与自动回退。",
  "author": "WasmNest",
  "permissions": ["network:http", "storage", "auth", "broadcast", "bus"],
  "api": [
    "com.wasmnest.speech.transcribe-submit",
    "com.wasmnest.speech.transcribe-result",
    "com.wasmnest.speech.transcribe-cancel",
    "com.wasmnest.speech.settings-get",
    "com.wasmnest.speech.settings-set",
    "com.wasmnest.speech.channels-probe",
    "com.wasmnest.speech.records-list"
  ],
  "contributes": {
    "commands": [
      { "id": "speech.transcribe", "title": "Speech: Transcribe Audio" },
      { "id": "speech.test", "title": "Speech: Test Local Endpoint" }
    ],
    "provides": [{ "event": "speech.transcription.done" }]
  }
}
```

`mobile/plugin.json` 差异：`"platform": "mobile"`、`permissions` 去掉 `auth`（移动端无 secret-store，见 §6.4）、`contributes.commands` 只留命令、无 `preauthUrls`（端点由用户填，无法预知；移动端首次出站会走宿主 preauthorize 弹窗）。

> **权限复核**：`network:http`（必需，出站与回退探测）、`storage`（设置 + 移动端 Key）、`auth`（桌面 secret-store）、`bus`（互调 api 面，`api_call` 走 `wasmnest.api.*` topic）、`broadcast`（发 `speech.transcription.done`）。都在桌面 38 条词汇内；移动端 18 条里 `network:http`/`storage`/`bus` 都有。

---

## 4. 互调 API 面

### 4.1 签名

```rust
#[plugin_api(manifest = "../plugin.json")]
pub trait SpeechApi {
    /// 提交识别任务，立即返回 jobId（不阻塞）。
    #[api("transcribe-submit")]
    fn transcribe_submit(request: TranscribeRequest) -> Result<SubmitOutcome, String>;

    /// 取结果：Completed 后调用；Running 时返回当前进度；未知 jobId → NotFound。
    #[api("transcribe-result")]
    fn transcribe_result(job_id: String) -> Result<JobState, String>;

    /// 取消：未完成的 job 置 Cancelled；已完成的返回 Ok(false)。
    #[api("transcribe-cancel")]
    fn transcribe_cancel(job_id: String) -> Result<bool, String>;

    /// 读全局设置（Key 字段以 `hasKey: bool` 替代明文，永不回传明文）。
    #[api("settings-get")]
    fn settings_get() -> Result<SpeechSettingsView, String>;

    /// 写全局设置（Key 经独立字段写入，与设置分开）。
    #[api("settings-set")]
    fn settings_set(patch: SettingsPatch) -> Result<SpeechSettingsView, String>;

    /// 探测通道可用性（真实发起一次最短请求），结果分类返回。
    #[api("channels-probe")]
    fn channels_probe() -> Result<Vec<ChannelProbe>, String>;

    /// 最近 N 条识别元数据（无音频、无文本）。
    #[api("records-list")]
    fn records_list(limit: Option<u32>) -> Result<Vec<TranscriptionRecord>, String>;
}
```

### 4.2 请求 / 响应形状

```jsonc
// TranscribeRequest
{
  "audio": {
    "container": "wav",        // wav | mp3 | m4a | webm | ogg | pcm
    "sampleRate": 16000,       // 单声道 PCM 必须给；其余容器可省
    "channels": 1,
    "dataBase64": "UklGR..."   // 原始字节的 base64
  },
  "language": "auto",          // auto | zh | en
  "preference": { "mode": "auto" },   // 可选；只允许覆盖 mode
  "contextPrompt": null,       // 可选，透传给支持的 provider（DashScope 支持热词，openai 支持 prompt）
  "callerTag": "bedcode"       // 可选，写入记录便于排查；不参与路由
}

// SubmitOutcome
{ "jobId": "sp-<uuid>", "channel": "local", "state": "running" }

// JobState
{
  "jobId": "sp-...",
  "state": "running",              // running | completed | failed | cancelled
  "channel": "local",              // 实际执行通道
  "fallback": { "from": "local", "to": "remote", "reason": "connect-refused" },  // 无回退则为 null
  "text": null,                     // completed 时给全文
  "segments": [                     // v1 恒为单元素且 isFinal=true
    { "text": "...", "startMs": 0, "endMs": 4200, "isFinal": true }
  ],
  "language": "zh",                 // 实际识别语种（provider 返回或按请求）
  "error": null,                     // failed 时给 { kind, message, retryable }
  "elapsedMs": 1234
}
```

**为什么 `transcribe-result` 而不是把结果塞事件**：事件会丢（订阅者激活晚于完成）；补拉是幂等兜底。事件 `speech.transcription.done` 的 payload 与 `JobState` 相同，订阅者可只用事件，不可用则退化为轮询。

---

## 5. 通道与优先级

### 5.1 设置模型

```jsonc
{
  "mode": "auto",                 // local-only | remote-only | auto（默认 auto）
  "order": ["local", "remote"],   // 仅 auto 生效
  "local": {
    "enabled": true,
    "endpoint": "http://127.0.0.1:8000/v1/audio/transcriptions",
    "adapter": "openai-compatible",
    "model": "whisper-1",
    "connectTimeoutMs": 1500      // 「本地不可用」的判定窗口
  },
  "remote": {
    "vendor": "dashscope",        // dashscope | custom
    "endpoint": null,             // custom 必填；dashscope 用默认
    "adapter": "dashscope",       // dashscope | openai-compatible
    "model": "paraformer-v2",
    "hasKey": true                // 只读，不存明文
  }
}
```

### 5.2 通道选择（`core/route.rs`）

```
mode=local-only  → [local]
mode=remote-only → [remote]
mode=auto        → order（默认 [local, remote]）
```

按序列逐个尝试；**每次尝试只允许「连接类失败」触发下一个**（见 §7 分类）。序列耗尽时返回最后一个错误（不是第一个），因为最后一个通常是用户真正关心的。

### 5.3 为什么 `auto` 下本地失败不回退到“重试本地”

连接被拒视为「本地服务没起来」，直接进下一通道；连接超时同样。**不做同通道重试**——`auto` 的语义是「哪条能走」，不是「重试到成功」。

---

## 6. 各通道实现

### 6.1 `channel_local`（adapter: `openai-compatible`）

- 请求：`POST {endpoint}`，`Content-Type: application/json`，body 为
  `{"model": <model>, "language": <auto→省略/zh/en>, "file": {"name": "audio.<container>", "content_base64": "<b64>"}}`
  并在 headers 带 `X-Speech-Transfer: json-base64`（自描述，方便本地服务端识别）。
- **兼容性兜底**：若响应 `400` 且 body 含 `multipart` 相关提示，可再试一次 `file.encoding: "raw-base64-field"` 变体。**只重试一次**，仍失败即报 `protocol-mismatch`。
- 期望响应：`{"text": "..."}`（OpenAI 形状）或 `{"segments": [...]}`。
- 无 Key（本地端点默认不鉴权）；若用户填了 Key，则以 `Authorization: Bearer` 带上。

### 6.2 `channel_remote_dashscope`

因 DashScope 的 `paraformer` 是**异步任务**形态（提交 → 轮询 → 取结果），而我们的 job 表本身就是异步的，所以**直接映射**：

1. `POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription`
   headers：`Authorization: Bearer <key>`、`X-DashScope-Async: enable`、`Content-Type: application/json`
   body：`{"model":"paraformer-v2","input":{"file_urls":[...]},...}`
2. 响应给 `task_id` + `task_status`。
3. 轮询 `GET .../tasks/{task_id}`，间隔 500ms → 1s → 2s（指数退避，上限 5s，总预算 ≤ 90s）。
4. 终态取 `results[].transcription_url`，再 `http_fetch` 该 URL 拿 JSON，归一成 Segment。

> ⚠ **关键约束**：DashScope 异步 API 要的是**可公网访问的 `file_urls`，不接受 base64 内联**。这是与「服务只接字节」的直接冲突。v1 的处理：
> - 若调用方只给字节，DashScope 通道**不可用**，报 `provider-requires-url`（fail-visible，点名原因 + 给出路）。
> - 若调用方额外给 `publicUrl`，则 use it。
> - **同时登记一个独立能力申请：宿主侧「临时对象上传」能力**（把字节 POST 到一个临时可达地址）。在此之前，DashScope 通道对纯字节输入不可用。
>
> 这一条必须在实现前与用户确认（见 §11 未决项 U1）——它可能把「国内厂商」这条腿的可用性打掉。

### 6.3 `channel_remote_openai`（custom，adapter: `openai-compatible`）

与 §6.1 同形状，只是带 `Authorization: Bearer`、无 `X-Speech-Transfer` 头、endpoint 必填。用于接 vLLM / 自建网关 / 任何 OpenAI 兼容云服务。

### 6.4 移动端的 local 语义

- `local.enabled` 默认 `false`，UI 显示「本地识别仅在桌面可用」。
- 高级设置允许把 endpoint 改成局域网 IP；改完后 `enabled` 可打开。
- **移动端没有「桌面式的 127.0.0.1」**，这一点在 UI 文案里必须写清，不做任何隐式假设。

### 6.5 Key 存储的双端差异

| 端 | 存法 | 行为 |
| --- | --- | --- |
| 桌面 | `auth_secret_set("speech.remote.key", v)` | 明文不入插件 KV；`auth_secret_keys` 可枚举 |
| 移动 | `storage.set("speech.remote.key", v)` | **明文落插件私有存储**；UI 必须显示一次性警告弹窗（「移动端无系统级密钥存储，Key 以明文存于应用私有目录，仅本机使用」），用户确认后才写入 |

`settings_get` / `settings_set` 永不回传明文；只回 `hasKey`。

---

## 7. 错误分类（`core/error.rs`）

| kind | 触发 | 是否回退 | 是否可重试 | 用户可见文案要点 |
| --- | --- | --- | --- | --- |
| `connect-refused` | 连接被拒 | ✅ | ✅ | 本地识别服务未启动 |
| `connect-timeout` | 连接超时（≤ `connectTimeoutMs`） | ✅ | ✅ | 本地端点无响应 |
| `dns-failed` | 解析失败 | ✅ | ❌ | 端点地址无效 |
| `gateway-down` | `502/503/504` | ✅ | ✅ | 端点暂不可用 |
| `audio-too-large` | 原始字节 > 8 MiB | ❌ | ❌ | 音频过大，请切片 |
| `audio-invalid` | 容器/采样率/声道不合法 | ❌ | ❌ | 音频格式不支持 |
| `auth-failed` | `401/403` | ❌ | ❌ | Key 无效或无权限 |
| `bad-request` | `400`（非 multipart 提示） | ❌ | ❌ | 请求不被端点接受 |
| `rate-limited` | `429` | ❌ | ✅ | 触发限流 |
| `provider-error` | 其他 `5xx` | ❌ | ✅ | 端点内部错误 |
| `protocol-mismatch` | 响应不是可解析的识别结果 | ❌ | ❌ | 端点协议不兼容 |
| `provider-requires-url` | DashScope 只给字节 | ❌ | ❌ | 该厂商要求可访问 URL |
| `cancelled` | 调用方取消 | ❌ | ❌ | — |
| `internal` | 其他 | ❌ | ❌ | — |

**「是否回退」只有前 4 行是 `true`**——这就是 D7/D13 的全部内容。

---

## 8. 与宿主的边界：音频从哪来

v1 的音频**只能由调用方提供**（`dataBase64`）。现有可用的端到端入口只有设置页的「导入音频文件测试」（走 `fs:pick` + `fs:read` 或前端 `<input type=file>` → 读成字节）。

**宿主音频能力申请（独立、跨仓、不在本服务 v1 内）**：

```wit
// 建议落点为能力仓新增分片，命名待定（host-audio）
interface host-audio {
  list-devices: func() -> result<list<device-info>, string>;
  start-capture: func(config-json: string) -> result<string, string>;   // handle
  stop-capture: func(handle: string) -> result<capture-result, string>; // 16k mono s16le
  cancel-capture: func(handle: string) -> result<bool, string>;
}
```

配套新权限位 `audio:capture`（双端词汇表真源 `wasmnest-wasm-core/src/permission.rs` + `plugin-sdk-mobile/rust/src/permission.rs` 都要加）。宿主侧实现照业界共识：`cpal` 录音 + `rubato` 重采样到 16k mono；**推理不放进宿主进程**（Handy 与 Vibe 都为此做了进程隔离：ggml/C++ 崩溃会带走 App，超时只能 kill 进程）。

本服务的契约不受这条能力影响——因为音频**始终是字节**，来源对服务不透明。

---

## 9. 持久化

**私有库**（`storage` 权限，`host-plugin-database`）：

```sql
CREATE TABLE IF NOT EXISTS transcription_records (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,   -- epoch ms
  job_id        TEXT NOT NULL,
  channel       TEXT NOT NULL,      -- local | remote
  adapter       TEXT NOT NULL,
  vendor        TEXT,               -- dashscope | custom | null(本地)
  fallback_from TEXT,               -- null = 未回退
  fallback_reason TEXT,
  language      TEXT,
  audio_bytes   INTEGER NOT NULL,
  text_chars    INTEGER,            -- 长度，不存文本
  elapsed_ms    INTEGER,
  error_kind    TEXT                -- null = 成功
);
CREATE INDEX IF NOT EXISTS idx_speech_records_created ON transcription_records(created_at DESC);
```

**不存音频、不存文本。** 保留策略：插入时裁掉超过 200 条的旧行（软上限，避免无限增长）。

**设置存储**：`storage` 的 `speech.settings`（JSON）。Key 走 §6.4 的差异路径，**不进这个 blob**。

---

## 10. 实现顺序与验证口径

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| P1 | `rust/core`：`audio` / `base64` / `error` / `route` / `settings` / `segment` | `cargo test -p wasmnest-speech-core`（native，纯函数全覆盖）；`boundary_lock` 静态锁 |
| P2 | `rust/plugin`：api 面 + dispatch/job 表 + 三通道 | `cargo test --manifest-path servers/speech/rust/plugin/Cargo.toml`；**必须补跑 wasm 目标构建**（native 不展开 `#[plugin_api]` 宏） |
| P3 | 双端 `plugin.json` + 构建链（desktop `build.js` / mobile `sharedRustManifest`） | `node scripts/build.js` 出 `.build/plugins/com.wasmnest.speech/`；移动端 `plugin-build.js` 出同名 wasm；**两端 wasm 字节一致**（`sha256` 比对，这是 D1 的机器判据） |
| P4 | 桌面设置面 + 测试面（导入音频） | vitest；E2E 走 `node scripts/e2e.mjs --app speech` |
| P5 | 移动设置面 | vitest |
| P6 | 平台仓五处登记（`release-manifest.json` + `useShellApps.ts` SURFACE_ROUTES + `router/index.ts` + `plugin-build.js` PLUGINS + `hostAppBoundaryLock.test.ts`） | 平台 `pnpm run check:manifest` |

**验证底线**：`cargo test` 通过不算完成，P2 的 wasm 目标构建必须跑过。

---

## 11. 未决项（实现前必须先定的）

**U1（阻塞性）**：DashScope 异步 ASR 只接受公网可达 `file_urls`，不接受 base64 内联。若坚持「服务只接字节」，「国内厂商」这条腿在 v1 就不可用。三个出路：
- (a) 接受 `publicUrl` 参数，字节路径下该通道报 `provider-requires-url`（**当前文档的写法**）
- (b) 改用 DashScope 的**实时 WebSocket**接口（`paraformer-realtime-v2`），它接受 base64 音频帧——但 `host-http` 只有一个 `fetch`，WS 要另走 `ws:client`（桌面 38 条里有 `ws:client`，移动 18 条里也有）。这条路能救回字节输入，代价是引入第二个传输能力。
- (c) 换一家接受 base64 同步上传的国内厂商。

**U2**：移动端 `bus` 权限存在，但跨插件互调在移动宿主上是否与桌面同样可用（`api_call` 的 topic 广播机制）——需在 P2 前实测。若移动端不支持互调，则移动端只能以「自己的设置页 + 命令」形态存在。

**U3**：`mountPreview` 是否必需。平台 `hostAppBoundaryLock.test.ts`（L5）要求六个桌面 entry 导出 `mountPreview`；新 servers 应用是否纳入该锁，需与平台侧确认。

---

## 12. 引用

- 双端单产物先例：`apps/file-transfer/rust/{core,plugin}`、`apps/file-transfer/mobile/package.json`（`wasmnest.sharedRustManifest`）
- 互调 api 面先例：`servers/auth-center/desktop/rust/src/lib.rs:473` + `apps/file-transfer/rust/plugin/src/auth_center.rs:121`
- HTTP 出站真源：`wasmnest-lib/wasmnest-server-http/wit/http.wit`、`src/plugin_binding/egress.rs:316-317`（body 必须是字符串）、`:387`（响应体上限）
- 资源硬顶：`wasmnest-lib/wasmnest-host-kit/src/limits.rs:41,63`
- 密钥存储：桌面 `plugin-sdk-desktop/rust/src/host/auth.rs:31-40`；移动 `plugin-sdk-mobile/rust/src/host/auth.rs:1-14`（非 secret-store）
- 业界分层参照：Handy（cpal + rubato + VAD + worker 子进程 + enigo）、Vibe（Tauri 宿主录音 + `vibe-server` sidecar 暴露 OpenAI 兼容 HTTP）
