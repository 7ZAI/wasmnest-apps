//go:build wasip2

// 宿主适配器（组件目标）——把 sdk.Host* 包装接到 AppHost / HttpFetcher 抽象上，
// 并在 init() 完成 sdk.Entry 一次性接线（等价 Rust `wasm_entry!(AiChatboxPlugin)`）。
package main

import (
	"encoding/json"

	sdk "github.com/7zai/wasmnest-plugin-sdk-go/sdk"
)

// hostEnv 生产宿主面：host-fs / host-config / host-log 经 SDK 惯用包装直通。
type hostEnv struct{}

func (hostEnv) Read(path string) (string, bool, error) { return sdk.HostFSRead(path) }
func (hostEnv) Write(path, data string) error          { return sdk.HostFSWrite(path, data) }
func (hostEnv) Delete(path string) error               { return sdk.HostFSDelete(path) }
func (hostEnv) Exists(path string) (bool, error)       { return sdk.HostFSExists(path) }

func (hostEnv) RequestAuth(paths []string) (bool, error) {
	b, err := json.Marshal(paths)
	if err != nil {
		return false, err
	}
	return sdk.HostFSRequestAuth(string(b))
}

func (hostEnv) ConfigGet(key string) (string, bool, error) { return sdk.HostConfigGet(key) }
func (hostEnv) LogInfo(message string)                     { sdk.HostLogInfo(message) }
func (hostEnv) LogWarn(message string)                     { sdk.HostLogWarn(message) }

// hostHTTP 生产 HTTP 出站面（host-http 经 SDK 惯用包装直通）。
type hostHTTP struct{}

func (hostHTTP) Fetch(request any) (json.RawMessage, bool, error) {
	return sdk.HostHTTPFetch(request)
}

func init() { sdk.Entry(newPlugin(hostEnv{}, hostHTTP{})) }

func main() {
	// 库形态组件：导出全部经 sdk.Entry 在 init() 接线；TinyGo wasip2 默认追加的
	// wasi:cli/run 导出无害（宿主不探测）。
}
