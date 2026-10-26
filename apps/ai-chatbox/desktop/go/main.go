// AI Chatbox Plugin（Go 版后端，TinyGo wasip2 组件）——Rust 版 lib.rs 的对等移植
// （issue #21 Solution 5 试点：前端零改动、命令契约不变）。
//
// 纯 AI 对话插件：JSONL 对话日志落盘 + 多方言供应商协议（请求构建与 SSE 解析
// 在前端适配层 src/adapters/，后端仅透传 http_fetch 载荷）。
//
// 数据根 = `{HomeDir}/.wasmnest/ai-chatbox`；激活时经 fs_request_auth 集中申请
// 一次目录授权（同意后宿主持久化记住，后续逐调用免弹窗），拒绝/超时 → 激活失败
// （Error 状态），重新启用可重试。
//
// 文件布局纪律（与 SDK 壳同构）：
//   - 可移植（无 build tag）：本文件、host.go、store.go、client.go、commands.go
//     —— 纯 Go 逻辑，原生 `go test` 可测；
//   - 组件目标（//go:build wasip2）：host_wasip2.go——宿主适配器 + init() 接线，
//     仅 TinyGo 构建参与编译。
package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	sdk "github.com/7zai/wasmnest-plugin-sdk-go/sdk"
)

//go:embed plugin.json
var pluginManifest string

// plugin 是 Rust 版 AiChatboxPlugin 的对等物：数据根在 Activate 解析一次，
// 命令面读缓存；宿主能力经 AppHost / HttpFetcher 抽象注入（生产实现
// host_wasip2.go，原生测试注入真实文件系统直连的 testHost）。
type plugin struct {
	host AppHost
	http HttpFetcher

	commands sdk.CommandTable

	// 数据根（单一事实来源：路径只在 activate 里算一次；命令面读缓存，
	// 未激活时显性报错——宿主只在激活成功后才派发插件命令，该分支属防御性
	// fail-visible）。activate 幂等重入保留首次值（与 Rust OnceLock 同语义）。
	dataRoot string
}

func newPlugin(host AppHost, http HttpFetcher) *plugin {
	p := &plugin{host: host, http: http}
	p.commands = p.commandTable()
	return p
}

// Manifest 返回插件清单（构建期由 build.js 从工程根 plugin.json 同步而来，
// 见 go/README.md——go:embed 不能上溯目录，副本以构建步骤保证与源一致）。
func (p *plugin) Manifest() string { return pluginManifest }

func (p *plugin) Activate() error {
	// 数据目录固定：{HomeDir}/.wasmnest/ai-chatbox/
	home, ok, err := p.host.ConfigGet("home_dir")
	if err != nil {
		return err // 对齐 Rust `?` 透传（不加前缀）
	}
	if !ok {
		return errors.New("activate: home_dir config unavailable")
	}
	dataDir := strings.TrimRight(home, "/\\") + "/.wasmnest/ai-chatbox"

	// 集中目录授权（host-fs 三层校验的「记住」层）：同意一次 → 宿主持久化，
	// 后续逐调用免弹窗；拒绝/超时 → 激活失败，重新启用可再次弹窗
	allowed, err := p.host.RequestAuth([]string{dataDir})
	if err != nil {
		return fmt.Errorf("activate: fs_request_auth failed: %v", err)
	}
	if !allowed {
		return fmt.Errorf("目录授权被拒绝：%s，请在插件设置中重新启用以再次授权", dataDir)
	}

	if err := Init(p.host, dataDir); err != nil {
		return err
	}
	// 重复 set 只可能是同值重入，幂等，保留首次值
	if p.dataRoot == "" {
		p.dataRoot = dataDir
	}

	p.host.LogInfo("Plugin activated (wasm, host-fs access)")
	return nil
}

func (p *plugin) Deactivate() error {
	p.host.LogInfo("Plugin deactivated (wasm)")
	return nil
}

// InvokeCommand 命令分发（未知命令显性报错由 sdk.CommandTable 纪律保证）。
func (p *plugin) InvokeCommand(name string, args json.RawMessage) (any, error) {
	return p.commands.Invoke(name, args)
}

// commandTable 命令分发表（命令 id + JSON 载荷契约与 Rust 版逐字一致）。
func (p *plugin) commandTable() sdk.CommandTable {
	return sdk.CommandTable{
		"ai-chatbox.chat-stream":         p.chatStream,
		"ai-chatbox.chat-complete":       p.chatComplete,
		"ai-chatbox.fetch-models":        p.fetchModelsCmd,
		"ai-chatbox.list-conversations":  p.listConversations,
		"ai-chatbox.get-messages":        p.getMessages,
		"ai-chatbox.save-conversation":   p.saveConversation,
		"ai-chatbox.save-message":        p.saveMessage,
		"ai-chatbox.delete-conversation": p.deleteConversation,
	}
}
