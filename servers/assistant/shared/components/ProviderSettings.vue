<script setup lang="ts">
/**
 * Nest 供应商设置（共享组件，双端同构 · 票 08 / spec D6、D17）
 *
 * 供应商 CRUD（name / api_style / base_url / model）+ 密钥写入保险库 +
 * 设默认。**密钥不进 provider 表**：随保存一并写保险库密钥槽
 * （`provider:<id>`），由父级经 `assistant.vault-set-secret` 落库。
 * 纯展示 + 表单组件：命令调用由父级（ChatView）经 emit 上交。
 */
import { computed, reactive, ref } from 'vue'
import type { ProviderRecord } from '@nest-shared/types'

const props = defineProps<{
  providers: ProviderRecord[]
  /** providerId → 是否已设密钥（父级维护，不回显密钥内容） */
  keySet: Record<string, boolean>
  t: (key: string) => string
}>()

const emit = defineEmits<{
  upsert: [provider: ProviderRecord, apiKey: string]
  delete: [id: string]
  setDefault: [id: string]
  lockVault: []
  close: []
}>()

const form = reactive({ id: '', name: '', baseUrl: '', model: '', apiKey: '' })
const editingId = ref<string | null>(null)
const error = ref('')

const isEditing = computed(() => editingId.value !== null)

function startEdit(p: ProviderRecord): void {
  editingId.value = p.id
  form.id = p.id
  form.name = p.name
  form.baseUrl = p.baseUrl
  form.model = p.model
  form.apiKey = ''
  error.value = ''
}

function resetForm(): void {
  editingId.value = null
  form.id = ''
  form.name = ''
  form.baseUrl = ''
  form.model = ''
  form.apiKey = ''
  error.value = ''
}

function save(): void {
  if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
    error.value = props.t('assistant.settings.fieldsRequired')
    return
  }
  const id = form.id.trim() || `prov-${Date.now().toString(36)}`
  emit('upsert', {
    id,
    name: form.name.trim(),
    apiStyle: 'openai-compatible',
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    isDefault: props.providers.length === 0,
  }, form.apiKey.trim())
  resetForm()
}

function remove(p: ProviderRecord): void {
  emit('delete', p.id)
  if (editingId.value === p.id) resetForm()
}
</script>

<template>
  <section class="nest-settings" data-testid="nest-settings">
    <header class="nest-settings__header">
      <h3>{{ t('assistant.settings.providers') }}</h3>
      <button type="button" class="nest-settings__close" data-testid="nest-settings-close" @click="emit('close')">
        {{ t('assistant.settings.close') }}
      </button>
    </header>

    <p v-if="error" class="nest-settings__error" data-testid="nest-settings-error">{{ error }}</p>

    <!-- 供应商列表 -->
    <ul class="nest-settings__list">
      <li v-for="p in providers" :key="p.id" class="nest-settings__item" data-testid="nest-provider-item">
        <div class="nest-settings__item-main">
          <span class="nest-settings__name">
            {{ p.name }}
            <span v-if="p.isDefault" class="nest-settings__badge">{{ t('assistant.settings.default') }}</span>
          </span>
          <span class="nest-settings__meta">{{ p.baseUrl }} · {{ p.model }}</span>
          <span class="nest-settings__key" :class="{ 'nest-settings__key--off': !keySet[p.id] }">
            {{ keySet[p.id] ? t('assistant.settings.keySet') : t('assistant.settings.keyMissing') }}
          </span>
        </div>
        <div class="nest-settings__item-actions">
          <button
            v-if="!p.isDefault"
            type="button"
            class="nest-settings__btn"
            data-testid="nest-provider-default"
            @click="emit('setDefault', p.id)"
          >
            {{ t('assistant.settings.setDefault') }}
          </button>
          <button type="button" class="nest-settings__btn" @click="startEdit(p)">
            {{ t('assistant.settings.edit') }}
          </button>
          <button
            type="button"
            class="nest-settings__btn nest-settings__btn--danger"
            data-testid="nest-provider-delete"
            @click="remove(p)"
          >
            {{ t('assistant.settings.delete') }}
          </button>
        </div>
      </li>
      <li v-if="providers.length === 0" class="nest-settings__empty">
        {{ t('assistant.settings.noProviders') }}
      </li>
    </ul>

    <!-- 新增 / 编辑表单 -->
    <form class="nest-settings__form" @submit.prevent="save">
      <h4>{{ isEditing ? t('assistant.settings.editProvider') : t('assistant.settings.addProvider') }}</h4>
      <label class="nest-settings__field">
        <span>{{ t('assistant.settings.name') }}</span>
        <input v-model="form.name" data-testid="nest-provider-name" :disabled="isEditing" />
      </label>
      <label class="nest-settings__field">
        <span>{{ t('assistant.settings.baseUrl') }}</span>
        <input v-model="form.baseUrl" data-testid="nest-provider-baseurl" placeholder="https://api.example.com/v1" />
      </label>
      <label class="nest-settings__field">
        <span>{{ t('assistant.settings.model') }}</span>
        <input v-model="form.model" data-testid="nest-provider-model" placeholder="gpt-4o-mini" />
      </label>
      <label class="nest-settings__field">
        <span>{{ t('assistant.settings.apiKey') }}</span>
        <input
          v-model="form.apiKey"
          type="password"
          data-testid="nest-provider-apikey"
          :placeholder="isEditing ? t('assistant.settings.keyLeaveBlank') : ''"
          autocomplete="new-password"
        />
      </label>
      <div class="nest-settings__form-actions">
        <button type="submit" class="nest-settings__btn nest-settings__btn--primary" data-testid="nest-provider-save">
          {{ t('assistant.settings.save') }}
        </button>
        <button v-if="isEditing" type="button" class="nest-settings__btn" @click="resetForm">
          {{ t('assistant.settings.cancel') }}
        </button>
      </div>
      <p class="nest-settings__hint">{{ t('assistant.settings.privacyHint') }}</p>
    </form>
  </section>
