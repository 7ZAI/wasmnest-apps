<script setup lang="ts">
/**
 * Nest 全屏会话页（共享组件，双端同构 · 票 08 / spec §5.7）
 *
 * 布局：会话列表（侧栏）+ 消息流 + 输入区 + 供应商设置（侧滑面板）。
 * 保险库门：未建库 / 未解锁时先走 VaultView（票 07），解锁后进入对话；
 * 对话中手动锁定会重新落门（spec §2.4：停用 / 锁定不假装可用）。
 *
 * 端差异只有两个注入点：`invoke`（命令调用面）与 `subscribe`（事件订阅），
 * 其余全部由共享核（NestChatSession）承担（D3 双端同构）。
 *
 * 票 09 多会话：侧栏 = 新建任务 + 活跃会话（默认陪伴会话带保护标记、不可归档）
 * + 可折叠归档区（可查可恢复）+ 活跃会话改名。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowReactive } from 'vue'
import { reactive } from 'vue'
import MessageList from './MessageList.vue'
import Composer from './Composer.vue'
import ProviderSettings from './ProviderSettings.vue'
import VaultView from './VaultView.vue'
import FirstRunNotice from './FirstRunNotice.vue'
import MemoryView from './MemoryView.vue'
import ToolCards from './ToolCards.vue'
import AuditView from './AuditView.vue'
import { ChatPreconditionError, NestChatSession } from '../chat/session'
import { NONCE_BYTES, randomHex, vaultLock, vaultStatus } from '../vault'
import {
  ASSISTANT_PROVIDERS_DELETE_COMMAND,
  ASSISTANT_PROVIDERS_SET_DEFAULT_COMMAND,
  ASSISTANT_PROVIDERS_UPSERT_COMMAND,
  ASSISTANT_SETTINGS_GET_COMMAND,
  ASSISTANT_SETTINGS_SET_COMMAND,
  ASSISTANT_VAULT_DELETE_SECRET_COMMAND,
  ASSISTANT_VAULT_SET_SECRET_COMMAND,
  DEFAULT_COMPANION_ID,
  FIRST_RUN_NOTICE_SETTING,
  providerSecretKey,
  type AssistantInvoke,
  type AppInvokeBridge,
  type ProviderRecord,
} from '../types'

const props = defineProps<{
  invoke: AssistantInvoke
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void
  t: (key: string) => string
  lang: 'zh-CN' | 'en'
/**
   * 建库时的 Argon2id 档位：缺省走 Rust 默认（m=32 MiB / t=3 / p=1）。
   * 移动入口显式传同一档位，避免低端机在派生时长时间卡顿。
   */
  kdfParams?: { m?: number; t?: number; p?: number }
  /** 应用调用桥（宿主按 apps:control 注入；未注入 = 无应用工具能力） */
  apps?: AppInvokeBridge | null
}>()

const vaultReady = ref(false)
const vaultChecking = ref(false)
const showSettings = ref(false)
const composerError = ref('')
const providers = ref<ProviderRecord[]>([])
const keySet = ref<Record<string, boolean>>({})
const conversations = ref<Array<{ id: string; title: string; updatedAt: string }>>([])
const archivedConversations = ref<Array<{ id: string; title: string; updatedAt: string }>>([])
const showArchived = ref(false)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
/** 首次使用非人声明（票 11）：未阅时在消息区顶部展示，阅后写设置不再弹 */
const noticeVisible = ref(false)
/** 记忆管理页（票 12）覆盖开关 */
const showMemory = ref(false)
/** 审计页（票 13）覆盖开关 */
const showAudit = ref(false)

let session: NestChatSession | null = null

/**
 * session 引用版本号：`session` 是普通 let 绑定，computed 不会因它被重新赋值而
 * 失效。每次建 / 拆 session 时 +1，让下面两个 computed 重新求值（会话重开后
 * 仍能跟上新的响应式对象）。
 */
const sessionEpoch = ref(0)

const streaming = computed(() => {
  void sessionEpoch.value
  return session?.streaming ?? false
})
const messages = computed(() => {
  void sessionEpoch.value
  return session?.messages ?? []
})

/** 保险库门检查：已建库且已解锁才进对话 */
async function checkVault(): Promise<void> {
  vaultChecking.value = true
  try {
    const st = await vaultStatus(props.invoke)
    if (st?.exists && st?.unlocked) {
      vaultReady.value = true
      await initChat()
      resetIdleTimer()
    } else {
      vaultReady.value = false
      clearIdleTimer()
      disposeSession()
    }
  } catch (e) {
    // 状态查询失败显性呈现（fail-visible），不进对话
    vaultReady.value = false
    composerError.value = e instanceof Error ? e.message : String(e)
  } finally {
    vaultChecking.value = false
  }
}

