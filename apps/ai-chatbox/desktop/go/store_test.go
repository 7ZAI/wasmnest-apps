// store 可移植面单测（原生 go test）——Rust 版 store.rs tests 的对等移植：
// testHost 直连真实文件系统（临时目录内），实现语义与宿主一致（Read 不存在 →
// ("", false, nil)；Write 自动建父目录；Delete 幂等），使 store 的 IO 层走与
// 生产同形的调用路径。组件面（host_wasip2 / 绑定）由 TinyGo 构建产物验证。
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testHost 测试宿主：日志静默 + host-fs 直连真实文件系统。
type testHost struct{}

func (h testHost) pathErr(op, path string, err error) error {
	return &os.PathError{Op: op, Path: path, Err: err}
}

func (h testHost) Read(path string) (string, bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, h.pathErr("read", path, err)
	}
	return string(content), true, nil
}

func (h testHost) Write(path, data string) error {
	if parent := filepath.Dir(path); parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return h.pathErr("create parent of", path, err)
		}
	}
	return os.WriteFile(path, []byte(data), 0o644)
}

func (h testHost) Delete(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return h.pathErr("delete", path, err)
	}
	return nil
}

func (h testHost) Exists(path string) (bool, error) {
	// 对齐 Rust Path::exists()：stat 失败一律折叠为 false
	_, err := os.Stat(path)
	return err == nil, nil
}

func (h testHost) RequestAuth([]string) (bool, error) { return true, nil }
func (h testHost) ConfigGet(string) (string, bool, error) {
	return "", false, nil
}
func (testHost) LogInfo(string) {}
func (testHost) LogWarn(string) {}

// newTestHost 每测试独立临时目录作为数据根（生产中为宿主绝对路径，
// 函数签名保留 dataDir 参数使测试可用真实文件系统直连——Rust 版同口径）。
func newTestHost(t *testing.T) (testHost, string) {
	t.Helper()
	dir := t.TempDir()
	return testHost{}, dir
}

func testMeta(id, updatedAt string) ConversationMeta {
	return ConversationMeta{
		ID:           id,
		Title:        "title-" + id,
		CreatedAt:    "2026-01-01T00:00:00Z",
		UpdatedAt:    updatedAt,
		ProviderID:   "p1",
		ProviderName: "DeepSeek",
		Model:        "deepseek-chat",
	}
}

func testMsg(role, content string) ChatMessageRecord {
	return ChatMessageRecord{
		Role:      role,
		Content:   content,
		Timestamp: "2026-01-01T00:00:01Z",
	}
}

func mustReadFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func TestInitCreatesDefaultFiles(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if got := mustReadFile(t, dir+"/index.jsonl"); got != "" {
		t.Fatalf("index.jsonl 应为空内容创建，实际: %q", got)
	}
	if got := mustReadFile(t, dir+"/providers.json"); !strings.Contains(got, "\"activeProviderId\"") {
		t.Fatalf("providers.json 默认内容缺 activeProviderId，实际: %s", got)
	}
}

func TestSaveMessageCreatesFileWithMetaAndAppends(t *testing.T) {
	h, dir := newTestHost(t)
	conv := testMeta("c1", "2026-01-01T00:00:00Z")
	metaStr, err := metaJSONLine(conv)
	if err != nil {
		t.Fatalf("meta line: %v", err)
	}
	if err := h.Write(dir+"/conversations/c1.jsonl", metaStr); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := SaveMessage(h, dir, "c1", testMsg("user", "hello"), false); err != nil {
		t.Fatalf("save user: %v", err)
	}
	if err := SaveMessage(h, dir, "c1", testMsg("assistant", "hi"), false); err != nil {
		t.Fatalf("save assistant: %v", err)
	}

	lines := strings.Split(mustReadFile(t, dir+"/conversations/c1.jsonl"), "\n")
	if len(lines) != 4 { // 3 行 + 末尾换行产生的空段
		t.Fatalf("应有 3 行内容，实际 %d 行: %v", len(lines)-1, lines)
	}
	if !strings.Contains(lines[0], "\"type\":\"meta\"") || !strings.Contains(lines[1], "\"role\":\"user\"") || !strings.Contains(lines[2], "\"role\":\"assistant\"") {
		t.Fatalf("行序应为 meta/user/assistant，实际: %v", lines[:3])
	}
}

