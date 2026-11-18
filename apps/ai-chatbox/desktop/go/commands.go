// Command Handlers——Rust 版 commands.rs 的 Go 对等移植。
//
// 8 个命令处理器（同步调用；参数从原始 JSON 载荷提取）：
// chat-stream / chat-complete / fetch-models / list-conversations /
// get-messages / save-conversation / save-message / delete-conversation。
// 错误文案与 Rust 版逐字对齐（前端把 `{"error": …}` 的串直接透出，文案即契约）。
package main

import (
	"encoding/json"
	"fmt"
)

// parseArgs 解析命令载荷为对象（无效 JSON 显性失败，不静默替换为空对象；
// null 按 Rust serde Value::Null 同语义折叠为空映射——取键即 miss）。
func parseArgs(raw json.RawMessage) (map[string]any, error) {
	var args map[string]any
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	if args == nil {
		args = map[string]any{}
	}
	return args, nil
}

// argString / argStringOr / argValue / argBoolOr 是 Rust CommandArgs 取值方法
// 的对等物：缺键或非目标类型按各自口径回退（与 serde Value 的 as_str /
// as_bool 语义一致）。
func argString(args map[string]any, key string) (string, bool) {
	v, ok := args[key].(string)
	return v, ok
}

func argStringOr(args map[string]any, key, def string) string {
	if v, ok := args[key].(string); ok {
		return v
	}
	return def
}

// argValue 取嵌套值（原样 any，序列化由消费方决定；缺键返回 ok=false）。
func argValue(args map[string]any, key string) (any, bool) {
	v, ok := args[key]
	return v, ok
}

func argBoolOr(args map[string]any, key string, def bool) bool {
	if v, ok := args[key].(bool); ok {
		return v
	}
	return def
}

// ==================== 8 命令（错误前缀 = Rust 版函数名口径） ====================

// chatStream 流式聊天：透传前端适配层构建的 raw 请求（立即返回，宿主后台推流）
func (p *plugin) chatStream(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("chat_stream: %v", err)
	}
	streamID, ok := argString(m, "streamId")
	if !ok {
		return nil, fmt.Errorf("chat_stream: missing streamId")
	}
	request, ok := argValue(m, "request")
	if !ok {
		return nil, fmt.Errorf("chat_stream: missing request")
	}
	reqMap, err := requestObject(request)
	if err != nil {
		return nil, fmt.Errorf("chat_stream: %v", err)
	}
	res, err := chatStreamFetch(p.http, streamID, reqMap)
	if err != nil {
		return nil, fmt.Errorf("chat_stream: %v", err)
	}
	return res, nil
}

// chatComplete 非流式聊天（测试连接用）：原样返回宿主响应（status/body/headers，前端解析）
func (p *plugin) chatComplete(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("chat_complete: %v", err)
	}
	request, ok := argValue(m, "request")
	if !ok {
		return nil, fmt.Errorf("chat_complete: missing request")
	}
	reqMap, err := requestObject(request)
	if err != nil {
		return nil, fmt.Errorf("chat_complete: %v", err)
	}
	res, err := chatCompleteFetch(p.http, reqMap)
	if err != nil {
		return nil, fmt.Errorf("chat_complete: %v", err)
	}
	return res, nil
}

// fetchModels 拉取模型列表：原样返回宿主响应（前端解析 data[].id）
func (p *plugin) fetchModelsCmd(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("fetch_models: %v", err)
	}
	request, ok := argValue(m, "request")
	if !ok {
		return nil, fmt.Errorf("fetch_models: missing request")
	}
	reqMap, err := requestObject(request)
	if err != nil {
		return nil, fmt.Errorf("fetch_models: %v", err)
	}
	res, err := fetchModelsFetch(p.http, reqMap)
	if err != nil {
		return nil, fmt.Errorf("fetch_models: %v", err)
	}
	return res, nil
}

// listConversations 列出所有对话（index.jsonl，按 updatedAt DESC）
func (p *plugin) listConversations(json.RawMessage) (any, error) {
	dir, err := p.dataDir()
	if err != nil {
		return nil, err
	}
	convs, err := ListConversations(p.host, dir)
	if err != nil {
		return nil, err
	}
	return map[string]any{"conversations": convs}, nil
}

