// client 可移植面单测（原生 go test）——Rust 版 client.rs tests 的对等移植：
// 校验与流事件匹配不触网即可断言（fetcher 注入错误桩）；命令层错误前缀一并钉住。
package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// errFetcher 恒错桩：Fetch 不触网，直接返回给定错误（或空结果态）。
type errFetcher struct{ err error }

func (f errFetcher) Fetch(any) (json.RawMessage, bool, error) {
	return nil, false, f.err
}

func TestValidateRequestRequiresMethodAndURL(t *testing.T) {
	if err := validateRequest(map[string]any{}, false); err == nil {
		t.Fatal("缺 method 必须报错")
	}
	if err := validateRequest(map[string]any{"url": "https://a.com"}, false); err == nil {
		t.Fatal("缺 method 必须报错")
	}
	if err := validateRequest(map[string]any{"method": "GET"}, false); err == nil {
		t.Fatal("缺 url 必须报错")
	}
	ok := map[string]any{"method": "GET", "url": "https://a.com/models"}
	if err := validateRequest(ok, false); err != nil {
		t.Fatalf("method+url 齐备应通过: %v", err)
	}
}

func TestValidateRequestStreamRequiresStreamEvent(t *testing.T) {
	if err := validateRequest(map[string]any{"method": "POST", "url": "https://a.com"}, true); err == nil {
		t.Fatal("流式请求缺 streamEvent 必须报错")
	}
	stream := map[string]any{
		"method":      "POST",
		"url":         "https://a.com/chat/completions",
		"streamEvent": "ai-chatbox:stream:s1",
	}
	if err := validateRequest(stream, true); err != nil {
		t.Fatalf("streamEvent 齐备应通过: %v", err)
	}
}

func TestChatStreamRejectsMismatchedStreamEvent(t *testing.T) {
	// 校验在 http_fetch 之前完成，不触网即可断言错误路径
	request := map[string]any{
		"method":      "POST",
		"url":         "https://a.com/chat/completions",
		"streamEvent": "ai-chatbox:stream:other",
	}
	_, err := chatStreamFetch(errFetcher{errors.New("must not be called")}, "s1", request)
	if err == nil || !strings.Contains(err.Error(), "streamEvent mismatch") {
		t.Fatalf("错误应点名 mismatch，实际: %v", err)
	}
}

func TestChatStreamRejectsSuffixCollision(t *testing.T) {
	// 后缀匹配会误放行 `ai-chatbox:stream:xs1` 与 `s1`（前缀不同），精确匹配必须拒绝
	request := map[string]any{
		"method":      "POST",
		"url":         "https://a.com/chat/completions",
		"streamEvent": "ai-chatbox:stream:xs1",
	}
	_, err := chatStreamFetch(errFetcher{errors.New("must not be called")}, "s1", request)
	if err == nil || !strings.Contains(err.Error(), "streamEvent mismatch") {
		t.Fatalf("后缀碰撞应被拒绝并点名 mismatch，实际: %v", err)
	}
}

// echoFetcher 载荷回显桩：请求原样序列化返回（透传语义的最小桩）。
type echoFetcher struct{}

func (echoFetcher) Fetch(request any) (json.RawMessage, bool, error) {
	b, err := json.Marshal(request)
	if err != nil {
		return nil, false, err
	}
	return b, true, nil
}

