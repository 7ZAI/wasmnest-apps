<template>
  <form
    class="news-ms-form"
    data-mobile-news-circle-form
    data-testid="mobile-news-circle-form"
    @submit.prevent="submit"
  >
    <label class="news-ms-field">
      <span>{{ t('news.settings.circles.name') }}</span>
      <input
        v-model="name"
        type="text"
        maxlength="40"
        :disabled="busy"
        data-mobile-news-circle-name
        data-testid="mobile-news-circle-name"
      />
    </label>
    <div class="news-ms-field">
      <span>{{ t('news.settings.circles.weight') }}</span>
      <WeightField
        v-model="weight"
        :disabled="busy"
        :aria-label="t('news.settings.circles.weight')"
        data-mobile-news-circle-weight
        data-testid="mobile-news-circle-weight"
      />
    </div>
    <p
      v-if="error"
      class="news-ms-error"
      role="alert"
      data-mobile-news-circle-form-error
      data-testid="mobile-news-circle-form-error"
    >
      {{ error }}
    </p>
    <div class="news-ms-actions">
      <button
        type="submit"
        class="news-ms-primary"
        :disabled="busy"
        data-mobile-news-circle-save
        data-testid="mobile-news-circle-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-ms-link"
        :disabled="busy"
        data-testid="mobile-news-circle-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/** 移动端圈子表单：名称必填、同名拒绝、权重夹到 0.5–2.0。 */
import { inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { clampWeight } from '../utils/format'
import WeightField from './WeightField.vue'

const props = defineProps<{
  id?: string
  initialName: string
  initialWeight: number
  existingNames: string[]
  busy: boolean
}>()
const emit = defineEmits<{
  submit: [{ id?: string; name: string; weight: number }]
  cancel: []
}>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const name = ref(props.initialName)
const weight = ref(props.initialWeight)
const error = ref('')

function submit(): void {
  error.value = ''
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('news.settings.circles.nameRequired')
    return
  }
  const duplicate = props.existingNames.some(
    (existing) =>
      existing.toLowerCase() === trimmed.toLowerCase() && existing !== props.initialName,
  )
  if (duplicate) {
    error.value = t('news.settings.circles.duplicate')
    return
  }
  emit('submit', { id: props.id, name: trimmed, weight: clampWeight(Number(weight.value)) })
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