// getMessages 获取对话消息（跳过 meta 首行）
func (p *plugin) getMessages(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("get_messages: %v", err)
	}
	conversationID, ok := argString(m, "conversationId")
	if !ok {
		return nil, fmt.Errorf("get_messages: missing conversationId")
	}
	dir, err := p.dataDir()
	if err != nil {
		return nil, err
	}
	messages, err := GetMessages(p.host, dir, conversationID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"messages": messages}, nil
}

// saveConversation 保存/更新对话（meta 首行 + 索引重写）
func (p *plugin) saveConversation(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("save_conversation: %v", err)
	}
	raw, ok := argValue(m, "conversation")
	if !ok {
		return nil, fmt.Errorf("save_conversation: missing conversation")
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("save_conversation: invalid conversation: %v", err)
	}
	var conv ConversationMeta
	if err := json.Unmarshal(b, &conv); err != nil {
		return nil, fmt.Errorf("save_conversation: invalid conversation: %v", err)
	}
	dir, err := p.dataDir()
	if err != nil {
		return nil, err
	}
	if err := SaveConversation(p.host, dir, conv); err != nil {
		return nil, err
	}
	return map[string]any{"success": true}, nil
}

// saveMessage 保存消息（读-拼-写整文件；replaceLastAssistant 覆盖末尾 assistant 行）
func (p *plugin) saveMessage(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("save_message: %v", err)
	}
	conversationID, ok := argString(m, "conversationId")
	if !ok {
		return nil, fmt.Errorf("save_message: missing conversationId")
	}
	role, ok := argString(m, "role")
	if !ok {
		return nil, fmt.Errorf("save_message: missing role")
	}
	msg := ChatMessageRecord{
		Role:      role,
		Content:   argStringOr(m, "content", ""),
		Timestamp: argStringOr(m, "timestamp", ""),
	}
	if v, ok := m["model"].(string); ok {
		msg.Model = &v
	}
	// usage 解析失败按 Rust `serde_json::from_value(v).ok()` 同口径折叠为 None
	if raw, ok := m["usage"]; ok && raw != nil {
		b, err := json.Marshal(raw)
		var u Usage
		if err == nil && json.Unmarshal(b, &u) == nil {
			msg.Usage = &u
		}
	}
	if v, ok := m["reasoning"].(string); ok {
		msg.Reasoning = &v
	}
	dir, err := p.dataDir()
	if err != nil {
		return nil, err
	}
	if err := SaveMessage(p.host, dir, conversationID, msg, argBoolOr(m, "replaceLastAssistant", false)); err != nil {
		return nil, err
	}
	return map[string]any{"success": true}, nil
}

// deleteConversation 删除对话（删文件 + 索引移除）
func (p *plugin) deleteConversation(args json.RawMessage) (any, error) {
	m, err := parseArgs(args)
	if err != nil {
		return nil, fmt.Errorf("delete_conversation: %v", err)
	}
	conversationID, ok := argString(m, "conversationId")
	if !ok {
		return nil, fmt.Errorf("delete_conversation: missing conversationId")
	}
	dir, err := p.dataDir()
	if err != nil {
		return nil, err
	}
	if err := DeleteConversation(p.host, dir, conversationID); err != nil {
		return nil, err
	}
	return map[string]any{"success": true}, nil
}

// dataDir 数据目录（宿主绝对路径，activate 时解析并缓存）。
//
// 未激活（缓存为空）时显性报错：宿主只在插件激活成功后派发命令，该分支属
// 防御性 fail-visible —— 不静默返回空路径（空路径会被宿主 fs_auth 拒绝，
// 报错点会漂移到宿主侧，掩盖真实原因）。
func (p *plugin) dataDir() (string, error) {
	if p.dataRoot == "" {
		return "", fmt.Errorf("plugin not activated: data dir unavailable")
	}
	return p.dataRoot, nil
}

// requestObject 校验 request 字段是 JSON 对象（http_fetch 载荷的形状前提）。
func requestObject(request any) (map[string]any, error) {
	m, ok := request.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("request must be an object")
	}
	return m, nil
}