async function initChat(): Promise<void> {
  if (session) return
  // shallowReactive（不是 reactive）：只跟踪 session 自身的字段（streaming /
  // messages / conversations …），不深代理内部的 pi Agent 与 provider 记录——
  // 普通对象上的字段变更不产生依赖，`computed(() => session.streaming)` 会永远
  // 停在初值（停止按钮 / 流式态失效）。
  session = shallowReactive(
    new NestChatSession({
      invoke: props.invoke,
      subscribe: props.subscribe,
      lang: props.lang,
      apps: props.apps ?? null,
      log: (level, msg) => console[level === 'error' ? 'error' : 'warn'](`[nest] ${msg}`),
    }),
  ) as NestChatSession
  // 消息数组包响应式代理：流式增量（session 内部就地修改）可驱动 UI
  session.messages = reactive(session.messages)
  // 工具卡片同口径（票 13）：运行时就地修改，响应式包装持续有效
  session.toolCards = reactive(session.toolCards)
  sessionEpoch.value += 1
  try {
    await session.refreshProviders()
    providers.value = [...session.providers]
    await refreshKeySet()
    // 票 09：默认陪伴会话存在性双保险（Rust 激活已建，此处核对补建）
    await session.ensureDefaultCompanion()
    await session.refreshConversations()
    syncConversations()
    // 自动打开最近会话（没有则打开默认陪伴会话）
    const latest = session.conversations[0] ?? session.archivedConversations[0]
    if (latest) {
      await session.openConversation(latest.id)
    }
    // 票 11：首次使用非人声明（设置读取失败不静默跳过，按未阅处理）
    await checkFirstRunNotice()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 首次使用声明检查（票 11）：设置值 != '1' 即展示。
 * 声明是产品定位的强制告知（spec §2.1），读取失败按未阅处理，不静默跳过。
 */
async function checkFirstRunNotice(): Promise<void> {
  try {
    const res = await props.invoke<{ value: string | null }>(ASSISTANT_SETTINGS_GET_COMMAND, {
      key: FIRST_RUN_NOTICE_SETTING,
    })
    noticeVisible.value = res?.value !== '1'
  } catch {
    noticeVisible.value = true
  }
}

/** 阅后写标记并隐藏（写失败也隐藏当前卡片，下次挂载会重新检查并点名） */
async function dismissFirstRunNotice(): Promise<void> {
  noticeVisible.value = false
  try {
    await props.invoke(ASSISTANT_SETTINGS_SET_COMMAND, {
      key: FIRST_RUN_NOTICE_SETTING,
      value: '1',
    })
  } catch (e) {
    console.warn('[nest] 首次使用声明标记写入失败：', e)
  }
}

function disposeSession(): void {
  session?.dispose()
  session = null
  sessionEpoch.value += 1
  providers.value = []
  keySet.value = {}
  conversations.value = []
  archivedConversations.value = []
  showArchived.value = false
  renamingId.value = null
  renameDraft.value = ''
  noticeVisible.value = false
  showMemory.value = false
  showAudit.value = false
}

function syncConversations(): void {
  if (!session) return
  conversations.value = session.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
  }))
  archivedConversations.value = session.archivedConversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
  }))
}

/** 探测各供应商密钥是否已设（不回显密钥内容，只记状态） */
async function refreshKeySet(): Promise<void> {
  if (!session) return
  const next: Record<string, boolean> = {}
  const s = session
  await Promise.all(
    s.providers.map(async (p) => {
      next[p.id] = (await s.getProviderKey(p.id)) !== null
    }),
  )
  keySet.value = next
}

// ==================== 对话操作 ====================

async function onSend(text: string): Promise<void> {
  composerError.value = ''
  if (!session) return
  try {
    await session.send(text)
    syncConversations()
  } catch (e) {
    if (e instanceof ChatPreconditionError) {
      composerError.value = e.message
    } else {
      composerError.value = e instanceof Error ? e.message : String(e)
    }
  }
}

function onStop(): void {
  session?.stop()
}

/** 停止并锁定保险库（票 13 急停增强）：先停生成与在途确认，再锁库落门 */
async function onStopAndLock(): Promise<void> {
  session?.stop()
  showSettings.value = false
  try {
    await vaultLock(props.invoke)
  } catch {
    // 锁定失败也重查状态，不假装已锁
  }
  await checkVault()
}

/** UI 回工具确认决定（批准 / 拒绝） */
function onToolConfirm(id: string, decision: 'approve' | 'reject'): void {
  session?.resolveToolConfirmation(id, decision)
}

