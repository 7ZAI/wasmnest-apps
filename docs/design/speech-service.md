# 语音识别公共服务（speech）——设计与实现口径

> **状态**：v1 已实现（2026-11-17），**仅桌面端**。已通过 core 单测、前端单测与完整构建；真实模型推理、真实麦克风与平台 E2E 尚未验证（见 §11）。
> **定位**：`servers/speech`——服务型 wasm（L2 内部业务），给平台内任何应用提供「音频字节 → 文本」的识别服务。
> **真源**：接口/权限以 `desktop/plugin.json` 与代码为准；本文档记录设计取舍与行为约定。旧版「本地 = 本地 HTTP 端点」的取舍已被 ADR 0010 取代。

---

## 0. 三条边界

1. **服务不提供「远程开麦」**。互调 API 只接收调用方给的音频字节；诊断录音（host-audio → host-stt）只能由服务自己的页面触发，不通过互调暴露。
2. **本地识别 = 宿主 `host-stt` 直接推理**（whisper.cpp / GGML 模型，宿主进程内），**不是**本地 HTTP 端点。只有外部供应商才走 HTTP（`host-http`）。wasm 只做调度：字节校验、通道路由、请求组装、结果归一、任务与记录。
3. **本地失败绝不自动上云**。`auto` 只在请求开始前选一次通道；选中本地后，任何失败都原样上报。静默上传音频是安全红线。

---

## 1. 决策一览

| # | 决策 | 理由摘要 |
| --- | --- | --- |
| D1 | **v1 仅桌面**；保留 `rust/core`（纯逻辑）+ `rust/plugin`（wasm）分层 | 本地推理依赖宿主的 host-stt/host-audio（当前仅桌面接线）；核层纯函数便于跨端复用与单测 |
| D2 | `local` = `host-stt`（whisper.cpp） | wasm 有 64 MiB 线性内存 + 32G 燃料硬顶，跑不动 ASR 模型；宿主进程内推理是产品终态的第一版 |
| D3 | API Key 归服务持有，存宿主 secret-store（`auth` 权限） | 否则「公共服务」退化成公共 HTTP 代理，权限面更大 |
| D4 | 远端 v1 只做 **OpenAI 兼容**（`openai-compatible` / `custom`） | 该形态接受 multipart 上传；DashScope 异步 URL 形态与「只接字节」冲突，挂起（§11） |
| D5 | 输出 **final-only**；分段带 `isFinal=true` | v1 无流式事件面；字段为将来预留 |
| D6 | 优先级 = `mode`（`local-only` / `remote-only` / `auto`），无 `order` | 两条通道的排序在 v1 没有可配置价值；调用方只能覆盖 `mode` |
| D7 | `auto`：本地可用则本地，否则远端已配置则远端，否则显性失败 | 「可用」= 本地启用且模型已安装 / 远端启用且端点与 Key 就绪 |
| D8 | 不缓存可用性；每次请求开始时判定一次 | 避免「刚下载完模型仍走云端」的陈旧状态 |
| D9 | 远端请求在 **调用线程内同步完成**，任务表直接落终态 | v1 无 wasm 侧后台任务通道；调用方需给足互调超时（§7.3） |
| D10 | 音频传输：WIT 不变；远端 multipart 由 wasm 组装后经 `host-http` 的 **`bodyBase64`** 发出 | `body` 只接受字符串；`bodyBase64` 是宿主支持的二进制 JSON 字段，无需改 WIT |
| D11 | 语种 `auto` / 2-3 字母 ISO 码；默认 `auto` | 与 host-stt 的入参一致 |
| D12 | 单次原始音频 ≤ **8 MiB**，超出报 `audio-too-large` | base64 膨胀 + wasm 内存余量 |
| D13 | 识别结果不持久化；只留元数据记录（无音频、无文本），上限 200 条 | 服务不是转写历史库；记录用于排障 |
| D14 | 模型由宿主共享目录管理：固定 catalog（base/small/turbo）、SHA-256 校验、HF 主源 + 可配镜像、首用不自动下载，默认 `small` | 模型是宿主资产；插件只拿模型 id |
| D15 | 诊断录音只允许服务页触发（host-audio，16 kHz 单声道归一） | 不开放「远程触发麦克风」的互调面 |
| D16 | 不做全局快捷键 / 自动粘贴（Handy 式听写产品） | 本服务是「被其他应用调用的识别能力」，不是终端听写产品 |

---

## 2. 目录结构（v1 实际）

