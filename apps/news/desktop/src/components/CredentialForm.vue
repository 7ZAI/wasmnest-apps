<template>
  <form
    class="news-form"
    data-news-credential-form
    data-testid="news-credential-form"
    @submit.prevent="submit"
  >
    <div class="news-form-grid">
      <label class="news-field">
        <span>{{ t('news.settings.credentials.label') }}</span>
        <input
          v-model="label"
          type="text"
          maxlength="60"
          :disabled="busy"
          data-news-credential-label
          data-testid="news-credential-label"
        />
      </label>
      <div class="news-field">
        <Select
          v-model="kind"
          :options="kindOptions"
          :label="t('news.settings.sourceForm.kind')"
          :disabled="busy"
          size="md"
          data-news-credential-kind
          data-testid="news-credential-kind"
        />
      </div>
      <label class="news-field news-field-wide">
        <span>{{ t('news.settings.credentials.cookie') }}</span>
        <input
          v-model="cookie"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          data-news-credential-cookie
          data-testid="news-credential-cookie"
        />
      </label>
      <label class="news-field news-field-wide">
        <span>{{ t('news.settings.credentials.bearer') }}</span>
        <input
          v-model="bearer"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          data-news-credential-bearer
          data-testid="news-credential-bearer"
        />
      </label>
      <label class="news-field news-field-wide">
        <span>{{ t('news.settings.credentials.csrf') }}</span>
        <input
          v-model="csrfToken"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          data-news-credential-csrf
          data-testid="news-credential-csrf"
        />
      </label>
    </div>
    <p
      v-if="error"
      class="news-form-error"
      role="alert"
      data-news-credential-form-error
      data-testid="news-credential-form-error"
    >
      {{ error }}
    </p>
    <p class="news-form-note">{{ t('news.settings.credentials.plaintext') }}</p>
    <div class="news-form-actions">
      <button
        type="submit"
        class="news-primary"
        :disabled="busy"
        data-news-credential-save
        data-testid="news-credential-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-link-btn"
        :disabled="busy"
        data-testid="news-credential-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/**
 * 凭据表单（实验性源）：录入 Cookie / Bearer / CSRF。
 *
 * 输入框一律 `type="password"`——已保存值不回显，只在列表里显示末四位。
 */
import { computed, inject, ref } from 'vue'
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { CredentialDraft } from '../composables/useSettings'

const props = defineProps<{ draft?: CredentialDraft; busy: boolean }>()
const emit = defineEmits<{ submit: [draft: CredentialDraft]; cancel: [] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const label = ref(props.draft?.label ?? '')
const kind = ref(props.draft?.kind ?? 'x-graphql')
const cookie = ref('')
const bearer = ref('')
const csrfToken = ref('')
const error = ref('')

const kindOptions = computed(() => [
  { value: 'x-graphql', label: t('news.settings.sources.kind.x-graphql') },
  { value: 'ig-graphql', label: t('news.settings.sources.kind.ig-graphql') },
])

function submit(): void {
  error.value = ''
  if (!label.value.trim()) {
    error.value = t('news.settings.sourceForm.nameRequired')
    return
  }
  if (!cookie.value.trim() && !bearer.value.trim()) {
    error.value = t('news.settings.credentials.secretRequired')
    return
  }
  emit('submit', {
    id: props.draft?.id,
    kind: kind.value,
    label: label.value.trim(),
    cookie: cookie.value,
    bearer: bearer.value,
    csrfToken: csrfToken.value,
  })
}

defineExpose({
  showError(message: string) {
    error.value = message
  },
})
</script>

<style scoped>
.news-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0 18px;
  border-bottom: 1px solid var(--border);
}
.news-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.news-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: var(--font-size-label, 12px);
  color: var(--text-secondary);
}
.news-field-wide {
  grid-column: 1 / -1;
}
.news-field input {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-input, var(--border));
  border-radius: var(--radius-button, 8px);
  background: var(--bg-page);
  color: var(--text-primary);
  font-size: var(--font-size-body, 13px);
}
.news-field input:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 1px;
}
/* 宿主共享 Select 的内部结构：标签与触发按钮对齐本应用的字段刻度 */
.news-field :deep(.form-group) {
  width: 100%;
}
.news-field :deep(label) {
  margin-bottom: 0;
  font-size: var(--font-size-label, 12px);
  font-weight: 500;
  color: var(--text-secondary);
}
.news-field :deep(button) {
  height: 34px;
  border-radius: var(--radius-button, 8px);
  font-size: var(--font-size-body, 13px);
}
.news-form-error {
  margin: 0;
  font-size: var(--font-size-label, 12px);
  color: var(--color-danger-ink);
}
.news-form-note {
  margin: 0;
  font-size: var(--font-size-label, 12px);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.news-form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.news-primary {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-button, 8px);
  background: var(--color-primary);
  color: var(--bg-page);
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  cursor: pointer;
}
.news-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.news-link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-label, 12px);
  cursor: pointer;
}
.news-link-btn:hover {
  color: var(--text-primary);
}
@media (max-width: 720px) {
  .news-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
