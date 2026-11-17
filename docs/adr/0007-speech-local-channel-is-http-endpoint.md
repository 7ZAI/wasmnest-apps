# （已取代）语音识别的「本地」通道是自建 HTTP 端点，不是 wasm 内推理

**状态**：superseded by [ADR 0010](0010-speech-local-channel-is-host-stt.md)（2026-11-17）

## 原决定（2026-11-07）

`servers/speech` 的 `local` 通道采用「用户自建的本机 / 局域网 HTTP 端点」，协议为 OpenAI 兼容的 `/v1/audio/transcriptions`，音频以 base64-in-JSON 承载（见 ADR 0009）。理由是当时宿主没有任何音频采集与本地推理能力：

- wasm 插件有 128 MiB 线性内存 + 64G 燃料硬顶，跑不动 whisper / sherpa 模型；
- wasm `cdylib` 无法链接 native 库；
- 宿主内推理被推迟为独立跨仓工程。

## 为什么被取代

平台侧随后落地了 `host-audio` 与 `host-stt` 两个能力域：宿主负责麦克风采集与 whisper.cpp 推理，wasm 只做调度（会话 / 异步任务 / 模型目录）。这使「本地识别」不再需要用户自装 HTTP 服务，也消除了原方案的三条负面：

1. 不是真正的离线识别（用户需自装 sidecar）；
2. 端点协议互操作损失（多数本地服务只认 multipart）；
3. 移动端 `127.0.0.1` 语义不可用。

原 ADR 的「本地 HTTP 端点」形态在 v1 已不再存在；外部供应商仍走 `host-http`，但那是 `remote` 通道，不再承担「本地识别」。新决定、权限与失败语义见 ADR 0010。