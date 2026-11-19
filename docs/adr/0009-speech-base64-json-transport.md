# 音频以 base64-in-JSON 传输，不用 multipart

**状态**：accepted（2026-11-07）；**已修订（2026-11-17）**——远端请求改为 multipart 经 `bodyBase64` 发出，本地通道不再走 HTTP。见文末「修订」。

> 以下为 2026-11-07 原始决策，保留作历史背景。

## 背景与问题

语音识别的行业标准请求形态是 `multipart/form-data`（OpenAI `/v1/audio/transcriptions`、faster-whisper-server、whisper.cpp server 的兼容层都认这个）。直觉上应该直接照抄。

但 WasmNest 的 HTTP 出站能力只暴露一个函数：

```wit
// wasmnest-lib/wasmnest-server-http/wit/http.wit
fetch: func(request-json: string) -> result<option<string>, string>;
```

宿主的绑定层（`src/plugin_binding/egress.rs:316-317`）只认 `method / url / headers / body`，且 `body` 必须是**字符串**：

```rust
let body = request.get("body").and_then(|v| v.as_str());
```

随后按 UTF-8 转字节（`body.as_bytes().to_vec()`，`:354`）、`req_builder.body(b)`（`:357`）。**没有任何二进制字段，也没有 multipart 分块支持。** 另外响应体有 `PLUGIN_HTTP_RESPONSE_BODY_LIMIT_BYTES` 上限（`:387`），超大响应必须走 `stream: true`。

## 决定

音频以 **base64 字符串字段**放入 JSON body，请求头带 `X-Speech-Transfer: json-base64` 自描述。两种变体：

```jsonc
// 变体 A（默认）
{ "model": "whisper-1", "language": "zh",
  "file": { "name": "audio.wav", "content_base64": "UklGR..." } }

// 变体 B（端点要求 OpenAI 原字段名时）
{ "model": "whisper-1", "language": "zh",
  "file": { "name": "audio.wav", "content_base64": "UklGR...", "encoding": "raw-base64-field" } }
```

响应仍按 OpenAI 形状解析（`{"text": ...}`）或 `{"segments": [...]}`。`400` 且 body 提示 multipart 时，**只重试一次**变体 B，仍失败报 `protocol-mismatch`。

## 后果

**正面**：零宿主改动即可发出带音频的请求；URL / headers / body 全在插件侧可编排，调试时 `curl` 也能复现。

**负面**：

1. **体积膨胀 33%**。因此单次音频的**原始字节上限设为 8 MiB**（约 4 分钟 16kHz 单声道 WAV），超出报 `audio-too-large` 并要求调用方切片。这是 128 MiB 线性内存硬顶下的必要约束，不是保守。
2. **并非所有本地服务都接受这种变体**。faster-whisper-server 与 whisper.cpp 的 OpenAI 兼容层通常只认 multipart。这是一个真实的互操作损失：用户可能需要一个薄适配层，或等待宿主补二进制 body。
3. 长音频必须切片，服务不做自动 VAD 切分（需要 VAD 模型，属独立课题）。

## 替代方案

- **让宿主支持二进制 body**：正确但属跨仓改动（能力仓 WIT + 双端宿主 + SDK）。**应当做**，登记为跨仓申请；本 ADR 是「在它落地前的做法」，落地后可平滑切换（响应形状不变，只换传输）。
- **用 `ws:client` 发二进制帧**：能绕开字符串约束，但引入第二条传输能力、失去 HTTP 的通用性，且要求端点支持 WS。否决。
- **让调用方上传到公网再传 URL**：把「服务只接字节」这条边界打掉，且对隐私不利。否决（但 DashScope 的异步 API 正是这个约束，见设计文档 U1）。

---

## 修订（2026-11-17）

`host-http` 的请求体已支持二进制：请求 JSON 可带 **`bodyBase64`** 字段（与文本 `body` 二选一，同时出现显性报错），宿主解码为字节后发送；WIT 面不变。据此：

1. **远端通道**改为在 wasm 内组装标准 `multipart/form-data`（`model` / `language` / `prompt` / `file`），整体 base64 放入 `bodyBase64`。OpenAI 兼容端点现在按原生 multipart 接收，不再需要 `X-Speech-Transfer: json-base64` 或变体重试。
2. **本地通道不再走 HTTP**：本地识别已改为宿主 `host-stt` 直接推理（ADR 0010），原「变体 A / 变体 B」只保留历史意义。
3. 8 MiB 原始音频上限仍成立（base64 膨胀 + wasm 内存余量）；响应体上限与错误分流不变。

本 ADR 的原始决定（base64-in-JSON 而非 multipart）在其时效内是「宿主不支持二进制 body」的务实取舍；该前置条件已消失，故修订。