async function onRetry(): Promise<void> {
  composerError.value = ''
  try {
    await session?.retry()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onOpenConversation(id: string): Promise<void> {
  if (!session) return
  try {
    await session.openConversation(id)
    syncConversations()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onNewConversation(): Promise<void> {
  if (!session) return
  try {
    // 票 09：新建一律是任务会话；默认长期陪伴会话已随激活存在
    const id = await session.createConversation('task', props.t('assistant.chat.taskTitle'))
    await session.openConversation(id)
    syncConversations()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

// ==================== 归档 / 恢复 / 改名（票 09） ====================

async function onArchive(id: string): Promise<void> {
  if (!session) return
  try {
    await session.archiveConversation(id, true)
    if (session.currentId === id) session.currentId = null
    syncConversations()
  } catch (e) {
    // 守卫拒绝（默认陪伴会话等）原样上交，点名缺什么
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onRestore(id: string): Promise<void> {
  if (!session) return
  try {
    await session.archiveConversation(id, false)
    syncConversations()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

function startRename(id: string, currentTitle: string): void {
  renamingId.value = id
  renameDraft.value = currentTitle
}

function cancelRename(): void {
  renamingId.value = null
  renameDraft.value = ''
}

async function submitRename(id: string): Promise<void> {
  const title = renameDraft.value.trim()
  if (!title) {
    cancelRename()
    return
  }
  try {
    await session?.renameConversation(id, title)
    syncConversations()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
  cancelRename()
}

// ==================== 供应商设置 ====================

async function onUpsertProvider(provider: ProviderRecord, apiKey: string): Promise<void> {
  if (!session) return
  try {
    await props.invoke(ASSISTANT_PROVIDERS_UPSERT_COMMAND, {
      id: provider.id,
      name: provider.name,
      apiStyle: provider.apiStyle,
      baseUrl: provider.baseUrl,
      model: provider.model,
      isDefault: provider.isDefault,
    })
    if (apiKey) {
      // 密钥只进保险库密钥槽（不落 provider 表 / 不进日志）
      await props.invoke(ASSISTANT_VAULT_SET_SECRET_COMMAND, {
        key: providerSecretKey(provider.id),
        value: apiKey,
        nonce: randomHex(NONCE_BYTES),
        ts: Date.now().toString(),
      })
    }
    await session.refreshProviders()
    providers.value = [...session.providers]
    await refreshKeySet()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onDeleteProvider(id: string): Promise<void> {
  if (!session) return
  try {
    await props.invoke(ASSISTANT_VAULT_DELETE_SECRET_COMMAND, { key: providerSecretKey(id) })
    await props.invoke(ASSISTANT_PROVIDERS_DELETE_COMMAND, { id })
    await session.refreshProviders()
    providers.value = [...session.providers]
    await refreshKeySet()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onSetDefault(id: string): Promise<void> {
  if (!session) return
  try {
    await props.invoke(ASSISTANT_PROVIDERS_SET_DEFAULT_COMMAND, { id })
    await session.refreshProviders()
    providers.value = [...session.providers]
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onLockVault(): Promise<void> {
  showSettings.value = false
  try {
    await vaultLock(props.invoke)
  } catch {
    // 锁定失败也重查状态，不假装已锁
  }
  await checkVault()
}

// ==================== 空闲自动锁定（spec §5.8） ====================

/** 无操作多久自动锁保险库（默认 15 分钟；spec §5.8 的可配置项留到设置页） */
const IDLE_LOCK_MS = 15 * 60 * 1000
let idleTimer: ReturnType<typeof setTimeout> | null = null

/** 用户有操作 → 重置空闲计时（已有会话但已锁定时不重复排） */
function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    void onIdleLock()
  }, IDLE_LOCK_MS)
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/** 空闲到期：锁保险库并落回解锁门（生成中则顺延，不打断正在进行的回答） */
async function onIdleLock(): Promise<void> {
  if (!vaultReady.value) return
  if (streaming.value) {
    // 模型还在输出：用户没操作但要保住这次回答，问题下次空闲再锁
    resetIdleTimer()
    return
  }
  showSettings.value = false
  try {
    await vaultLock(props.invoke)
  } catch {
    // 锁定失败也重查状态，不假装已锁
  }
  await checkVault()
}

/** 任何键盘 / 指针操作都算「有操作」（capture：被应用内元素 stopPropagation 也收得到） */
const IDLE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
function onUserActivity(): void {
  if (vaultReady.value) resetIdleTimer()
}

onMounted(() => {
  void checkVault()
  for (const evt of IDLE_EVENTS) window.addEventListener(evt, onUserActivity, { capture: true })
})

onBeforeUnmount(() => {
  clearIdleTimer()
  for (const evt of IDLE_EVENTS) window.removeEventListener(evt, onUserActivity, { capture: true })
  disposeSession()
})
</script>

<template>
  <div class="nest-chat">
    <!-- 保险库门：未建库 / 未解锁先走 VaultView（票 07） -->
    <VaultView v-if="!vaultReady" :invoke="invoke" :t="t" :kdf-params="kdfParams" @changed="checkVault" />

    <template v-else>
      <div class="nest-chat__body" data-testid="nest-chat">
        <!-- 记忆管理页（票 12）：覆盖式浮层，关闭回对话 -->
        <MemoryView
          v-if="showMemory"
          :invoke="invoke"
          :t="t"
          @close="showMemory = false"
        />
        <AuditView
          v-if="showAudit"
          :invoke="invoke"
          :t="t"
          @close="showAudit = false"
        />
        <!-- 会话列表侧栏 -->
        <aside v-if="!showSettings" class="nest-chat__sidebar" data-testid="nest-sidebar">
          <button type="button" class="nest-chat__new" data-testid="nest-new-conversation" @click="onNewConversation">
            + {{ t('assistant.chat.newTask') }}
          </button>
          <ul class="nest-chat__conversations">
            <li
              v-for="c in conversations"
              :key="c.id"
              class="nest-chat__conversation"
              :class="{ 'nest-chat__conversation--active': c.id === session?.currentId }"
              data-testid="nest-conversation-item"
            >
              <span
                v-if="renamingId !== c.id"
                class="nest-chat__conversation-title"
                @click="onOpenConversation(c.id)"
              >
                <span
                  v-if="c.id === DEFAULT_COMPANION_ID"
                  class="nest-chat__companion-mark"
                  :title="t('assistant.chat.defaultCompanion')"
                >🔒</span>
                {{ c.title }}
              </span>
              <input
                v-else
                v-model="renameDraft"
                class="nest-chat__rename-input"
                data-testid="nest-rename-input"
                @keyup.enter="submitRename(c.id)"
                @keyup.esc="cancelRename"
                @blur="submitRename(c.id)"
              />
              <span class="nest-chat__conversation-actions">
                <button
                  v-if="c.id === session?.currentId"
                  type="button"
                  class="nest-chat__action"
                  :title="t('assistant.chat.rename')"
                  @click="startRename(c.id, c.title)"
                >✎</button>
                <button
                  v-if="c.id !== DEFAULT_COMPANION_ID"
                  type="button"
                  class="nest-chat__action"
                  :title="t('assistant.chat.archive')"
                  data-testid="nest-archive-conversation"
                  @click="onArchive(c.id)"
                >✕</button>
              </span>
            </li>
          </ul>

          <!-- 归档区：不进默认列表，可查可恢复（票 09） -->
          <button
            v-if="archivedConversations.length > 0"
            type="button"
            class="nest-chat__archived-toggle"
            data-testid="nest-archived-toggle"
            @click="showArchived = !showArchived"
          >
            {{ t('assistant.chat.archived') }}（{{ archivedConversations.length }}）{{ showArchived ? '▾' : '▸' }}
          </button>
          <ul v-if="showArchived" class="nest-chat__archived">
            <li
              v-for="c in archivedConversations"
              :key="'archived-' + c.id"
              class="nest-chat__archived-item"
            >
              <span class="nest-chat__conversation-title" @click="onRestore(c.id)">{{ c.title }}</span>
              <button
                type="button"
                class="nest-chat__action"
                :title="t('assistant.chat.restore')"
                data-testid="nest-restore-conversation"
                @click="onRestore(c.id)"
              >↺</button>
            </li>
          </ul>

          <button type="button" class="nest-chat__settings-btn" data-testid="nest-open-settings" @click="showSettings = true">
            ⚙ {{ t('assistant.settings.title') }}
          </button>
          <button
            type="button"
            class="nest-chat__settings-btn"
            data-testid="nest-open-memory"
            @click="showMemory = true"
          >
            🧠 {{ t('assistant.memory.title') }}
          </button>
          <button
            type="button"
            class="nest-chat__settings-btn"
            data-testid="nest-open-audit"
            @click="showAudit = true"
          >
            📋 {{ t('assistant.audit.title') }}
          </button>
        </aside>

        <!-- 主区：消息流 + 工具卡片 + 输入区 -->
        <main class="nest-chat__main">
          <FirstRunNotice
            v-if="noticeVisible"
            :title="t('assistant.notice.title')"
            :body="t('assistant.notice.body')"
            :dismiss-label="t('assistant.notice.dismiss')"
            @dismiss="dismissFirstRunNotice"
          />
          <MessageList :messages="messages" :streaming="streaming" :t="t" @retry="onRetry" />
          <!-- 票 14：提取失败提示（不静默） -->
          <div
            v-if="session?.memoryNotice"
            class="nest-memory-notice"
            data-testid="nest-memory-notice"
          >
            {{ t('assistant.memory.notice') }}
          </div>
          <!-- 票 14：本轮注入记忆清单（可展开，用户能看到实际发出的内容） -->
          <details
            v-if="(session?.currentMemoryFacts ?? []).length > 0"
            class="nest-inject"
            data-testid="nest-memory-inject"
          >
            <summary>
              {{ t('assistant.memory.injectTitle') }}（{{ (session?.currentMemoryFacts ?? []).length }}）
            </summary>
            <ul class="nest-inject__list">
              <li v-for="f in session?.currentMemoryFacts ?? []" :key="f.id" class="nest-inject__item">
                <strong>{{ f.key }}</strong>：{{ f.value }}
              </li>
            </ul>
            <p class="nest-inject__hint">{{ t('assistant.memory.injectHint') }}</p>
          </details>
          <ToolCards
            :cards="session?.toolCards ?? []"
            :t="t"
            @confirm="onToolConfirm"
          />
          <Composer
            :streaming="streaming"
            :error-message="composerError"
            :t="t"
            @send="onSend"
            @stop="onStop"
            @stop-and-lock="onStopAndLock"
          />
        </main>

        <!-- 供应商设置面板 -->
        <ProviderSettings
          v-if="showSettings"
          :providers="providers"
          :key-set="keySet"
          :t="t"
          @upsert="onUpsertProvider"
          @delete="onDeleteProvider"
          @set-default="onSetDefault"
          @lock-vault="onLockVault"
          @close="showSettings = false"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nest-chat {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--nest-surface, #232833);
  color: var(--nest-text, #e8eaf0);
}

.nest-chat__body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.nest-chat__sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--nest-border, #3a4150);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.nest-chat__new {
  border: 1px solid var(--nest-accent, #4f7cff);
  background: transparent;
  color: var(--nest-accent, #4f7cff);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
}

.nest-chat__conversations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.nest-chat__conversation {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  color: var(--nest-text, #e8eaf0);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.nest-chat__conversation-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nest-chat__companion-mark {
  font-size: 11px;
}

.nest-chat__conversation-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.nest-chat__action {
  border: none;
  background: none;
  color: var(--nest-muted, #8a8f98);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
}

.nest-chat__action:hover {
  background: var(--nest-surface-2, #2a2f3a);
  color: var(--nest-text, #e8eaf0);
}

.nest-chat__rename-input {
  flex: 1;
  min-width: 0;
  background: var(--nest-surface-2, #2a2f3a);
  border: 1px solid var(--nest-accent, #4f7cff);
  border-radius: 6px;
  color: var(--nest-text, #e8eaf0);
  font-size: 13px;
  padding: 4px 6px;
}

.nest-chat__archived-toggle {
  border: none;
  background: none;
  color: var(--nest-muted, #8a8f98);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  padding: 2px 4px;
}

.nest-chat__archived {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nest-chat__archived-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
}

.nest-chat__conversation:hover {
  background: var(--nest-surface-2, #2a2f3a);
}

.nest-chat__conversation--active {
  background: var(--nest-surface-2, #2a2f3a);
  border: 1px solid var(--nest-accent, #4f7cff);
}

.nest-chat__settings-btn {
  border: none;
  background: none;
  color: var(--nest-muted, #8a8f98);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.nest-chat__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 票 14：记忆注入清单与提取提示 */
.nest-memory-notice {
  margin: 8px 16px 0;
  padding: 8px 12px;
  border: 1px solid #d97706;
  border-radius: 8px;
  color: #fbbf24;
  font-size: 12px;
}

.nest-inject {
  margin: 8px 16px 0;
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 8px;
  background: var(--nest-surface-2, #2a2f3a);
  font-size: 12px;
}

.nest-inject summary {
  cursor: pointer;
  padding: 8px 12px;
  color: var(--nest-muted, #8a8f98);
}

.nest-inject__list {
  list-style: none;
  margin: 0;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nest-inject__item {
  color: var(--nest-text, #e8eaf0);
  word-break: break-word;
}

.nest-inject__hint {
  margin: 6px 12px 10px;
  color: var(--nest-muted, #6b7280);
}
</style>
