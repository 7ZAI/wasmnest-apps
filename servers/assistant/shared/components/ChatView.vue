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
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { reactive } from 'vue'
import MessageList from './MessageList.vue'
import Composer from './Composer.vue'
import ProviderSettings from './ProviderSettings.vue'
import VaultView from './VaultView.vue'
import { ChatPreconditionError, NestChatSession } from '../chat/session'
import { NONCE_BYTES, randomHex, vaultLock, vaultStatus } from '../vault'
import {
  ASSISTANT_PROVIDERS_DELETE_COMMAND,
  ASSISTANT_PROVIDERS_SET_DEFAULT_COMMAND,
  ASSISTANT_PROVIDERS_UPSERT_COMMAND,
  ASSISTANT_VAULT_DELETE_SECRET_COMMAND,
  ASSISTANT_VAULT_SET_SECRET_COMMAND,
  providerSecretKey,
  type AssistantInvoke,
  type ProviderRecord,
} from '../types'

const props = defineProps<{
  invoke: AssistantInvoke
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void
  t: (key: string) => string
  lang: 'zh-CN' | 'en'
}>()

const vaultReady = ref(false)
const vaultChecking = ref(false)
const showSettings = ref(false)
const composerError = ref('')
const providers = ref<ProviderRecord[]>([])
const keySet = ref<Record<string, boolean>>({})
const conversations = ref<Array<{ id: string; title: string; updatedAt: string }>>([])

let session: NestChatSession | null = null

const streaming = computed(() => session?.streaming ?? false)
const messages = computed(() => session?.messages ?? [])

/** 保险库门检查：已建库且已解锁才进对话 */
async function checkVault(): Promise<void> {
  vaultChecking.value = true
  try {
    const st = await vaultStatus(props.invoke)
    if (st?.exists && st?.unlocked) {
      vaultReady.value = true
      await initChat()
    } else {
      vaultReady.value = false
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
  session = new NestChatSession({
    invoke: props.invoke,
    subscribe: props.subscribe,
    lang: props.lang,
    log: (level, msg) => console[level === 'error' ? 'error' : 'warn'](`[nest] ${msg}`),
  })
  // 消息数组包响应式代理：流式增量（session 内部就地修改）可驱动 UI
  session.messages = reactive(session.messages)
  try {
    await session.refreshProviders()
    providers.value = [...session.providers]
    await refreshKeySet()
    await session.refreshConversations()
    syncConversations()
    // 自动打开最近会话（没有则留空态）
    const latest = session.conversations[0]
    if (latest) {
      await session.openConversation(latest.id)
    }
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

function disposeSession(): void {
  session?.dispose()
  session = null
  providers.value = []
  keySet.value = {}
  conversations.value = []
}

function syncConversations(): void {
  if (!session) return
  conversations.value = session.conversations.map((c) => ({
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
    const id = await session.createConversation('companion')
    await session.openConversation(id)
    syncConversations()
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
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

onMounted(() => {
  void checkVault()
})

onBeforeUnmount(() => {
  disposeSession()
})
</script>

<template>
  <div class="nest-chat">
    <!-- 保险库门：未建库 / 未解锁先走 VaultView（票 07） -->
    <VaultView v-if="!vaultReady" :invoke="invoke" :t="t" @changed="checkVault" />

    <template v-else>
      <div class="nest-chat__body" data-testid="nest-chat">
        <!-- 会话列表侧栏 -->
        <aside v-if="!showSettings" class="nest-chat__sidebar" data-testid="nest-sidebar">
          <button type="button" class="nest-chat__new" data-testid="nest-new-conversation" @click="onNewConversation">
            + {{ t('assistant.chat.newConversation') }}
          </button>
          <ul class="nest-chat__conversations">
            <li
              v-for="c in conversations"
              :key="c.id"
              class="nest-chat__conversation"
              :class="{ 'nest-chat__conversation--active': c.id === session?.currentId }"
              data-testid="nest-conversation-item"
              @click="onOpenConversation(c.id)"
            >
              {{ c.title }}
            </li>
          </ul>
          <button type="button" class="nest-chat__settings-btn" data-testid="nest-open-settings" @click="showSettings = true">
            ⚙ {{ t('assistant.settings.title') }}
          </button>
        </aside>

        <!-- 主区：消息流 + 输入区 -->
        <main class="nest-chat__main">
          <MessageList :messages="messages" :streaming="streaming" :t="t" @retry="onRetry" />
          <Composer
            :streaming="streaming"
            :error-message="composerError"
            :t="t"
            @send="onSend"
            @stop="onStop"
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
