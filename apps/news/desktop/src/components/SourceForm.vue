<template>
  <form
    class="news-form"
    data-news-source-form
    data-testid="news-source-form"
    @submit.prevent="submit"
  >
    <div class="news-form-grid">
      <label class="news-field">
        <span>{{ t('news.settings.sourceForm.name') }}</span>
        <input
          v-model="name"
          type="text"
          maxlength="80"
          :disabled="busy"
          data-news-source-name
          data-testid="news-source-name"
        />
      </label>

      <div class="news-field">
        <Select
          v-model="kind"
          :options="kindOptions"
          :label="t('news.settings.sourceForm.kind')"
          :disabled="busy || !!draft.id"
          size="md"
          data-news-source-kind
          data-testid="news-source-kind"
        />
      </div>

      <label class="news-field news-field-wide">
        <span>{{ t('news.settings.sourceForm.url') }}</span>
        <input
          v-model="url"
          type="url"
          inputmode="url"
          spellcheck="false"
          :disabled="busy"
          data-news-source-url
          data-testid="news-source-url"
        />
        <small v-if="kind === 'youtube-rss'">{{ t('news.settings.sourceForm.youtubeHint') }}</small>
        <small v-else-if="kind === 'reddit'">{{ t('news.settings.sourceForm.redditHint') }}</small>
      </label>

      <div class="news-field">
        <span class="news-field-label">{{ t('news.settings.sourceForm.weight') }}</span>
        <WeightField
          v-model="weight"
          :min="0.5"
          :max="2"
          :step="0.1"
          :disabled="busy"
          :aria-label="t('news.settings.sourceForm.weight')"
          data-news-source-weight
          data-testid="news-source-weight"
        />
      </div>

      <div class="news-field">
        <Select
          v-model="circleId"
          :options="circleOptions"
          :label="t('news.settings.sourceForm.circle')"
          :disabled="busy"
          size="md"
          data-news-source-circle
          data-testid="news-source-circle"
        />
      </div>

      <div v-if="needsCredential" class="news-field news-field-wide">
        <Select
          v-model="authId"
          :options="credentialOptions"
          :label="t('news.settings.sourceForm.credential')"
          :disabled="busy"
          size="md"
          data-news-source-credential
          data-testid="news-source-credential"
        />
      </div>
    </div>

    <p
      v-if="error"
      class="news-form-error"
      role="alert"
      data-news-source-form-error
      data-testid="news-source-form-error"
    >
      {{ error }}
    </p>
    <p class="news-form-note">{{ t('news.settings.sources.netAuthHint') }}</p>

    <div class="news-form-actions">
      <button
        type="submit"
        class="news-primary"
        :disabled="busy"
        data-news-source-save
        data-testid="news-source-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-link-btn"
        :disabled="busy"
        data-testid="news-source-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/**
 * 源表单（新增 / 编辑共用）。
 *
 * 校验在提交前先本地跑一遍（名称 / 地址 / 重复 URL / 实验性源缺凭据），
 * 服务端仍会再校验一次——两边用同一套判据的不同实现，前端只为即时反馈。
 *
 * 控件口径：下拉一律用宿主共享 Select（原生 `<select>` 不吃 token、不吃
 * `--ui-scale`，且与宿主主题脱钩）；权重用本应用的步进器（0.1 步进）。
 */
import { computed, inject, ref } from 'vue'
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { CredentialSummary, NewsCircle } from '../types'
import { EXPERIMENTAL_KINDS, SELECTABLE_KINDS } from '../types'
import type { SourceDraft } from '../composables/useSettings'
import { clampWeight } from '../utils/format'
import { parseError } from '../utils/errors'
import WeightField from './WeightField.vue'

const props = defineProps<{
  draft: SourceDraft
  circles: NewsCircle[]
  credentials: CredentialSummary[]
  busy: boolean
  existingUrls: string[]
}>()
const emit = defineEmits<{ submit: [draft: SourceDraft]; cancel: [] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const name = ref(props.draft.name)
const kind = ref(props.draft.kind)
const url = ref(props.draft.url)
const weight = ref(props.draft.weight)
const circleId = ref(props.draft.circleId ?? '')
const authId = ref(props.draft.authId ?? '')
const error = ref('')

const needsCredential = computed(() =>
  (EXPERIMENTAL_KINDS as readonly string[]).includes(kind.value),
)

const kindOptions = computed(() =>
  SELECTABLE_KINDS.map((option) => ({
    value: option,
    label: t(`news.settings.sources.kind.${option}`),
  })),
)

const circleOptions = computed(() => [
  { value: '', label: t('news.view.ungrouped') },
  ...props.circles.map((circle) => ({ value: circle.id, label: circle.name })),
])

const credentialOptions = computed(() => [
  { value: '', label: t('news.settings.sources.credentialMissing') },
  ...props.credentials.map((credential) => ({
    value: credential.id,
    label: `${credential.label} · ···${credential.tail}`,
  })),
])

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim())
}

function submit(): void {
  error.value = ''
  const trimmedName = name.value.trim()
  const trimmedUrl = url.value.trim()
  if (!trimmedName) {
    error.value = t('news.settings.sourceForm.nameRequired')
    return
  }
  if (!trimmedUrl) {
    error.value = t('news.settings.sourceForm.urlRequired')
    return
  }
  if (!looksLikeUrl(trimmedUrl)) {
    error.value = t('news.settings.sourceForm.invalidUrl')
    return
  }
  const normalized = trimmedUrl.replace(/\/+$/, '')
  const duplicate = props.existingUrls.some(
    (existing) => existing.replace(/\/+$/, '') === normalized && existing !== props.draft.url,
  )
  if (duplicate) {
    error.value = t('news.settings.sourceForm.duplicateUrl')
    return
  }
  if (needsCredential.value && !authId.value) {
    error.value = t('news.settings.sourceForm.authRequired')
    return
  }
  emit('submit', {
    id: props.draft.id,
    name: trimmedName,
    kind: kind.value,
    url: trimmedUrl,
    circleId: circleId.value || null,
    weight: clampWeight(Number(weight.value)),
    enabled: props.draft.enabled ?? true,
    authId: authId.value || null,
  })
}

/** 后端拒绝时把分类码翻成文案（重复 URL / 非法地址都在这里兜底）。 */
defineExpose({
  showError(raw: unknown) {
    const parsed = parseError(raw)
    error.value = parsed.detail || t(`news.error.${parsed.code}`)
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
.news-field-label {
  display: block;
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
.news-field small {
  font-size: var(--font-size-tag, 11px);
  color: var(--text-tertiary);
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
