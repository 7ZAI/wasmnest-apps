<template>
  <div
    class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    data-testid="settings-dialog"
    @mousedown.self="$emit('close')"
  >
    <div
      ref="cardEl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings')"
      class="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-card)]"
    >
      <div class="flex items-center justify-between border-b border-[var(--border)] p-4">
        <h2 class="text-[length:var(--font-size-lg)] font-semibold text-[var(--text-primary)]">
          {{ t('settings') }}
        </h2>
        <button
          type="button"
          class="rounded-[var(--radius-button)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          data-testid="settings-close"
          @click="$emit('close')"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="flex-1 space-y-5 overflow-y-auto p-4">
        <section class="space-y-3">
          <h3 class="text-[length:var(--font-size-sm)] font-medium text-[var(--text-secondary)]">
            {{ t('settingsSectionEditor') }}
          </h3>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('autoSaveMode') }}</span>
            <SelectField
              v-model="draft.autoSaveMode"
              :options="autoSaveOptions"
              :label="t('autoSaveMode')"
              testid="setting-auto-save-mode"
            />
          </div>

          <div
            v-if="draft.autoSaveMode === 'realtime'"
            class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]"
          >
            <span class="mb-1 block">{{ t('autoSaveDebounce') }}</span>
            <NumberField
              v-model="draft.autoSaveDebounce"
              :min="MIN_AUTO_SAVE_DEBOUNCE"
              :max="MAX_AUTO_SAVE_DEBOUNCE"
              :step="100"
              :label="t('autoSaveDebounce')"
              testid="setting-auto-save-debounce"
            />
          </div>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('fontSize') }} · {{ draft.fontSize }}px</span>
            <RangeField
              v-model="draft.fontSize"
              :min="MIN_FONT_SIZE"
              :max="MAX_FONT_SIZE"
              :label="t('fontSize')"
              testid="setting-font-size"
            />
          </div>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('fontFamily') }}</span>
            <SelectField
              v-model="draft.fontFamily"
              :options="fontOptions"
              :label="t('fontFamily')"
              testid="setting-font-family"
            />
          </div>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('theme') }}</span>
            <SelectField
              v-model="draft.theme"
              :options="themeOptions"
              :label="t('theme')"
              testid="setting-theme"
            />
          </div>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('language') }}</span>
            <SelectField
              v-model="draft.language"
              :options="languageOptions"
              :label="t('language')"
              testid="setting-language"
              @update:model-value="onLanguageChange"
            />
          </div>
        </section>

        <section class="space-y-3 border-t border-[var(--border)] pt-4">
          <h3 class="text-[length:var(--font-size-sm)] font-medium text-[var(--text-secondary)]">
            {{ t('timeDividerSettings') }}
          </h3>

          <label
            class="custom-check flex items-center gap-2 text-[length:var(--font-size-sm)] text-[var(--text-primary)]"
          >
            <input
              v-model="draft.timeDivider.enabled"
              type="checkbox"
              class="sr-only custom-check-input"
              data-testid="setting-divider-enabled"
            />
            <span class="custom-check-box" aria-hidden="true">
              <svg class="custom-check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="3"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </span>
            <span>{{ t('timeDividerEnabled') }}</span>
          </label>

          <label
            class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]"
            for="setting-divider-format-input"
          >
            <span class="mb-1 block">{{ t('timeDividerFormat') }}</span>
            <input
              id="setting-divider-format-input"
              v-model="draft.timeDivider.format"
              type="text"
              class="settings-input font-mono"
              data-testid="setting-divider-format"
            />
            <span class="mt-1 block text-[length:var(--font-size-xs)] text-[var(--text-tertiary)]">
              {{ t('timeDividerFormatHint') }}
            </span>
          </label>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('timeDividerPosition') }}</span>
            <SelectField
              v-model="draft.timeDivider.position"
              :options="positionOptions"
              :label="t('timeDividerPosition')"
              testid="setting-divider-position"
            />
          </div>

          <div class="block text-[length:var(--font-size-sm)] text-[var(--text-primary)]">
            <span class="mb-1 block">{{ t('timeDividerInterval') }}</span>
            <SelectField
              v-model="draft.timeDivider.triggerInterval"
              :options="intervalOptions"
              :label="t('timeDividerInterval')"
              testid="setting-divider-interval"
            />
          </div>
        </section>
      </div>

      <div class="flex justify-end gap-2 border-t border-[var(--border)] p-4">
        <button
          type="button"
          class="h-8 rounded-[var(--radius-button)] bg-[var(--bg-hover)] px-4 text-[length:var(--font-size-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
          data-testid="settings-cancel"
          @click="$emit('close')"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="button"
          class="h-8 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-4 text-[length:var(--font-size-sm)] text-[var(--color-primary-contrast)] transition-colors hover:bg-[var(--color-primary-hover)]"
          data-testid="settings-save"
          @click="save"
        >
          {{ t('save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import NumberField from './NumberField.vue'
import RangeField from './RangeField.vue'
import SelectField from './SelectField.vue'
import { useI18n } from '../composables/useI18n'
import { useModalFocus } from '../composables/useModalFocus'
import {
  DIVIDER_INTERVALS,
  MAX_AUTO_SAVE_DEBOUNCE,
  MAX_FONT_SIZE,
  MIN_AUTO_SAVE_DEBOUNCE,
  MIN_FONT_SIZE,
  type AutoSaveMode,
  type DividerPosition,
  type FontFamily,
  type Locale,
  type NoteSettings,
  type ThemeMode,
} from '../types'

const props = defineProps<{
  settings: NoteSettings
}>()

const emit = defineEmits<{
  close: []
  save: [settings: NoteSettings]
  'language-change': [locale: Locale]
}>()

const { t } = useI18n()
const cardEl = ref<HTMLElement | null>(null)
useModalFocus(cardEl, () => emit('close'))

const draft = reactive<NoteSettings>(clone(props.settings))

const autoSaveOptions = computed<{ value: AutoSaveMode; label: string }[]>(() => [
  { value: 'realtime', label: t('autoSaveRealtime') },
  { value: 'onBlur', label: t('autoSaveOnBlur') },
  { value: 'manual', label: t('autoSaveManual') },
])
const fontOptions = computed<{ value: FontFamily; label: string }[]>(() => [
  { value: 'monospace', label: t('fontMonospace') },
  { value: 'sans-serif', label: t('fontSansSerif') },
  { value: 'serif', label: t('fontSerif') },
])
const themeOptions = computed<{ value: ThemeMode; label: string }[]>(() => [
  { value: 'system', label: t('themeSystem') },
  { value: 'light', label: t('themeLight') },
  { value: 'dark', label: t('themeDark') },
])
const languageOptions: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]
const positionOptions = computed<{ value: DividerPosition; label: string }[]>(() => [
  { value: 'top', label: t('positionTop') },
  { value: 'bottom', label: t('positionBottom') },
  { value: 'cursor', label: t('positionCursor') },
])
const intervalOptions = computed<{ value: number; label: string }[]>(() =>
  DIVIDER_INTERVALS.map((value) => ({
    value,
    label: value === 0 ? t('intervalOff') : t('intervalMinutes', { count: value }),
  })),
)

function clone(settings: NoteSettings): NoteSettings {
  return {
    ...settings,
    timeDivider: { ...settings.timeDivider },
  }
}

watch(
  () => props.settings,
  (settings) => Object.assign(draft, clone(settings)),
  { deep: true },
)

function onLanguageChange(locale: string | number): void {
  emit('language-change', locale as Locale)
}

function save(): void {
  draft.autoSaveDebounce = Math.min(
    MAX_AUTO_SAVE_DEBOUNCE,
    Math.max(MIN_AUTO_SAVE_DEBOUNCE, draft.autoSaveDebounce || 500),
  )
  draft.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, draft.fontSize || 14))
  if (draft.timeDivider.format.trim() === '')
    draft.timeDivider.format = '--- {{date}} {{weekday}} {{time}} ---'
  emit('save', clone(draft))
}
</script>

<style scoped>
.settings-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
}
.settings-input:focus {
  border-color: var(--color-primary);
}

/* 自绘复选框（原生 input 只保留语义与键盘行为） */
.custom-check {
  cursor: pointer;
}
.custom-check-box {
  display: grid;
  place-content: center;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-input);
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}
.custom-check-input:checked + .custom-check-box {
  border-color: var(--color-primary);
  background: var(--color-primary);
}
.custom-check-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--color-primary-contrast);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.custom-check-input:checked + .custom-check-box .custom-check-icon {
  opacity: 1;
}
.custom-check-input:focus-visible + .custom-check-box {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
</style>
