# 语音识别的「本地」通道是自建 HTTP 端点，不是 wasm 内推理

**状态**：accepted（2026-11-07）

## 背景与问题

`servers/speech` 要提供两种识别方式：本地识别与云厂商 API。直觉上的「本地识别」是「模型跑在本机、不上传音频」，实现位置有三个候选：wasm 插件内、宿主进程内、本机独立进程。

约束是硬的：

- wasm 插件的单实例上限是 **128 MiB 线性内存 + 64G 燃料**（`wasmnest-lib/wasmnest-host-kit/src/limits.rs:41,63`，注释明确写「需要更大工作集应改成分片处理，而不是抬高硬顶」）。whisper.cpp 的 tiny 模型常驻约 273 MB、small 约 852 MB；sherpa-onnx 的 SenseVoice int8 最小也要 130-155 MB。**都超过硬顶**。
- wasm 插件 `crate-type = ["cdylib"]`，无法链接 native 静态库（`docs/BACKEND.md`），`whisper-rs` / `sherpa-onnx` / `cpal` 都进不来。

## 决定

**`local` 通道 = 用户自建的本地 HTTP 端点**，服务只做 HTTP 客户端；协议为 OpenAI 兼容的 `/v1/audio/transcriptions` 形状（以 base64-in-JSON 承载音频，见 ADR-0009）。

三种「本地」候选的处置：

| 候选 | 结论 |
| --- | --- |
| wasm 插件内跑模型 | **否决**（内存硬顶 + 无法链接 native） |
| 宿主进程内跑模型 | **推迟**，登记为独立跨仓工程。业界（Handy / Vibe）都在宿主进程外另起 sidecar 或 worker 子进程，理由是 ggml/C++ 崩溃会带走整个 App、超时只能 kill 进程而非线程 |
| 本机独立 HTTP 服务 | **采用** |

## 后果

**正面**：不跨仓、不改权限词汇、双端一致（同一个 wasm 只需要一个 `http_fetch`）。

**负面（必须承认）**：

1. **这不是「离线识别」**。「本地」只是「识别发生在用户自己的机器上」，用户仍需自行安装并启动识别服务。UI 文案与产品说明不能含糊。
2. **移动端这条通道事实上不可用**。手机上的 `127.0.0.1` 是手机自己，跑不了 whisper。移动端 `local.enabled` 默认 `false`，允许用户改局域网地址，但不做任何「移动端也有本地识别」的暗示。
3. 用户需自备模型与启动方式。v1 不分发 sidecar 与模型（模型下载/校验/多平台矩阵是独立工程）。

## 替代方案

- **wasm 内推理**：被 128 MiB 硬顶否决，不是工程量问题，是物理不可能。
- **宿主内推理 + 随包分发模型**：可行且是产品终态，但需要 supervisor、GPU/CPU 降级、模型完整性校验（magic + sha256 + 原子 rename），工作面远大于本服务本身。
- **只做云端**：砍掉「两种方式」的需求本身。
