<script setup lang="ts">
/**
 * Nest 保险库视图（共享组件，双端同构 · 票 07 / spec §5.8）
 *
 * 双端入口把宿主适配后的命令调用面（桌面 `env.appInvoke` / 移动
 * `context.commands.execute`）收敛为 [`AssistantInvoke`] 同形传入。组件本身
 * 不依赖端侧 API，只经 `useI18n` 取译文（双端 i18n 均以
 * `com.wasmnest.assistant.*` 命名空间注册，key 一致）。
 *
 * 状态机（fail-visible，spec §2.4）：
 * - 未建库 → 首次设置（设口令 → init）
 * - 已建库 + 锁定 → 解锁
 * - 已解锁 → 显示状态 + 锁定 / 改口令
 * 任何失败原样上交 Rust 的错误文案，不静默吞错。
 */
import { computed, onMounted, ref } from 'vue'
import {
  vaultChangePassword,
  vaultInit,
  vaultLock,
  vaultStatus,
  vaultUnlock,
} from '../vault'
import type { AssistantInvoke, VaultStatus } from '../types'

const props = defineProps<{
  /** 命令调用面（双端同形） */
  invoke: AssistantInvoke
  /** 翻译函数（各端 i18n 绑定；key 为域内 key，端侧加命名空间前缀） */
  t: (key: string) => string
}>()

/** 保险库状态变化（init / unlock / lock / 改口令成功后）：供父级门控感知 */
const emit = defineEmits<{ changed: [] }>()

const status = ref<VaultStatus | null>(null)
const loading = ref(false)
const error = ref('')

// 表单状态
const setupPassword = ref('')
const setupPassword2 = ref('')
const unlockPassword = ref('')
const changeOld = ref('')
const changeNew = ref('')
const changeNew2 = ref('')