```
servers/speech/
├── desktop/
│   ├── plugin.json            id=com.wasmnest.speech, platform=desktop, rustLibrary=wasmnest_plugin_speech
│   ├── package.json           build → scripts/build.js（wasm32-wasip3 + Vite 单文件）
│   ├── scripts/{build.js,dev-host.js}
│   ├── vite.config.ts / vitest.config.ts / tailwind.config.js / postcss.config.js
│   ├── icon.svg
│   └── src/
│       ├── entry.ts           mountApp / mountPreview；mountContract = '1'
│       ├── views/SpeechView.vue        设置 / 模型 / 记录 / 诊断录音
│       ├── preview/PreviewCard.vue
│       ├── composables/useSpeechService.ts
│       ├── composables/settingsForm.ts 设置表单校验（纯函数）
│       ├── i18n/{zh-CN,en,index}.ts
│       └── __tests__/{entry,settingsForm}.test.ts
└── rust/
    ├── core/                  纯逻辑核（serde / serde_json / base64 / thiserror）
    │   └── src/{lib,audio,error,request,route,settings}.rs
    └── plugin/                wasm 插件（SDK wasm feature）
        └── src/{lib,api,commands,host,jobs,records,remote,capture,settings}.rs
```

`rust/core` 的 `audio.rs` 负责：容器白名单（wav/mp3/m4a/webm/ogg/pcm）、8 MiB 上限、base64 编解码、WAV(PCM 16-bit) 解析与裸 PCM 包装、本地 PCM 形状校验（16 kHz / 单声道 / 偶数长度）。
`rust/plugin/src/host.rs` 是 SDK 生成的 `wasmnest::stt::host-stt` / `wasmnest::audio::host-audio` 的窄包装，JSON 形状集中在一处。

---

## 3. `plugin.json` 摘要（desktop）

- 权限：`audio:capture` / `audio:io` / `auth` / `network:http` / `storage` / `stt:infer` / `stt:model`。
- 互调 API（10 条）：`transcribe-submit` / `transcribe-result` / `transcribe-cancel` / `settings-get` / `settings-set` / `models-list` / `models-download` / `models-remove` / `channels-probe` / `records-list`。
- 页面命令（15 条）：上述 10 条的服务内对应命令 + `model-status` / `job-result` / `job-cancel` / `test-submit` / `capture-start|pull|stop|abort` 等（真源 = `plugin.json.contributes.commands`）。
- `type: internal-business`；产物随宿主分发，平台主屏「服务」区可见（路由 `/speech`）。

---

## 4. 互调 API 与页面命令

### 4.1 提交（`transcribe-submit`）

```jsonc
{
  "audio": {
    "container": "wav",        // wav | mp3 | m4a | webm | ogg | pcm
    "sampleRate": 16000,       // 裸 PCM 必填；WAV 由头部提供
    "channels": 1,             // 同上
    "dataBase64": "UklGR..."   // 原始字节
  },
  "language": "auto",          // auto | zh | en（可省）
  "preference": { "mode": "auto" },   // 可选；只能覆盖 mode
  "contextPrompt": null,       // 可选；本地作为 whisper initial prompt，远端作为 prompt
  "callerTag": "bedcode"       // 可选；写入记录便于排障，不参与路由
}
```

返回：

- 本地：`{ "jobId": "sp-<n>", "channel": "local", "state": "running", "modelId": "...", "language": "zh"|null }`——宿主 host-stt 任务已提交，用 `transcribe-result` 轮询。
- 远端：同步完成后直接返回 `state` 为 `completed` / `failed` 的任务视图（见 §4.2）。

### 4.2 查询 / 取消

```jsonc
// transcribe-result
{
  "jobId": "sp-1",
  "state": "running" | "completed" | "failed" | "cancelled",
  "channel": "local" | "remote",
  "modelId": "small",                 // 本地 = catalog id；远端 = 供应商模型名
  "language": "zh" | null,
  "text": "..." | null,               // completed 时给全文
  "segments": [ { "text": "...", "startMs": 0, "endMs": 4200, "isFinal": true } ],
  "error": { "kind": "...", "message": "..." } | null,
  "elapsedMs": 1234,
  "audioBytes": 32000
}
```

- 本地任务的 `transcribe-result` 会同步宿主 `job-status` / `job-result` 后再返回；任务表住 wasm 内存，插件停用即丢（记录另存）。
- `transcribe-cancel` 只对本地在途任务生效（调用 host-stt `job-cancel`）；远端任务提交时已终态，返回 `cancelled: false`。
- 未知 job：`Err("job not found: ...")`。

### 4.3 设置 / 模型 / 记录 / 探测

