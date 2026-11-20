<template>
  <form
    class="news-ms-form"
    data-mobile-news-source-form
    data-testid="mobile-news-source-form"
    @submit.prevent="submit"
  >
    <label class="news-ms-field">
      <span>{{ t('news.settings.sourceForm.name') }}</span>
      <input
        v-model="name"
        type="text"
        maxlength="80"
        :disabled="busy"
        data-mobile-news-source-name
        data-testid="mobile-news-source-name"
      />
    </label>

    <div class="news-ms-field">
      <span>{{ t('news.settings.sourceForm.kind') }}</span>
      <SelectField
        v-model="kind"
        :options="kindOptions"
        :disabled="busy || !!draft.id"
        :aria-label="t('news.settings.sourceForm.kind')"
        data-mobile-news-source-kind
        data-testid="mobile-news-source-kind"
      />
    </div>

    <label class="news-ms-field">
      <span>{{ t('news.settings.sourceForm.url') }}</span>
      <input
        v-model="url"
        type="url"
        inputmode="url"
        spellcheck="false"
        :disabled="busy"
        data-mobile-news-source-url
        data-testid="mobile-news-source-url"
      />
      <small v-if="kind === 'youtube-rss'">{{ t('news.settings.sourceForm.youtubeHint') }}</small>
      <small v-else-if="kind === 'reddit'">{{ t('news.settings.sourceForm.redditHint') }}</small>
    </label>

    <div class="news-ms-row">
      <div class="news-ms-field">
        <span>{{ t('news.settings.sourceForm.weight') }}</span>
        <WeightField
          v-model="weight"
          :disabled="busy"
          :aria-label="t('news.settings.sourceForm.weight')"
          data-mobile-news-source-weight
          data-testid="mobile-news-source-weight"
        />
      </div>
      <div class="news-ms-field">
        <span>{{ t('news.settings.sourceForm.circle') }}</span>
        <SelectField
          v-model="circleId"
          :options="circleOptions"
          :disabled="busy"
          :aria-label="t('news.settings.sourceForm.circle')"
          data-mobile-news-source-circle
          data-testid="mobile-news-source-circle"
        />
      </div>
    </div>

    <div v-if="needsCredential" class="news-ms-field">
      <span>{{ t('news.settings.sourceForm.credential') }}</span>
      <SelectField
        v-model="authId"
        :options="credentialOptions"
        :disabled="busy"
        :aria-label="t('news.settings.sourceForm.credential')"
        data-mobile-news-source-credential
        data-testid="mobile-news-source-credential"
      />
    </div>

    <p
      v-if="error"
      class="news-ms-error"
      role="alert"
      data-mobile-news-source-form-error
      data-testid="mobile-news-source-form-error"
    >
      {{ error }}
    </p>
    <p class="news-ms-note">{{ t('news.settings.sources.netAuthHint') }}</p>

    <div class="news-ms-actions">
      <button
        type="submit"
        class="news-ms-primary"
        :disabled="busy"
        data-mobile-news-source-save
        data-testid="mobile-news-source-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-ms-link"
        :disabled="busy"
        data-testid="mobile-news-source-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/** 移动端源表单：校验口径与桌面一致（名称 / 地址 / 重复 / 实验性源需凭据）。 */
import { computed, inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { CredentialSummary, NewsCircle } from '../types'
import { EXPERIMENTAL_KINDS, SELECTABLE_KINDS } from '../types'
import type { SourceDraft } from '../composables/useSettings'
import { clampWeight } from '../utils/format'
import SelectField from './SelectField.vue'
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
  SELECTABLE_KINDS.map((value) => ({
    value,
    label: t(`news.settings.sources.kind.${value}`),
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
</script>

<style scoped>
.news-ms-form {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-3);
  padding: var(--news-space-4) 0;
}
.news-ms-row {
  display: flex;
  gap: var(--news-space-3);
}
.news-ms-row > * {
  flex: 1;
  min-width: 0;
}
.news-ms-field {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-2);
  min-width: 0;
  font-size: var(--news-text-body);
  line-height: 1.5;
  color: var(--news-text-secondary);
}
.news-ms-field input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-input);
  color: var(--news-text-primary);
  font-family: inherit;
  font-size: 16px;
}
.news-ms-field input::placeholder {
  color: var(--news-text-tertiary);
  opacity: 1;
}
.news-ms-field input:focus-visible {
  border-color: var(--news-accent);
  outline: 2px solid var(--news-accent);
  outline-offset: 1px;
}
.news-ms-field small {
  font-size: var(--news-text-meta);
  line-height: 1.5;
  color: var(--news-text-tertiary);
}
.news-ms-error {
  margin: 0;
  font-size: 12px;
  color: var(--news-danger);
}
.news-ms-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--news-text-tertiary);
}
.news-ms-actions {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
}
.news-ms-primary {
  height: 44px;
  padding: 0 var(--news-space-4);
  border: 0;
  border-radius: var(--news-radius-control);
  background: var(--news-accent);
  color: var(--news-on-accent);
  font-size: var(--news-text-body);
  font-weight: 600;
  cursor: pointer;
}
.news-ms-primary:disabled {
  opacity: 0.5;
}
.news-ms-link {
  min-height: 24px;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--news-accent-ink);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
