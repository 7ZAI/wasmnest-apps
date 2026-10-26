// JSONL 对话日志持久化——Rust 版 store.rs 的 Go 对等移植（issue #21 Solution 5：
// 命令契约不变）。存储布局与行格式逐字对齐：`conversations/{convId}.jsonl`
// （首行 meta + 逐行消息）、`index.jsonl`（对话索引，updatedAt DESC）、
// `providers.json`（配置占位）。
//
// 文件访问经宿主 host-fs 原语（AppHost 抽象），不经 WASI：数据根是宿主绝对路径
// `{home}/.wasmnest/ai-chatbox`，路径授权集中在 activate 的 fs_request_auth
// 一次申请（WASI 预打开面不覆盖宿主绝对路径，且绕开宿主权限门不可行），两版
// 后端保持同一条 IO 路径。损坏行处理口径与 Rust 版一致：跳过并经 HostLog
// 转发告警，不静默丢弃也不整体失败。
package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ConversationMeta 对话元数据（index.jsonl 每行一个；对话文件首行同构）。
// 字段与 serde `rename_all = "camelCase"` 版本逐字对齐。
type ConversationMeta struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	ProviderID   string `json:"providerId"`
	ProviderName string `json:"providerName"`
	Model        string `json:"model"`
}

// Usage token 用量（流结束时由宿主 usage 透传携带）。
type Usage struct {
	PromptTokens     uint64 `json:"promptTokens"`
	CompletionTokens uint64 `json:"completionTokens"`
	TotalTokens      uint64 `json:"totalTokens"`
}

// ChatMessageRecord 消息记录（对话文件 `type == "message"` 的行）。
// 指针字段 = Rust `#[serde(default)] Option`：旧日志缺字段读回 nil 不报错，
// 序列化缺省为 null（与 Rust Option 序列化同形，不用 omitempty）。
type ChatMessageRecord struct {
	Role      string  `json:"role"`
	Content   string  `json:"content"`
	Timestamp string  `json:"timestamp"`
	Model     *string `json:"model"`
	Usage     *Usage  `json:"usage"`
	Reasoning *string `json:"reasoning"`
}

