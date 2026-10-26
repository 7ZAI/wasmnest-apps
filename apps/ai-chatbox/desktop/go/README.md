# ai-chatbox Go 版后端（TinyGo wasip2 组件）

Rust 版 `../rust/` 的对等移植（issue #21 Solution 5 试点：前端零改动、命令契约不变）。
布局与工具链的完整说明见 SDK 壳 `go/README.md`（平台仓
`packages/plugin-sdk-desktop/go/`），本文件只记工程特有约定。

## 文件布局

| 路径 | 内容 | 归属 |
| --- | --- | --- |
| `host.go` / `store.go` / `client.go` / `commands.go` / `main.go` | 可移植面（无 build tag）：宿主抽象 / JSONL 存储 / HTTP 透传 / 命令处理 / 插件接线——原生 `go test` 可测 | 手写真源 |
| `host_wasip2.go` | 组件目标（`//go:build wasip2`）：宿主适配器 + `init()` 接 `sdk.Entry` | 手写真源 |
| `store_test.go` / `client_test.go` | 原生单测（TestHost 直连真实文件系统临时目录；命令契约与错误前缀断言） | 手写真源 |
| `plugin.json` | 清单嵌入副本（`go:embed` 不能上溯目录） | **构建期生成，不入库** |

## 构建与测试

```bash
# 产物构建（清单副本同步 + TinyGo 组件化，由应用 build.js 驱动）：
#   cd .. && node scripts/build.js --go-only
# 组件目标文件用 wasip2 后缀而非 _wasm（GOARCH 隐式约束，见 SDK go/README.md）。

# 原生单测（清单副本缺失时 embed 编译失败——先跑一次上面的构建）
go test ./...

# 类型检查（原生目标不可链接 wasmimport；-tags wasip2 只做类型检查）
go vet -tags wasip2 ./...
```

## 与 Rust 版的对齐口径

- 命令 id / JSON 载荷 / 应答形状逐字一致（`plugin.json` 的 8 条命令）；
- 数据布局逐字一致：`conversations/{convId}.jsonl`（首行 meta + 逐行消息）、
  `index.jsonl`（updatedAt DESC）、`providers.json`（占位）；
- 文件访问全走宿主 host-fs 原语（WASI 预打开面不覆盖宿主绝对路径，且路径
  授权集中在 activate 的 `fs_request_auth`）——与 Rust 版同一条 IO 路径；
- 错误文案对齐（前端把 `{"error": …}` 的串直接透出）；client 层 mismatch 错误
  归一为单 `chat_stream:` 前缀（Rust 版 commands 层再包一层产出双前缀，属
  诊断信息非载荷契约，Go 版不复制该瑕疵）；
- HTTP 透传语义：请求校验（method / url / streamEvent 精确匹配）在触网前完成；
  应答原样透传（`json.RawMessage` 保宿主字节，SSE 解析在前端适配层）。

## 依赖

- SDK 壳：`replace` 指回平台仓源码（首期不发布；路径 = R1 兄弟布局 5 级上溯，
  与 npm 侧 `file:` 依赖同一形态）。平台仓需在含 `plugin-sdk-desktop/go/` 的
  分支检出（`feat/go-backend-support`）。
- 工具链钉版（PATH）：Go 1.27.3 / TinyGo 0.43.0 / wasm-tools 1.240.0
  （TinyGo 组件化外部依赖，缺失报 `component embed failed`）。