func TestChatStreamPassesThroughRequest(t *testing.T) {
	request := map[string]any{
		"method":      "POST",
		"url":         "https://a.com/chat/completions",
		"streamEvent": "ai-chatbox:stream:s1",
		"body":        `{"model":"deepseek-chat"}`,
	}
	res, err := chatStreamFetch(echoFetcher{}, "s1", request)
	if err != nil {
		t.Fatalf("透传不应报错: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(res, &got); err != nil {
		t.Fatalf("结果应为请求对象原样: %v", err)
	}
	if got["url"] != "https://a.com/chat/completions" {
		t.Fatalf("载荷应原样透传，实际: %s", res)
	}
}

// ==================== 命令层（plugin 方法 + 错误前缀契约） ====================

// stubHost 可编程宿主桩：home 可指定（activate 流程断言），授权申请记录；
// 文件面复用 testHost（真实临时目录直连）。
type stubHost struct {
	testHost
	home          string
	authRequested bool
}

func (s *stubHost) ConfigGet(string) (string, bool, error) { return s.home, true, nil }
func (s *stubHost) RequestAuth([]string) (bool, error) {
	s.authRequested = true
	return true, nil
}

func TestPluginActivateFailsWithoutHomeDir(t *testing.T) {
	h, _ := newTestHost(t)
	p := newPlugin(h, echoFetcher{})
	err := p.Activate()
	if err == nil {
		t.Fatal("home_dir 缺失必须激活失败（fail-visible）")
	}
	if !strings.Contains(err.Error(), "home_dir config unavailable") {
		t.Fatalf("错误应点名 home_dir 缺失，实际: %v", err)
	}
}

func TestPluginActivateRequestsAuthAndCachesDataRoot(t *testing.T) {
	// 数据面 testHost 的 RequestAuth 恒 true、ConfigGet 恒 miss —— 这里用可编程桩
	dir := t.TempDir()
	stub := &stubHost{testHost: testHost{}, home: dir}
	p := newPlugin(stub, echoFetcher{})
	if err := p.Activate(); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if !stub.authRequested {
		t.Fatal("activate 必须申请目录授权")
	}
	if p.dataRoot != dir+"/.wasmnest/ai-chatbox" {
		t.Fatalf("dataRoot 应缓存为 {home}/.wasmnest/ai-chatbox，实际: %s", p.dataRoot)
	}
	// 命令面读缓存可用：list-conversations 走缓存路径（不报未激活错）
	if _, err := p.InvokeCommand("ai-chatbox.list-conversations", json.RawMessage(`{}`)); err != nil {
		t.Fatalf("激活后 list-conversations 应可用: %v", err)
	}
}

func TestPluginCommandsFailBeforeActivate(t *testing.T) {
	h, _ := newTestHost(t)
	p := newPlugin(h, echoFetcher{})
	// 防御性 fail-visible：未激活时命令显性报错，不静默返回空
	_, err := p.InvokeCommand("ai-chatbox.list-conversations", json.RawMessage(`{}`))
	if err == nil || !strings.Contains(err.Error(), "plugin not activated") {
		t.Fatalf("未激活应显性报错，实际: %v", err)
	}
}

func TestPluginUnknownCommandFailsVisibly(t *testing.T) {
	h, _ := newTestHost(t)
	p := newPlugin(h, echoFetcher{})
	_, err := p.InvokeCommand("ai-chatbox.nope", json.RawMessage(`{}`))
	if err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("未知命令必须显性报错，实际: %v", err)
	}
}

func TestPluginSaveMessageCommandRoundTrip(t *testing.T) {
	dir := t.TempDir()
	stub := &stubHost{testHost: testHost{}, home: dir}
	p := newPlugin(stub, echoFetcher{})
	if err := p.Activate(); err != nil {
		t.Fatalf("activate: %v", err)
	}
	conv := `{"conversation":{"id":"c1","title":"t","createdAt":"a","updatedAt":"u","providerId":"p","providerName":"n","model":"m"}}`
	if _, err := p.InvokeCommand("ai-chatbox.save-conversation", json.RawMessage(conv)); err != nil {
		t.Fatalf("save-conversation: %v", err)
	}
	payload := `{"conversationId":"c1","role":"user","content":"你好","timestamp":"ts","reasoning":"思考"}`
	if _, err := p.InvokeCommand("ai-chatbox.save-message", json.RawMessage(payload)); err != nil {
		t.Fatalf("save-message: %v", err)
	}
	raw, err := p.InvokeCommand("ai-chatbox.get-messages", json.RawMessage(`{"conversationId":"c1"}`))
	if err != nil {
		t.Fatalf("get-messages: %v", err)
	}
	b, _ := json.Marshal(raw)
	var got struct {
		Messages []ChatMessageRecord `json:"messages"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("应答应为 {messages:[…]}: %v → %s", err, b)
	}
	if len(got.Messages) != 1 || got.Messages[0].Content != "你好" || got.Messages[0].Reasoning == nil || *got.Messages[0].Reasoning != "思考" {
		t.Fatalf("消息往返应保真: %s", b)
	}
}

func TestPluginChatStreamCommandPrefixAndMismatch(t *testing.T) {
	h, _ := newTestHost(t)
	p := newPlugin(h, echoFetcher{})
	// mismatch 校验在 fetch 之前完成，不触网
	payload := `{"streamId":"s1","request":{"method":"POST","url":"https://a.com","streamEvent":"ai-chatbox:stream:other"}}`
	_, err := p.InvokeCommand("ai-chatbox.chat-stream", json.RawMessage(payload))
	if err == nil || !strings.Contains(err.Error(), "chat_stream: streamEvent mismatch") {
		t.Fatalf("命令层错误应带 chat_stream 前缀并点名 mismatch，实际: %v", err)
	}
}