const phase = computed<'loading' | 'setup' | 'unlock' | 'ready'>(() => {
  if (loading.value) return 'loading'
  if (!status.value?.exists) return 'setup'
  if (!status.value.unlocked) return 'unlock'
  return 'ready'
})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    status.value = await vaultStatus(props.invoke)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function doInit() {
  if (setupPassword.value.length < 4) {
    error.value = props.t('assistant.vault.passwordTooShort')
    return
  }
  if (setupPassword.value !== setupPassword2.value) {
    error.value = props.t('assistant.vault.passwordMismatch')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await vaultInit(props.invoke, { password: setupPassword.value })
    setupPassword.value = ''
    setupPassword2.value = ''
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function doUnlock() {
  loading.value = true
  error.value = ''
  try {
    await vaultUnlock(props.invoke, unlockPassword.value)
    unlockPassword.value = ''
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function doLock() {
  loading.value = true
  error.value = ''
  try {
    await vaultLock(props.invoke)
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function doChangePassword() {
  if (changeNew.value.length < 4) {
    error.value = props.t('assistant.vault.passwordTooShort')
    return
  }
  if (changeNew.value !== changeNew2.value) {
    error.value = props.t('assistant.vault.passwordMismatch')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await vaultChangePassword(props.invoke, {
      oldPassword: changeOld.value,
      newPassword: changeNew.value,
    })
    changeOld.value = ''
    changeNew.value = ''
    changeNew2.value = ''
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="nest-vault" data-testid="nest-vault">
    <div class="nest-vault__card">
      <div class="nest-vault__head">
        <div class="nest-vault__icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="40" height="40">
            <path
              d="M8 30c4-8 10-12 16-12s12 4 16 12c0 8-8 12-16 12S8 38 8 30z"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
            <circle cx="24" cy="26" r="4.5" fill="currentColor" />
          </svg>
        </div>
        <div>
          <h1 class="nest-vault__title">{{ t('assistant.vault.title') }}</h1>
          <p class="nest-vault__subtitle">{{ t('assistant.vault.subtitle') }}</p>
        </div>
      </div>

      <!-- 状态条 -->
      <div class="nest-vault__status" data-testid="nest-vault-status">
        <span
          class="nest-vault__badge"
          :class="status?.unlocked ? 'nest-vault__badge--ok' : 'nest-vault__badge--locked'"
        >
          {{ status?.unlocked ? t('assistant.vault.unlocked') : t('assistant.vault.locked') }}
        </span>
      </div>

      <!-- 加载 / 错误 -->
      <p v-if="loading" class="nest-vault__hint">{{ t('assistant.vault.loading') }}</p>
      <p v-if="error" class="nest-vault__error" data-testid="nest-vault-error">{{ error }}</p>

      <!-- 首次设置 -->
      <form v-if="phase === 'setup'" class="nest-vault__form" @submit.prevent="doInit">
        <p class="nest-vault__desc">{{ t('assistant.vault.setupDesc') }}</p>
        <label class="nest-vault__field">
          <span>{{ t('assistant.vault.password') }}</span>
          <input v-model="setupPassword" type="password" autocomplete="new-password" />
        </label>
        <label class="nest-vault__field">
          <span>{{ t('assistant.vault.passwordConfirm') }}</span>
          <input v-model="setupPassword2" type="password" autocomplete="new-password" />
        </label>
        <button type="submit" class="nest-vault__btn nest-vault__btn--primary" :disabled="loading">
          {{ t('assistant.vault.setup') }}
        </button>
      </form>

      <!-- 解锁 -->
      <form v-else-if="phase === 'unlock'" class="nest-vault__form" @submit.prevent="doUnlock">
        <p class="nest-vault__desc">{{ t('assistant.vault.unlockDesc') }}</p>
        <label class="nest-vault__field">
          <span>{{ t('assistant.vault.password') }}</span>
          <input v-model="unlockPassword" type="password" autocomplete="current-password" />
        </label>
        <button type="submit" class="nest-vault__btn nest-vault__btn--primary" :disabled="loading">
          {{ t('assistant.vault.unlock') }}
        </button>
      </form>

      <!-- 已解锁：锁定 / 改口令 -->
      <div v-else-if="phase === 'ready'" class="nest-vault__actions">
        <button class="nest-vault__btn" :disabled="loading" @click="doLock">
          {{ t('assistant.vault.lock') }}
        </button>
        <details class="nest-vault__change">
          <summary>{{ t('assistant.vault.changePassword') }}</summary>
          <form class="nest-vault__form" @submit.prevent="doChangePassword">
            <label class="nest-vault__field">
              <span>{{ t('assistant.vault.currentPassword') }}</span>
              <input v-model="changeOld" type="password" autocomplete="current-password" />
            </label>
            <label class="nest-vault__field">
              <span>{{ t('assistant.vault.newPassword') }}</span>
              <input v-model="changeNew" type="password" autocomplete="new-password" />
            </label>
            <label class="nest-vault__field">
              <span>{{ t('assistant.vault.passwordConfirm') }}</span>
              <input v-model="changeNew2" type="password" autocomplete="new-password" />
            </label>
            <button type="submit" class="nest-vault__btn nest-vault__btn--primary" :disabled="loading">
              {{ t('assistant.vault.changePassword') }}
            </button>
          </form>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nest-vault {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100%;
  padding: 2rem 1.5rem;
  background: var(--bg-page, #f6f7f9);
  color: var(--text-primary, #1f2329);
}

.nest-vault__card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 26rem;
  padding: 1.75rem 1.5rem;
  border: 1px solid var(--border-secondary, #e5e6eb);
  border-radius: var(--radius-card, 12px);
  background: var(--bg-surface, #ffffff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
}

.nest-vault__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.nest-vault__icon {
  color: var(--accent-primary, #2f6fed);
  flex-shrink: 0;
}

.nest-vault__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.nest-vault__subtitle {
  margin: 0.125rem 0 0;
  font-size: 0.8125rem;
  opacity: 0.65;
}

.nest-vault__status {
  display: flex;
}

.nest-vault__badge {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.2rem 0.7rem;
  border-radius: 999px;
}

.nest-vault__badge--ok {
  color: var(--success, #1a7f37);
  background: var(--success-bg, #e8f5ec);
}

.nest-vault__badge--locked {
  color: var(--text-secondary, #646a73);
  background: var(--bg-hover, #f2f3f5);
}

.nest-vault__hint {
  margin: 0;
  font-size: 0.8125rem;
  opacity: 0.6;
}

.nest-vault__error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger, #d4380d);
  word-break: break-all;
}

.nest-vault__desc {
  margin: 0;
  font-size: 0.8125rem;
  opacity: 0.75;
  line-height: 1.5;
}

.nest-vault__form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.nest-vault__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.8125rem;
}

.nest-vault__field input {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border-secondary, #d0d3d9);
  border-radius: var(--radius-input, 8px);
  background: var(--bg-input, #ffffff);
  color: var(--text-primary, #1f2329);
  font-size: 0.875rem;
}

.nest-vault__field input:focus {
  outline: none;
  border-color: var(--accent-primary, #2f6fed);
  box-shadow: 0 0 0 3px var(--accent-bg, #eaf1fe);
}

.nest-vault__btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-secondary, #d0d3d9);
  border-radius: var(--radius-btn, 8px);
  background: var(--bg-surface, #ffffff);
  color: var(--text-primary, #1f2329);
  font-size: 0.875rem;
  cursor: pointer;
}

.nest-vault__btn:hover:not(:disabled) {
  background: var(--bg-hover, #f2f3f5);
}

.nest-vault__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nest-vault__btn--primary {
  background: var(--accent-primary, #2f6fed);
  border-color: var(--accent-primary, #2f6fed);
  color: #ffffff;
}

.nest-vault__btn--primary:hover:not(:disabled) {
  background: var(--accent-primary-hover, #2557d6);
}

.nest-vault__actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.nest-vault__change summary {
  font-size: 0.8125rem;
  cursor: pointer;
  opacity: 0.8;
}

.nest-vault__change[open] summary {
  margin-bottom: 0.75rem;
}
</style>
