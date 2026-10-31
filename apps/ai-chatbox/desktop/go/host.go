// 宿主能力抽象（可移植面）——Rust 版 `H: HostFs + HostLog` 泛型约束与
// `HostHttp` trait 的 Go 对等物。生产实现（host_wasip2.go）把 sdk.Host* 包装
// 接进来；原生单测注入真实文件系统直连的 testHost（与 Rust 版 TestHost 同形，
// 见 store_test.go）。抽象只收本插件实际消费的面，不为未来需求预制。
package main

import "encoding/json"

// FsHost 是 host-fs 六原语里本插件用到的子集（Rust HostFs 对应面）。
// 语义与宿主契约一致：Read 文件不存在 → ("", false, nil)；Delete 幂等。
type FsHost interface {
	Read(path string) (string, bool, error)
	Write(path, data string) error
	Delete(path string) error
	Exists(path string) (bool, error)
	RequestAuth(paths []string) (bool, error)
}

// AppHost 是插件运行期消费的宿主面：文件 + 配置 + 日志（Rust `WasmHost`
// 的子集）。日志纪律与 Rust 版一致：可处理错误用 Warn 不用 Error（AGENTS §8）。
type AppHost interface {
	FsHost
	ConfigGet(key string) (string, bool, error)
	LogInfo(message string)
	LogWarn(message string)
}

// HttpFetcher 是 HTTP 出站代理（Rust HostHttp::http_fetch 对应面）。
// 返回解包约定见 sdk.HostHTTPFetch：ok=false 且 err=nil = 宿主空结果。
type HttpFetcher interface {
	Fetch(request any) (json.RawMessage, bool, error)
}