- `settings-get` 返回 `{ settings, hasKey }`——**永不回传 Key 明文**。
- `settings-set` 接收补丁；`apiKey` 字段缺省 = 不改、空串 = 删除、非空 = 覆盖（只写 secret-store，不进 settings blob）。
- `models-list` 返回 `{ models: [...] }`（宿主 catalog 投影：id / 名称 / 说明 / 语种 / 体积 / installed / downloading / recommended）。
- `models-download` 触发宿主下载并返回当前状态；`models-remove` 删除本地模型（宿主会拒绝在途任务使用的模型）。
- `channels-probe` 只做**就绪判定**（本地：启用且模型已安装；远端：启用、端点非空且 Key 已写），不发真实请求，避免打开页面就触网。
- `records-list` 返回最近记录（默认 50，上限 200）。

---

## 5. 设置模型与通道路由

```jsonc
{
  "mode": "auto",                       // local-only | remote-only | auto
  "local": {
    "enabled": true,
    "modelId": "small",
    "language": "auto"
  },
  "remote": {
    "enabled": false,
    "endpoint": "",                     // 必填：OpenAI 兼容 /v1/audio/transcriptions
    "adapter": "openai-compatible",     // openai-compatible | custom
    "model": "whisper-1"
  }
}
```

路由（`rust/core/src/route.rs`，纯函数）：

```
mode=local-only  → local（即使不可用也选本地：失败在推理入口显性上报）
mode=remote-only → remote
mode=auto        → 本地启用且模型已安装 → local
                   否则远端启用且端点/Key 就绪 → remote
                   否则 no-channel
```

**没有回退链**：`auto` 只在开始时选一次；本地失败（模型缺失、会话失败、推理失败）直接回报给调用方。

---

## 6. 本地通道（host-stt）

- 入口：`host-stt.open-session({modelId, language, prompt})` → `append`（每段 256 KiB）→ `finalize` → 返回宿主 `stt-job-<uuid>`。
- 输入：**16 kHz 单声道 S16LE**；服务页/调用方需先把音频归一。本地只接受 `wav`（16-bit PCM）与裸 `pcm`；mp3/m4a/webm/ogg 报 `audio-unsupported-local`。
- 模型：宿主共享目录中的 catalog 模型（base/small/turbo）；未安装报 `model-not-installed`。
- 任务：宿主后台线程推理；服务任务表保存宿主 job id，`transcribe-result` 时同步状态。取消尽力而为（后端不支持中断时结果丢弃）。
- 身份：host-stt 按插件（`com.wasmnest.speech`）隔离会话/任务；插件停用时宿主回收。

---

## 7. 远端通道（OpenAI 兼容）

### 7.1 请求

- 端点：`settings.remote.endpoint`（http/https，必填）。
- 传输：wasm 内组装 `multipart/form-data`（字段 `model` / 可选 `language` / 可选 `prompt` / 文件 `file`），整体编码为 base64 放入 `host-http` 请求 JSON 的 **`bodyBase64`**；宿主解码为字节后发出。WIT 面不变（ADR 0009 修订）。
- 鉴权：`Authorization: Bearer <secret-store 中的 Key>`。
- 音频：WAV/MP3/M4A/WEBM/OGG 原样上传；裸 PCM 自动包一层 WAV 头再上传。

### 7.2 响应与错误

- 成功（2xx）：JSON 需含 `text` 或 `segments`（兼容 `startMs`/`endMs` 与秒制 `start`/`end`），归一为统一分段。
- `401/403` → `auth-failed`；`429` → `rate-limited`；`408`/`5xx` → `provider-error`；其他非 2xx → `provider-error`；非 JSON 或缺少文本 → `protocol-mismatch`。
- 错误消息只含状态码与响应体前 200 字符（用于排障），不回显音频或 Key。

### 7.3 同步执行的约束

远端任务在调用线程内完成，调用方经互调（`host-api-call`）等待时需自行给足 `timeout_ms`；v1 不提供远端异步任务/事件。长音频（接近 8 MiB）在慢供应商上可能超出调用方超时——这是已知限制，**不要**把它伪装成异步（见 §11）。

---

## 8. 音频来源

1. **调用方字节**（互调 API 的唯一入口）：容器 + 采样率 + 声道 + base64 数据。
2. **诊断录音**（仅服务页）：`host-audio` 打开默认输入设备 → 宿主归一为 16 kHz 单声道 S16LE → 环形缓冲按游标拉取 → 追加到 host-stt 会话 → `capture-stop` 时排空并提交本地任务。录音状态住 wasm 内存，服务页关闭/插件停用即回收。
3. 音频采集不进互调 API：其他应用不能远程触发本服务开麦。

---

## 9. 错误分类

