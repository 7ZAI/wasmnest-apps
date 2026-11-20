<template>
  <form
    class="news-ms-form"
    data-mobile-news-credential-form
    data-testid="mobile-news-credential-form"
    @submit.prevent="submit"
  >
    <label class="news-ms-field">
      <span>{{ t('news.settings.credentials.label') }}</span>
      <input
        v-model="label"
        type="text"
        maxlength="60"
        :disabled="busy"
        data-mobile-news-credential-label
        data-testid="mobile-news-credential-label"
      />
    </label>
    <div class="news-ms-field">
      <span>{{ t('news.settings.sourceForm.kind') }}</span>
      <SelectField
        v-model="kind"
        :options="kindOptions"
        :disabled="busy"
        :aria-label="t('news.settings.sourceForm.kind')"
        data-mobile-news-credential-kind
        data-testid="mobile-news-credential-kind"
      />
    </div>
    <label class="news-ms-field">
      <span>{{ t('news.settings.credentials.cookie') }}</span>
      <input
        v-model="cookie"
        type="password"
        autocomplete="off"
        :disabled="busy"
        data-mobile-news-credential-cookie
        data-testid="mobile-news-credential-cookie"
      />
    </label>
    <label class="news-ms-field">
      <span>{{ t('news.settings.credentials.bearer') }}</span>
      <input
        v-model="bearer"
        type="password"
        autocomplete="off"
        :disabled="busy"
        data-mobile-news-credential-bearer
        data-testid="mobile-news-credential-bearer"
      />
    </label>
    <label class="news-ms-field">
      <span>{{ t('news.settings.credentials.csrf') }}</span>
      <input
        v-model="csrfToken"
        type="password"
        autocomplete="off"
        :disabled="busy"
        data-mobile-news-credential-csrf
        data-testid="mobile-news-credential-csrf"
      />
    </label>
    <p
      v-if="error"
      class="news-ms-error"
      role="alert"
      data-mobile-news-credential-form-error
      data-testid="mobile-news-credential-form-error"
    >
      {{ error }}
    </p>
    <p class="news-ms-note">{{ t('news.settings.credentials.plaintext') }}</p>
    <div class="news-ms-actions">
      <button
        type="submit"
        class="news-ms-primary"
        :disabled="busy"
        data-mobile-news-credential-save
        data-testid="mobile-news-credential-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-ms-link"
        :disabled="busy"
        data-testid="mobile-news-credential-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/** 移动端凭据表单：输入一律 password，已保存值只在列表里显示末四位。 */
import { inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { CredentialDraft } from '../composables/useSettings'
import SelectField from './SelectField.vue'

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

const kindOptions = [
  { value: 'x-graphql', label: t('news.settings.sources.kind.x-graphql') },
  { value: 'ig-graphql', label: t('news.settings.sources.kind.ig-graphql') },
]

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
</script>

<style scoped>
.news-ms-form {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-3);
  padding: var(--news-space-4) 0;
}
.news-ms-field {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-2);
  font-size: var(--news-text-body);
  line-height: 1.5;
  color: var(--news-text-secondary);
}
.news-ms-field input {
  box-sizing: border-box;
  width: 100%;
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