func TestGetMessagesSkipsMetaAndCorruptedLines(t *testing.T) {
	h, dir := newTestHost(t)
	conv := testMeta("c1", "2026-01-01T00:00:00Z")
	metaStr, _ := metaJSONLine(conv)
	content := metaStr + "\n" +
		"{\"type\":\"message\",\"role\":\"user\",\"content\":\"a\",\"timestamp\":\"t\"}\n" +
		"this is not json\n" +
		"{\"type\":\"message\",\"role\":\"assistant\",\"content\":\"b\",\"timestamp\":\"t\"}\n"
	if err := h.Write(dir+"/conversations/c1.jsonl", content); err != nil {
		t.Fatalf("seed: %v", err)
	}

	messages, err := GetMessages(h, dir, "c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("应读到 2 条消息（meta 与损坏行跳过），实际 %d", len(messages))
	}
	if messages[0].Role != "user" || messages[1].Content != "b" {
		t.Fatalf("消息顺序/内容不符: %+v", messages)
	}
}

func TestIndexSortedByUpdatedAtDesc(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c1", "2026-01-02T00:00:00Z")); err != nil {
		t.Fatalf("save c1: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c2", "2026-01-03T00:00:00Z")); err != nil {
		t.Fatalf("save c2: %v", err)
	}

	list, err := ListConversations(h, dir)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 || list[0].ID != "c2" || list[1].ID != "c1" {
		t.Fatalf("应按 updatedAt DESC 排序: %+v", list)
	}
}

func TestDeleteConversationRemovesFileAndIndex(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c1", "2026-01-02T00:00:00Z")); err != nil {
		t.Fatalf("save: %v", err)
	}
	list, _ := ListConversations(h, dir)
	if len(list) != 1 {
		t.Fatalf("删除前索引应有 1 条，实际 %d", len(list))
	}

	if err := DeleteConversation(h, dir, "c1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(dir + "/conversations/c1.jsonl"); !os.IsNotExist(err) {
		t.Fatalf("对话文件应已删除")
	}
	list, _ = ListConversations(h, dir)
	if len(list) != 0 {
		t.Fatalf("删除后索引应为空，实际 %d", len(list))
	}
}

func TestSaveMessageReplaceLastAssistant(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c1", "2026-01-01T00:00:00Z")); err != nil {
		t.Fatalf("save conv: %v", err)
	}
	if err := SaveMessage(h, dir, "c1", testMsg("user", "q"), false); err != nil {
		t.Fatalf("save q: %v", err)
	}
	if err := SaveMessage(h, dir, "c1", testMsg("assistant", "old answer"), false); err != nil {
		t.Fatalf("save old: %v", err)
	}

	if err := SaveMessage(h, dir, "c1", testMsg("assistant", "new answer"), true); err != nil {
		t.Fatalf("save new: %v", err)
	}

	messages, err := GetMessages(h, dir, "c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 2 || messages[1].Content != "new answer" {
		t.Fatalf("末尾 assistant 应被覆盖: %+v", messages)
	}
}

func TestSaveMessagePersistsReasoningAndReadsBack(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c1", "2026-01-01T00:00:00Z")); err != nil {
		t.Fatalf("save conv: %v", err)
	}

	reasoning := "思考过程"
	assistant := testMsg("assistant", "正文")
	assistant.Reasoning = &reasoning
	if err := SaveMessage(h, dir, "c1", assistant, false); err != nil {
		t.Fatalf("save: %v", err)
	}

	// JSONL 行含 reasoning 字段
	content := mustReadFile(t, dir+"/conversations/c1.jsonl")
	if !strings.Contains(content, "\"reasoning\":\"思考过程\"") {
		t.Fatalf("JSONL 行应含 reasoning 字段: %s", content)
	}

	// 读回：reasoning 与正文同消息还原
	messages, err := GetMessages(h, dir, "c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 1 || messages[0].Content != "正文" || messages[0].Reasoning == nil || *messages[0].Reasoning != "思考过程" {
		t.Fatalf("reasoning 应随消息还原: %+v", messages)
	}
}

func TestGetMessagesLegacyLinesWithoutReasoningReadAsNone(t *testing.T) {
	// P3 前的历史日志无 reasoning 字段：必须读回 nil 而非解析失败
	h, dir := newTestHost(t)
	conv := testMeta("c1", "2026-01-01T00:00:00Z")
	metaStr, _ := metaJSONLine(conv)
	content := metaStr + "\n" +
		"{\"type\":\"message\",\"role\":\"assistant\",\"content\":\"旧回复\",\"timestamp\":\"t\"}\n"
	if err := h.Write(dir+"/conversations/c1.jsonl", content); err != nil {
		t.Fatalf("seed: %v", err)
	}

	messages, err := GetMessages(h, dir, "c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 1 || messages[0].Reasoning != nil || messages[0].Content != "旧回复" {
		t.Fatalf("旧日志行应读回 reasoning=nil: %+v", messages)
	}
}