</template>

<style scoped>
.nest-settings {
  background: var(--nest-surface, #232833);
  border-left: 1px solid var(--nest-border, #3a4150);
  padding: 16px;
  overflow-y: auto;
  max-height: 100%;
}

.nest-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nest-settings__header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--nest-text, #e8eaf0);
}

.nest-settings__close {
  background: none;
  border: none;
  color: var(--nest-muted, #8a8f98);
  cursor: pointer;
  font-size: 13px;
}

.nest-settings__error {
  color: var(--nest-error-text, #f0b4ae);
  font-size: 13px;
}

.nest-settings__list {
  list-style: none;
  margin: 12px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nest-settings__item {
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 10px;
  padding: 10px 12px;
}

.nest-settings__item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nest-settings__name {
  font-size: 14px;
  color: var(--nest-text, #e8eaf0);
}

.nest-settings__badge {
  margin-left: 6px;
  font-size: 11px;
  color: var(--nest-accent, #4f7cff);
  border: 1px solid var(--nest-accent, #4f7cff);
  border-radius: 6px;
  padding: 0 6px;
}

.nest-settings__meta {
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
  word-break: break-all;
}

.nest-settings__key {
  font-size: 12px;
  color: var(--nest-ok, #7ec699);
}

.nest-settings__key--off {
  color: var(--nest-warn, #e0b341);
}

.nest-settings__item-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.nest-settings__btn {
  border: 1px solid var(--nest-border, #3a4150);
  background: transparent;
  color: var(--nest-text, #e8eaf0);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.nest-settings__btn:hover {
  border-color: var(--nest-accent, #4f7cff);
}

.nest-settings__btn--primary {
  background: var(--nest-accent, #4f7cff);
  border-color: var(--nest-accent, #4f7cff);
  color: #fff;
}

.nest-settings__btn--danger:hover {
  border-color: var(--nest-error, #c0392b);
  color: var(--nest-error-text, #f0b4ae);
}

.nest-settings__empty {
  font-size: 13px;
  color: var(--nest-muted, #8a8f98);
}

.nest-settings__form {
  border-top: 1px solid var(--nest-border, #3a4150);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.nest-settings__form h4 {
  margin: 0;
  font-size: 14px;
  color: var(--nest-text, #e8eaf0);
}

.nest-settings__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
}

.nest-settings__field input {
  border-radius: 8px;
  border: 1px solid var(--nest-border, #3a4150);
  background: var(--nest-surface-2, #2a2f3a);
  color: var(--nest-text, #e8eaf0);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
}

.nest-settings__field input:focus {
  outline: none;
  border-color: var(--nest-accent, #4f7cff);
}

.nest-settings__form-actions {
  display: flex;
  gap: 8px;
}

.nest-settings__hint {
  margin: 0;
  font-size: 11px;
  color: var(--nest-muted, #8a8f98);
  line-height: 1.5;
}
</style>
