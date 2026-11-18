<template>
  <form
    class="news-form"
    data-news-circle-form
    data-testid="news-circle-form"
    @submit.prevent="submit"
  >
    <div class="news-form-grid">
      <label class="news-field">
        <span>{{ t('news.settings.circles.name') }}</span>
        <input
          v-model="name"
          type="text"
          maxlength="40"
          :disabled="busy"
          data-news-circle-name
          data-testid="news-circle-name"
        />
      </label>
      <div class="news-field">
        <span class="news-field-label">{{ t('news.settings.circles.weight') }}</span>
        <WeightField
          v-model="weight"
          :min="0.5"
          :max="2"
          :step="0.1"
          :disabled="busy"
          :aria-label="t('news.settings.circles.weight')"
          data-news-circle-weight
          data-testid="news-circle-weight"
        />
      </div>
    </div>
    <p
      v-if="error"
      class="news-form-error"
      role="alert"
      data-news-circle-form-error
      data-testid="news-circle-form-error"
    >
      {{ error }}
    </p>
    <div class="news-form-actions">
      <button
        type="submit"
        class="news-primary"
        :disabled="busy"
        data-news-circle-save
        data-testid="news-circle-save"
      >
        {{ t('news.settings.sourceForm.save') }}
      </button>
      <button
        type="button"
        class="news-link-btn"
        :disabled="busy"
        data-testid="news-circle-cancel"
        @click="emit('cancel')"
      >
        {{ t('news.settings.sourceForm.cancel') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/** 圈子表单（新建 / 编辑）：名称必填、同名拒绝、权重夹取到 0.5–2.0。 */
import { inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
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
.news-field input:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 1px;
}
.news-form-error {
  margin: 0;
  font-size: var(--font-size-label, 12px);
  color: var(--color-danger-ink);
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