func TestSaveMessageReplaceLastAssistantOverwritesReasoning(t *testing.T) {
	// 重新生成：正文与思考一并覆盖（旧 reasoning 不得残留）
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := SaveConversation(h, dir, testMeta("c1", "2026-01-01T00:00:00Z")); err != nil {
		t.Fatalf("save conv: %v", err)
	}
	if err := SaveMessage(h, dir, "c1", testMsg("user", "q"), false); err != nil {
		t.Fatalf("save q: %v", err)
	}

	oldReasoning := "旧思考"
	old := testMsg("assistant", "旧正文")
	old.Reasoning = &oldReasoning
	if err := SaveMessage(h, dir, "c1", old, false); err != nil {
		t.Fatalf("save old: %v", err)
	}

	newReasoning := "新思考"
	fresh := testMsg("assistant", "新正文")
	fresh.Reasoning = &newReasoning
	if err := SaveMessage(h, dir, "c1", fresh, true); err != nil {
		t.Fatalf("save fresh: %v", err)
	}

	messages, err := GetMessages(h, dir, "c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 2 || messages[1].Content != "新正文" || messages[1].Reasoning == nil || *messages[1].Reasoning != "新思考" {
		t.Fatalf("重新生成应覆盖正文与思考: %+v", messages)
	}
	// 旧思考已随旧行一起被覆盖，不残留
	raw := mustReadFile(t, dir+"/conversations/c1.jsonl")
	if strings.Contains(raw, "旧思考") {
		t.Fatalf("旧 reasoning 不应残留: %s", raw)
	}
}

func TestSaveConversationUpdatesMetaFirstLine(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	conv := testMeta("c1", "2026-01-01T00:00:00Z")
	if err := SaveConversation(h, dir, conv); err != nil {
		t.Fatalf("save conv: %v", err)
	}
	if err := SaveMessage(h, dir, "c1", testMsg("user", "hello"), false); err != nil {
		t.Fatalf("save msg: %v", err)
	}

	renamed := conv
	renamed.Title = "renamed"
	renamed.UpdatedAt = "2026-01-04T00:00:00Z"
	if err := SaveConversation(h, dir, renamed); err != nil {
		t.Fatalf("rename: %v", err)
	}

	content := mustReadFile(t, dir+"/conversations/c1.jsonl")
	firstLine := strings.SplitN(content, "\n", 2)[0]
	if !strings.Contains(firstLine, "\"title\":\"renamed\"") {
		t.Fatalf("首行 meta 应已更新: %s", firstLine)
	}
	// 消息行保留
	if !strings.Contains(content, "\"role\":\"user\"") {
		t.Fatalf("消息行应保留: %s", content)
	}
	// 索引已更新
	list, _ := ListConversations(h, dir)
	if len(list) != 1 || list[0].Title != "renamed" {
		t.Fatalf("索引应同步更新: %+v", list)
	}
}

func TestSaveConversationCreatesFileWhenMissing(t *testing.T) {
	h, dir := newTestHost(t)
	if err := Init(h, dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	conv := testMeta("c-new", "2026-01-05T00:00:00Z")

	// 新建对话：对话文件不存在，save_conversation 应创建（meta 首行）而非报错
	if err := SaveConversation(h, dir, conv); err != nil {
		t.Fatalf("save new: %v", err)
	}

	firstLine := strings.SplitN(mustReadFile(t, dir+"/conversations/c-new.jsonl"), "\n", 2)[0]
	if !strings.Contains(firstLine, "\"type\":\"meta\"") {
		t.Fatalf("新对话文件首行应为 meta: %s", firstLine)
	}
	// 索引同步
	list, _ := ListConversations(h, dir)
	if len(list) != 1 || list[0].ID != "c-new" {
		t.Fatalf("索引应含新对话: %+v", list)
	}

	// 之后 save_message 可正常追加（文件已存在）
	if err := SaveMessage(h, dir, "c-new", testMsg("user", "first"), false); err != nil {
		t.Fatalf("save msg: %v", err)
	}
	messages, err := GetMessages(h, dir, "c-new")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(messages) != 1 || messages[0].Content != "first" {
		t.Fatalf("追加消息应可读回: %+v", messages)
	}
}
