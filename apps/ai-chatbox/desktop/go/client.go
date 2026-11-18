// 薄透传 HTTP 客户端——Rust 版 client.rs 的 Go 对等移植。
//
// 协议请求构建已全部前移到前端 TS 适配层（ADR-0010）：供应商差异
// （OpenAI / Anthropic / Gemini 请求形状、SSE 解析）收敛在插件 `src/adapters/`，
// 本模块不再持有任何方言知识，只对前端传来的 http_fetch 载荷做最小校验后
// 透传宿主；流式统一走 raw 模式（`sseFormat` 为空），SSE 语义由前端解析。
//
// 命令层（commands.go）统一为这里的错误再包一层 `<命令名>: ` 前缀；本层错误
// 不自带前缀（Rust 版 client 层的 mismatch 错误带前缀、经 commands 又包一层
// 产出双前缀，Go 版归一为单前缀——错误串是诊断信息，不是载荷契约）。
package main

import (
	"encoding/json"
	"fmt"
)

// validateRequest 校验 http_fetch 载荷（url / method 齐备；流式请求另要求 streamEvent）。
//
// expectStream 为 true 时要求 `streamEvent`（流事件通道），
// 非流式请求（chat-complete / fetch-models）不要求。
func validateRequest(request map[string]any, expectStream bool) error {
	method, _ := request["method"].(string)
	if method == "" {
		return fmt.Errorf("http request missing method")
	}
	url, _ := request["url"].(string)
	if url == "" {
		return fmt.Errorf("http request missing url")
	}
	if expectStream {
		streamEvent, _ := request["streamEvent"].(string)
		if streamEvent == "" {
			return fmt.Errorf("http stream request missing streamEvent")
		}
	}
	return nil
}

// chatStreamFetch 流式对话：透传前端构建的 raw 模式请求，返回宿主结果（{ streamId, streamEvent }）。
//
// 前端监听 `ai-chatbox:stream:{stream_id}` 接收逐 chunk 原始字节并自解析 SSE。
func chatStreamFetch(h HttpFetcher, streamID string, request map[string]any) (json.RawMessage, error) {
	if err := validateRequest(request, true); err != nil {
		return nil, err
	}
	// 流事件通道必须与命令声明的 streamId 一致（前端监听同名事件，不一致则消息丢失）；
	// 精确匹配而非后缀匹配——后缀会误放行 `ai-chatbox:stream:xs1` 与 `s1` 这类不相关组合
	expected := fmt.Sprintf("ai-chatbox:stream:%s", streamID)
	streamEvent, _ := request["streamEvent"].(string)
	if streamEvent != expected {
		return nil, fmt.Errorf("streamEvent mismatch: %s vs %s", streamEvent, expected)
	}

	res, ok, err := h.Fetch(request)
	if err != nil {
		return nil, fmt.Errorf("http_fetch failed for streaming request: %v", err)
	}
	if !ok {
		return nil, fmt.Errorf("http_fetch returned empty result")
	}
	return res, nil
}

// chatCompleteFetch 非流式对话（测试连接）：透传请求，原样返回宿主响应（status/body/headers），
// 回复文本解析由前端 adapter 完成
func chatCompleteFetch(h HttpFetcher, request map[string]any) (json.RawMessage, error) {
	if err := validateRequest(request, false); err != nil {
		return nil, err
	}
	res, ok, err := h.Fetch(request)
	if err != nil {
		return nil, fmt.Errorf("http_fetch failed for non-streaming request: %v", err)
	}
	if !ok {
		return nil, fmt.Errorf("http_fetch returned empty result")
	}
	return res, nil
}

// fetchModelsFetch 拉取模型列表：透传请求，原样返回宿主响应（data[].id 解析由前端完成）
func fetchModelsFetch(h HttpFetcher, request map[string]any) (json.RawMessage, error) {
	if err := validateRequest(request, false); err != nil {
		return nil, err
	}
	res, ok, err := h.Fetch(request)
	if err != nil {
		return nil, fmt.Errorf("http_fetch failed for models request: %v", err)
	}
	if !ok {
		return nil, fmt.Errorf("http_fetch returned empty result")
	}
	return res, nil
}