| kind | 触发 | 来源 |
| --- | --- | --- |
| `audio-too-large` | 原始字节 > 8 MiB | core |
| `audio-invalid` | 容器非法 / base64 非法 / WAV 非 16-bit PCM / PCM 形状不合法 | core |
| `audio-unsupported-local` | 本地通道收到 mp3/m4a/webm/ogg | core |
| `no-channel` | `auto` 下两条通道都未就绪 | core |
| `invalid-settings` | 语种非法 / 远端启用但端点/模型/适配器缺失 | core |
| `provider-not-configured` | 远端禁用 / 端点空 / Key 未设置 | plugin |
| `auth-failed` / `rate-limited` / `provider-error` / `protocol-mismatch` / `network` | 远端 HTTP 与响应归一 | plugin |
| `model-not-installed` | 本地模型未下载 | plugin（转发 host-stt） |
| `local-session` / `local-append` / `local-finalize` | host-stt 会话原语失败（原样带宿主原因） | plugin |
| `capture-already-running` / `capture-not-running` | 诊断录音状态错配 | plugin |
| `internal` | 其他 | core / plugin |

前端把 `kind` 映射到 `speech.errors.<kind>` 的 i18n 文案；宿主日志只落结构化摘要，不落音频/文本。

---

## 10. 持久化

- **设置**：`storage` 键 `speech.settings`（JSON）。
- **Key**：桌面 secret-store（`speech.remote.key`），不进 settings blob、不进日志。
- **记录**：`storage` 键 `speech.records`（JSON 数组），上限 200 条，FIFO 裁剪；字段 = 任务 id / 时间 / 通道 / 模型 / 语种 / 音频字节 / 文本字符数 / 耗时 / 错误 kind / callerTag。**不存音频、不存文本**。
- 任务表住 wasm 内存，不持久化。

---

## 11. 状态与未完成项

已完成：

- lib：`wasmnest-stt-engine`（host-stt 14 原语、模型目录 / 会话 / 异步任务 / whisper 后端 / 下载导入）、`host-http` 的 `bodyBase64`、权限词汇 `stt:infer` / `stt:model`。
- platform：SDK WIT 组合（audio/stt）、宿主 `host-audio`（cpal）与 `host-stt`（whisper.cpp）适配器、应用登记（路由 / 构建 / 清单）、权限词汇生成（45 条）。
- apps：服务实现（core 22 测试 + 前端 6 测试）、完整构建产物、发布 zip 打包。

未完成 / 待验证：

1. **真实推理**：whisper 后端只编译通过；没有下载 small 模型跑过真实音频。MockBackend 单测覆盖的是引擎编排，不是识别质量。
2. **真实麦克风 / 宿主目验 / E2E**：cpal 与 host-audio 只在编译面通过；服务页、权限提示、录音指示、模型下载进度需在真实宿主目验。
3. **远端异步**：`transcribe-submit` 远端正向同步执行；长音频/慢供应商需调用方加大互调超时（§7.3）。异步 job 未实现。
4. **模型本地导入 UI**：引擎与宿主端口（`stt:model` + `fs` 授权链）已就绪，但页面没有二进制选择/读取面（宿主 `host-fs` 只有文本 `read`，没有 `read-bytes`）；不要假装可导入。
5. **移动端**：v1 不交付；lib 引擎保留后端抽象，移动宿主未接 audio/stt。
6. **DashScope**：异步 ASR 只接受公网可达 URL，与「只接字节」冲突，v1 挂起；远端只支持 OpenAI 兼容。
7. **发布**：lib 新 crate 未打 tag；平台宿主 `Cargo.toml` 当前依赖 git tag `lib-v0.0.1`，需合并 lib 后打新 tag 并更新 `release-manifest.json` 的 `repos.lib.tag` / `repos.apps.tag`（发布动作）。

---

## 12. 引用

- host-stt 契约：`wasmnest-lib/wasmnest-stt-engine/wit/stt.wit`；宿主适配器：`wasmnest-desktop/src-tauri/src/plugin/stt.rs`。
- host-audio 契约与适配器：`wasmnest-audio-engine/wit/audio.wit`、`wasmnest-desktop/src-tauri/src/plugin/audio.rs`。
- `host-http` 二进制体：`wasmnest-server-http/src/plugin_binding/egress.rs`（`bodyBase64`）。
- 平台应用登记：`useShellApps.ts` / `router/index.ts` / `plugin-build.js` / `plugin-precheck.mjs` / `release-manifest.json`。
- 相关 ADR：0007（旧本地通道，已被取代）、0008（移动端 Key，v1 不适用）、0009（base64 传输，已修订）、0010（host-stt 本地通道）。