// metaLine 对话文件首行 / index.jsonl 行（字段顺序 = Rust json! 字面量顺序）。
type metaLine struct {
	Type         string `json:"type"`
	ID           string `json:"id"`
	Title        string `json:"title"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	ProviderID   string `json:"providerId"`
	ProviderName string `json:"providerName"`
	Model        string `json:"model"`
}

// messageLine 对话文件消息行（Model/Usage/Reasoning 缺省 null，与 Rust
// `json!` 里 Option 序列化同形）。
type messageLine struct {
	Type      string  `json:"type"`
	Role      string  `json:"role"`
	Content   string  `json:"content"`
	Timestamp string  `json:"timestamp"`
	Model     *string `json:"model"`
	Usage     *Usage  `json:"usage"`
	Reasoning *string `json:"reasoning"`
}

// Init 初始化数据目录：缺省文件（index.jsonl / providers.json）不存在时写入默认内容。
//
// conversations/ 子目录不显式创建——宿主 fs_write 会按需创建父目录，
// 首次落盘对话时自然出现（空目录本身无数据语义）。
func Init(h AppHost, dataDir string) error {
	indexPath := indexPathOf(dataDir)
	if exists, err := fileExists(h, indexPath); err != nil {
		return err
	} else if !exists {
		if err := writeFile(h, indexPath, ""); err != nil {
			return err
		}
	}

	providersPath := fmt.Sprintf("%s/providers.json", dataDir)
	if exists, err := fileExists(h, providersPath); err != nil {
		return err
	} else if !exists {
		defaultProviders := struct {
			Providers        []any  `json:"providers"`
			ActiveProviderID string `json:"activeProviderId"`
			ActiveModel      string `json:"activeModel"`
		}{Providers: []any{}}
		pretty, err := json.MarshalIndent(defaultProviders, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to serialize providers.json: %v", err)
		}
		if err := writeFile(h, providersPath, string(pretty)); err != nil {
			return err
		}
	}
	return nil
}

// ListConversations 列出全部对话（index.jsonl），按 updatedAt 降序；索引文件缺失视为空列表。
func ListConversations(h AppHost, dataDir string) ([]ConversationMeta, error) {
	content, found, err := readFile(h, indexPathOf(dataDir))
	if err != nil {
		return nil, err
	}
	if !found {
		return []ConversationMeta{}, nil
	}

	convs := []ConversationMeta{}
	for _, line := range contentLines(content) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(trimmed), &m); err != nil {
			h.LogWarn(fmt.Sprintf("list_conversations: skipping corrupted index line: %v", err))
			continue
		}
		// 必备键存在性 + 类型校验（serde 缺键 / 错型都判失败，这里分两步对齐）
		if !hasAllKeys(m, "id", "title", "createdAt", "updatedAt", "providerId", "providerName", "model") {
			h.LogWarn("list_conversations: skipping corrupted index line: missing required field")
			continue
		}
		b, _ := json.Marshal(m)
		var conv ConversationMeta
		if err := json.Unmarshal(b, &conv); err != nil {
			h.LogWarn(fmt.Sprintf("list_conversations: skipping corrupted index line: %v", err))
			continue
		}
		convs = append(convs, conv)
	}
	sort.SliceStable(convs, func(i, j int) bool { return convs[i].UpdatedAt > convs[j].UpdatedAt })
	return convs, nil
}

// GetMessages 获取对话全部消息（跳过首行 meta；损坏行跳过）。
func GetMessages(h AppHost, dataDir, conversationID string) ([]ChatMessageRecord, error) {
	path := conversationPathOf(dataDir, conversationID)
	content, found, err := readFile(h, path)
	if err != nil {
		return nil, err
	}
	if !found {
		return []ChatMessageRecord{}, nil
	}

	messages := []ChatMessageRecord{}
	for _, line := range contentLines(content) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(trimmed), &m); err != nil {
			h.LogWarn(fmt.Sprintf("get_messages: skipping corrupted line: %v (conversation %s)", err, conversationID))
			continue
		}
		if lineType, _ := m["type"].(string); lineType != "message" {
			continue
		}
		if !hasAllKeys(m, "role", "content", "timestamp") {
			h.LogWarn(fmt.Sprintf("get_messages: skipping corrupted message line: missing required field (conversation %s)", conversationID))
			continue
		}
		b, _ := json.Marshal(m)
		var msg ChatMessageRecord
		if err := json.Unmarshal(b, &msg); err != nil {
			h.LogWarn(fmt.Sprintf("get_messages: skipping corrupted message line: %v", err))
			continue
		}
		messages = append(messages, msg)
	}
	return messages, nil
}

// SaveMessage 追加一条消息（读-拼-写整文件覆盖）。
//
// replaceLastAssistant 为 true 时先删除文件末尾的 assistant 消息行再追加
// （重新生成场景：旧回复被新回复覆盖，避免重启后旧回复复现）。
func SaveMessage(h AppHost, dataDir, conversationID string, msg ChatMessageRecord, replaceLastAssistant bool) error {
	path := conversationPathOf(dataDir, conversationID)
	content, found, err := readFile(h, path)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("conversation file not found: %s", path)
	}

	if replaceLastAssistant {
		content = stripLastAssistantLine(content)
	}

	line, err := json.Marshal(messageLine{
		Type:      "message",
		Role:      msg.Role,
		Content:   msg.Content,
		Timestamp: msg.Timestamp,
		Model:     msg.Model,
		Usage:     msg.Usage,
		Reasoning: msg.Reasoning,
	})
	if err != nil {
		return fmt.Errorf("failed to serialize message: %v", err)
	}

	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += string(line) + "\n"

	return writeFile(h, path, content)
}

// SaveConversation 更新对话 meta（重写对话文件首行 + 重写 index.jsonl）。
func SaveConversation(h AppHost, dataDir string, conv ConversationMeta) error {
	// 重写对话文件首行（meta 与消息行保持同文件）；新对话文件尚不存在时直接创建
	path := conversationPathOf(dataDir, conv.ID)
	content, found, err := readFile(h, path)
	if err != nil {
		return err
	}
	if !found {
		content = ""
	}
	lines := contentLines(content)

	metaLineStr, err := metaJSONLine(conv)
	if err != nil {
		return err
	}
	// 解析首行判断是否 meta（JSON 键序不保证，不能用字符串前缀匹配）
	isMetaFirst := false
	if len(lines) > 0 {
		var first map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(lines[0])), &first); err == nil {
			if t, _ := first["type"].(string); t == "meta" {
				isMetaFirst = true
			}
		}
	}
	if isMetaFirst {
		lines[0] = metaLineStr
	} else {
		lines = append([]string{metaLineStr}, lines...)
	}
	rewritten := strings.Join(lines, "\n")
	if !strings.HasSuffix(rewritten, "\n") {
		rewritten += "\n"
	}
	if err := writeFile(h, path, rewritten); err != nil {
		return err
	}

	return rewriteIndex(h, dataDir, []ConversationMeta{conv}, nil)
}

// DeleteConversation 删除对话（删对话文件 + 从 index.jsonl 移除）。
func DeleteConversation(h AppHost, dataDir, conversationID string) error {
	path := conversationPathOf(dataDir, conversationID)
	if err := h.Delete(path); err != nil {
		return fmt.Errorf("failed to delete %s: %v", path, err)
	}
	return rewriteIndex(h, dataDir, nil, []string{conversationID})
}

// conversationPathOf 对话文件路径。
func conversationPathOf(dataDir, conversationID string) string {
	return fmt.Sprintf("%s/conversations/%s.jsonl", dataDir, conversationID)
}

// indexPathOf 索引文件路径。
func indexPathOf(dataDir string) string {
	return fmt.Sprintf("%s/index.jsonl", dataDir)
}

// ==================== 宿主 host-fs 访问辅助（错误带路径上下文，口径同 Rust 版） ====================

// readFile 读文件：文件不存在返回 found=false（宿主 fs_read 契约），其余错误上抛。
func readFile(h AppHost, path string) (string, bool, error) {
	content, ok, err := h.Read(path)
	if err != nil {
		return "", false, fmt.Errorf("failed to read %s: %v", path, err)
	}
	return content, ok, nil
}

// writeFile 写文件（整文件覆盖）：宿主 fs_write 会自动创建父目录，故无需显式建目录。
func writeFile(h AppHost, path, content string) error {
	if err := h.Write(path, content); err != nil {
		return fmt.Errorf("failed to write %s: %v", path, err)
	}
	return nil
}

// fileExists 文件是否存在（路径不可访问由宿主折叠为 false）。
func fileExists(h AppHost, path string) (bool, error) {
	exists, err := h.Exists(path)
	if err != nil {
		return false, fmt.Errorf("failed to stat %s: %v", path, err)
	}
	return exists, nil
}

// metaJSONLine 序列化 meta 行（对话文件首行 / index.jsonl 行）。
func metaJSONLine(conv ConversationMeta) (string, error) {
	b, err := json.Marshal(metaLine{
		Type:         "meta",
		ID:           conv.ID,
		Title:        conv.Title,
		CreatedAt:    conv.CreatedAt,
		UpdatedAt:    conv.UpdatedAt,
		ProviderID:   conv.ProviderID,
		ProviderName: conv.ProviderName,
		Model:        conv.Model,
	})
	if err != nil {
		return "", fmt.Errorf("failed to serialize conversation meta: %v", err)
	}
	return string(b), nil
}

// rewriteIndex 重写 index.jsonl（upsert 覆盖同 id，exclude 剔除 id，按 updatedAt DESC 全量落盘）。
func rewriteIndex(h AppHost, dataDir string, upsert []ConversationMeta, exclude []string) error {
	existing, err := ListConversations(h, dataDir)
	if err != nil {
		return err
	}

	excluded := map[string]bool{}
	for _, id := range exclude {
		excluded[id] = true
	}
	upserted := map[string]bool{}
	for _, u := range upsert {
		upserted[u.ID] = true
	}
	merged := []ConversationMeta{}
	for _, c := range existing {
		if !upserted[c.ID] && !excluded[c.ID] {
			merged = append(merged, c)
		}
	}
	merged = append(merged, upsert...)
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].UpdatedAt > merged[j].UpdatedAt })

	var content strings.Builder
	for _, conv := range merged {
		line, err := metaJSONLine(conv)
		if err != nil {
			return err
		}
		content.WriteString(line)
		content.WriteString("\n")
	}
	return writeFile(h, indexPathOf(dataDir), content.String())
}

// stripLastAssistantLine 删除文件末尾最后一条 assistant 消息行（按行倒序查找 role == assistant）。
func stripLastAssistantLine(content string) string {
	lines := contentLines(content)
	idx := -1
	for i := len(lines) - 1; i >= 0; i-- {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(trimmed), &m); err != nil {
			continue
		}
		if t, _ := m["type"].(string); t != "message" {
			continue
		}
		if role, _ := m["role"].(string); role == "assistant" {
			idx = i
			break
		}
	}
	if idx < 0 {
		return content
	}
	out := strings.Join(lines[:idx], "\n")
	if out != "" && !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return out
}

// contentLines 把文件内容拆成行（对齐 Rust str::lines：末尾换行不产生空尾行，
// 中间空行保留）。
func contentLines(content string) []string {
	lines := strings.Split(content, "\n")
	if n := len(lines); n > 0 && lines[n-1] == "" {
		lines = lines[:n-1]
	}
	return lines
}

// hasAllKeys 必备键存在性检查（值类型由后续结构体反序列化校验）。
func hasAllKeys(m map[string]any, keys ...string) bool {
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}
