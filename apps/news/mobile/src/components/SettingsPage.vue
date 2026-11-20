<template>
  <div class="news-ms-page" data-mobile-news-settings-page data-testid="mobile-news-settings-page">
    <p
      v-if="toastText"
      class="news-ms-toast"
      role="status"
      data-mobile-news-toast
      data-testid="mobile-news-settings-toast"
    >
      {{ toastText }}
    </p>
    <nav class="news-ms-tabs" role="tablist" data-testid="mobile-news-settings-tabs">
      <button
        v-for="item in TABS"
        :key="item"
        type="button"
        role="tab"
        :aria-selected="tab === item"
        :class="{ on: tab === item }"
        :data-mobile-news-tab="item"
        :data-testid="`mobile-news-settings-tab-${item}`"
        @click="tab = item"
      >
        {{ t(`news.settings.tab.${item}`) }}
      </button>
    </nav>

    <p
      v-if="error"
      class="news-ms-error"
      role="alert"
      data-mobile-news-settings-error
      data-testid="mobile-news-settings-error"
    >
      {{ error }}
    </p>

    <!-- ==================== 源 ==================== -->
    <section
      v-if="tab === 'sources'"
      data-mobile-news-pane="sources"
      data-testid="mobile-news-pane-sources"
    >
      <div class="news-ms-head">
        <h3>{{ t('news.settings.tab.sources') }}</h3>
        <button
          type="button"
          class="news-ms-link"
          data-mobile-news-add-source
          data-testid="mobile-news-add-source"
          @click="openSourceDraft(blankSourceDraft())"
        >
          {{ t('news.settings.sources.add') }}
        </button>
      </div>

      <SourceForm
        v-if="sourceDraft"
        :draft="sourceDraft"
        :circles="circleList"
        :credentials="credentialList"
        :busy="busy"
        :existing-urls="existingUrls"
        @submit="submitSource"
        @cancel="sourceDraft = null"
      />

      <p v-if="!sourceList.length" class="news-ms-note">{{ t('news.settings.sources.empty') }}</p>

      <ul class="news-ms-list" data-mobile-news-source-list data-testid="mobile-news-source-list">
        <li
          v-for="source in sourceList"
          :key="source.id"
          :class="{ failing: source.state.failCount >= 3, muted: !source.enabled }"
          :data-mobile-news-source="source.id"
          :data-mobile-news-failing="source.state.failCount >= 3"
          :data-mobile-news-enabled="source.enabled"
          :data-testid="`mobile-news-source-${source.id}`"
        >
          <span class="news-ms-item-title">
            {{ source.name }}
            <span
              v-if="source.experimental"
              class="news-ms-tag"
              data-mobile-news-source-experimental
            >
              {{ t('news.settings.sources.experimental') }}
            </span>
          </span>
          <span class="news-ms-item-sub">
            {{ t(`news.settings.sources.kind.${source.kind}`) }} ·
            {{ t('news.settings.sources.weight') }} {{ weightLabel(source.weight) }} ·
            {{ circleName(source.circleId) }}
          </span>
          <span class="news-ms-item-sub">
            {{
              source.state.lastFetchAt
                ? t('news.settings.sources.lastOk', {
                    time: stampLabel(source.state.lastOkAt ?? 0),
                  })
                : t('news.settings.sources.neverFetched')
            }}
            <template v-if="source.state.failCount >= 3">
              · {{ t('news.settings.sources.failing', { count: source.state.failCount }) }}
            </template>
          </span>
          <span
            v-if="source.state.lastErrorKind"
            class="news-ms-item-error"
            data-mobile-news-source-error
            :data-testid="`mobile-news-source-error-${source.id}`"
          >
            {{ errorKindText(t, source.state.lastErrorKind) }}
          </span>
          <div class="news-ms-item-actions">
            <button
              type="button"
              class="news-ms-link"
              data-mobile-news-source-retry
              :data-testid="`mobile-news-source-retry-${source.id}`"
              :disabled="busy"
              @click="retry(source.id)"
            >
              {{ t('news.settings.sources.retry') }}
            </button>
            <button
              type="button"
              class="news-ms-link"
              data-mobile-news-source-edit
              :data-testid="`mobile-news-source-edit-${source.id}`"
              @click="openSourceDraft(draftOf(source))"
            >
              {{ t('news.settings.sources.edit') }}
            </button>
            <button
              type="button"
              class="news-ms-link"
              data-mobile-news-source-toggle
              :data-testid="`mobile-news-source-toggle-${source.id}`"
              :disabled="busy"
              @click="toggleSource(source)"
            >
              {{
                source.enabled
                  ? t('news.settings.sources.disabled')
                  : t('news.settings.sources.enabled')
              }}
            </button>
            <button
              type="button"
              class="news-ms-link danger"
              data-mobile-news-source-delete
              :data-testid="`mobile-news-source-delete-${source.id}`"
              :disabled="busy"
              @click="removeSource(source)"
            >
              {{ t('news.settings.sources.delete') }}
            </button>
          </div>
        </li>
      </ul>

      <div class="news-ms-head">
        <h3>{{ t('news.settings.credentials.title') }}</h3>
        <button
          type="button"
          class="news-ms-link"
          data-mobile-news-add-credential
          data-testid="mobile-news-add-credential"
          @click="credentialDraft = { kind: 'x-graphql', label: '' }"
        >
          {{ t('news.settings.credentials.add') }}
        </button>
      </div>
      <CredentialForm
        v-if="credentialDraft"
        :draft="credentialDraft"
        :busy="busy"
        @submit="submitCredential"
        @cancel="credentialDraft = null"
      />
      <ul
        class="news-ms-list"
        data-mobile-news-credential-list
        data-testid="mobile-news-credential-list"
      >
        <li
          v-for="credential in credentialList"
          :key="credential.id"
          :data-mobile-news-credential="credential.id"
          :data-testid="`mobile-news-credential-${credential.id}`"
        >
          <span class="news-ms-item-title">{{ credential.label }}</span>
          <span class="news-ms-item-sub">
            {{ t(`news.settings.sources.kind.${credential.kind}`) }} ·
            {{
              t('news.settings.credentials.masked', {
                mask: `···${credential.tail} (${credential.len})`,
              })
            }}
          </span>
          <div class="news-ms-item-actions">
            <button
              type="button"
              class="news-ms-link danger"
              data-mobile-news-credential-delete
              :data-testid="`mobile-news-credential-delete-${credential.id}`"
              :disabled="busy"
              @click="removeCredential(credential.id, credential.label)"
            >
              {{ t('news.settings.credentials.delete') }}
            </button>
          </div>
        </li>
      </ul>
      <p class="news-ms-note">{{ t('news.settings.credentials.plaintext') }}</p>
    </section>

    <!-- ==================== 圈子 ==================== -->
    <section
      v-else-if="tab === 'circles'"
      data-mobile-news-pane="circles"
      data-testid="mobile-news-pane-circles"
    >
      <div class="news-ms-head">
        <h3>{{ t('news.settings.tab.circles') }}</h3>
        <button
          type="button"
          class="news-ms-link"
          data-mobile-news-add-circle
          data-testid="mobile-news-add-circle"
          @click="circleDraft = { name: '', weight: 1 }"
        >
          {{ t('news.settings.circles.add') }}
        </button>
      </div>

      <CircleForm
        v-if="circleDraft"
        :id="circleDraft.id"
        :initial-name="circleDraft.name"
        :initial-weight="circleDraft.weight"
        :existing-names="circleList.map((circle) => circle.name)"
        :busy="busy"
        @submit="submitCircle"
        @cancel="circleDraft = null"
      />

      <p v-if="!circleList.length" class="news-ms-note">{{ t('news.settings.circles.empty') }}</p>

      <ul class="news-ms-list" data-mobile-news-circle-list data-testid="mobile-news-circle-list">
        <li
          v-for="circle in circleList"
          :key="circle.id"
          :data-mobile-news-circle-item="circle.id"
          :data-testid="`mobile-news-circle-row-${circle.id}`"
        >
          <span class="news-ms-item-title">{{ circle.name }}</span>
          <span class="news-ms-item-sub">
            {{ t('news.settings.circles.sources', { count: circle.sourceCount }) }} ·
            {{ t('news.settings.circles.weight') }} {{ weightLabel(circle.weight) }}
          </span>
          <div class="news-ms-item-actions">
            <button
              type="button"
              class="news-ms-link"
              data-mobile-news-circle-edit
              :data-testid="`mobile-news-circle-edit-${circle.id}`"
              @click="circleDraft = { id: circle.id, name: circle.name, weight: circle.weight }"
            >
              {{ t('news.settings.circles.edit') }}
            </button>
            <button
              type="button"
              class="news-ms-link danger"
              data-mobile-news-circle-delete
              :data-testid="`mobile-news-circle-delete-${circle.id}`"
              :disabled="busy"
              @click="removeCircle(circle.id, circle.name)"
            >
              {{ t('news.settings.circles.delete') }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- ==================== AI ==================== -->
    <section v-else-if="tab === 'ai'" data-mobile-news-pane="ai" data-testid="mobile-news-pane-ai">
      <label class="news-ms-field checkbox">
        <input
          v-model="aiEnabled"
          type="checkbox"
          data-mobile-news-ai-enabled
          data-testid="mobile-news-ai-enabled"
        />
        <span>{{ t('news.settings.ai.enabled') }}</span>
      </label>
      <label class="news-ms-field">
        <span>{{ t('news.settings.ai.baseUrl') }}</span>
        <input
          v-model="aiBaseUrl"
          type="url"
          spellcheck="false"
          placeholder="https://api.openai.com"
          data-mobile-news-ai-base-url
          data-testid="mobile-news-ai-base-url"
        />
      </label>
      <label class="news-ms-field">
        <span>{{ t('news.settings.ai.model') }}</span>
        <input
          v-model="aiModel"
          type="text"
          spellcheck="false"
          data-mobile-news-ai-model
          data-testid="mobile-news-ai-model"
        />
      </label>
      <label class="news-ms-field">
        <span>{{ t('news.settings.ai.apiKey') }}</span>
        <input
          v-model="aiApiKey"
          type="password"
          autocomplete="off"
          :placeholder="keyMask"
          data-mobile-news-ai-key
          data-testid="mobile-news-ai-key"
        />
        <small>{{ t('news.settings.ai.keyHint') }}</small>
      </label>
      <p class="news-ms-note">{{ t('news.settings.ai.plaintext') }}</p>
      <p
        v-if="!aiEnabled"
        class="news-ms-note"
        data-mobile-news-ai-disabled
        data-testid="mobile-news-ai-disabled"
      >
        {{ t('news.settings.ai.disabled') }}
      </p>
      <div class="news-ms-actions">
        <button
          type="button"
          class="news-ms-primary"
          :disabled="busy"
          data-mobile-news-ai-save
          data-testid="mobile-news-ai-save"
          @click="submitAi"
        >
          {{ t('news.settings.ai.save') }}
        </button>
        <button
          type="button"
          class="news-ms-link"
          data-mobile-news-ai-summarize
          data-testid="mobile-news-ai-summarize"
          :disabled="busy || !aiEnabled || !!aiProgress"
          @click="summarizeToday"
        >
          {{ t('news.settings.ai.summarizeToday') }}
        </button>
      </div>
      <p
        v-if="aiProgress"
        class="news-ms-note"
        data-mobile-news-ai-progress
        data-testid="mobile-news-ai-progress"
      >
        {{ t('news.settings.ai.summarizing', { done: aiProgress.done, total: aiProgress.total }) }}
      </p>
      <p
        v-if="aiResult"
        class="news-ms-note"
        data-mobile-news-ai-result
        data-testid="mobile-news-ai-result"
      >
        {{ aiResult }}
      </p>
    </section>

    <!-- ==================== 抓取记录 ==================== -->
    <section
      v-else-if="tab === 'log'"
      data-mobile-news-pane="log"
      data-testid="mobile-news-pane-log"
    >
      <div class="news-ms-head">
        <h3>{{ t('news.settings.log.title') }}</h3>
        <button
          type="button"
          class="news-ms-link"
          data-testid="mobile-news-log-refresh"
          @click="loadLog()"
        >
          {{ t('news.toolbar.refresh') }}
        </button>
      </div>
      <p v-if="!logEntries.length" class="news-ms-note" data-testid="mobile-news-log-empty">
        {{ t('news.settings.log.empty') }}
      </p>
      <ul v-else class="news-ms-list" data-mobile-news-log-list data-testid="mobile-news-log-list">
        <li v-for="entry in logEntries" :key="entry.id" :class="{ failing: !entry.ok }">
          <span class="news-ms-item-title">{{ entry.sourceName }}</span>
          <span class="news-ms-item-sub">
            {{ stampLabel(entry.startedAt) }} · {{ durationLabel(entry.durationMs) }} ·
            {{ entry.itemCount ?? 0 }} {{ t('news.settings.log.items') }}
          </span>
          <span class="news-ms-item-sub">
            <template v-if="entry.ok">{{ t('news.settings.log.ok') }}</template>
            <template v-else>
              {{ entry.httpStatus ? `HTTP ${entry.httpStatus} · ` : ''
              }}{{ errorKindText(t, entry.errorKind) }}
            </template>
          </span>
        </li>
      </ul>
    </section>

    <!-- ==================== 数据 ==================== -->
    <section
      v-else-if="tab === 'data'"
      data-mobile-news-pane="data"
      data-testid="mobile-news-pane-data"
    >
      <h3>{{ t('news.settings.autostart.title') }}</h3>
      <p class="news-ms-note" data-testid="mobile-news-autostart">
        <b>{{ t('news.settings.autostart.unknown') }}</b>
      </p>
      <p class="news-ms-note">{{ t('news.settings.autostart.pathMobile') }}</p>
      <p class="news-ms-note">{{ t('news.settings.autostart.note') }}</p>

      <h3>{{ t('news.settings.data.export') }}</h3>
      <p class="news-ms-note">{{ t('news.settings.data.exportHint') }}</p>
      <div class="news-ms-actions">
        <button
          type="button"
          class="news-ms-primary"
          :disabled="busy"
          data-mobile-news-export
          data-testid="mobile-news-export"
          @click="exportData"
        >
          {{ t('news.settings.data.export') }}
        </button>
        <button
          v-if="exportedJson"
          type="button"
          class="news-ms-link"
          data-mobile-news-export-copy
          data-testid="mobile-news-export-copy"
          @click="copyExport"
        >
          {{ t('news.settings.data.copy') }}
        </button>
      </div>
      <textarea
        v-if="exportedJson"
        class="news-ms-export"
        readonly
        :value="exportedJson"
        data-mobile-news-export-json
        data-testid="mobile-news-export-json"
      ></textarea>
    </section>

    <!-- ==================== 关于 ==================== -->
    <section v-else data-mobile-news-pane="about" data-testid="mobile-news-pane-about">
      <p class="news-ms-note">{{ t('news.settings.about.version', { version: APP_VERSION }) }}</p>
      <h3>{{ t('news.settings.about.differencesTitle') }}</h3>
      <p class="news-ms-note">{{ t('news.settings.about.differences') }}</p>
      <p class="news-ms-note">{{ t('news.settings.about.noNotifications') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 移动端设置页（宿主二级页）：源 / 圈子 / 凭据 / AI / 抓取记录 / 数据 / 关于。
 *
 * 移动端只能「只读展示 + 指路」自启状态：宿主 face 没有给应用读取偏好的通道。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { NewsSource } from '../types'
import type { CredentialDraft, SourceDraft } from '../composables/useSettings'
import { useSettings } from '../composables/useSettings'
import pkg from '../../package.json'
import { durationLabel, stampLabel, weightLabel } from '../utils/format'
import { errorKindText, parseError } from '../utils/errors'
import SourceForm from './SourceForm.vue'
import CircleForm from './CircleForm.vue'
import CredentialForm from './CredentialForm.vue'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const APP_VERSION = pkg.version
const TABS = ['sources', 'circles', 'ai', 'log', 'data', 'about'] as const
type Tab = (typeof TABS)[number]
const tab = ref<Tab>('sources')

const {
  sources: sourceList,
  circles: circleList,
  credentials: credentialList,
  settings: aiSettings,
  log: logEntries,
  busy,
  error,
  aiProgress,
  loadAll,
  loadLog,
  addSource,
  updateSource,
  deleteSource,
  retrySource,
  addCircle,
  updateCircle,
  deleteCircle,
  saveCredential,
  deleteCredential,
  saveAi,
  summarize,
  exportJson,
} = useSettings(context)

const sourceDraft = ref<SourceDraft | null>(null)
const circleDraft = ref<{ id?: string; name: string; weight: number } | null>(null)
const credentialDraft = ref<CredentialDraft | null>(null)

const aiEnabled = ref(false)
const aiBaseUrl = ref('')
const aiModel = ref('')
const aiApiKey = ref('')
const aiResult = ref('')
const exportedJson = ref('')

let toastTimer: ReturnType<typeof setTimeout> | null = null
const toastText = ref('')

function showToast(text: string): void {
  toastText.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastText.value = ''
    toastTimer = null
  }, 2200)
}

const existingUrls = computed(() => sourceList.value.map((source) => source.url))
const keyMask = computed(() => {
  const current = aiSettings.value
  if (!current || !current.aiApiKeyLen) return ''
  return `···${current.aiApiKeyTail} (${current.aiApiKeyLen})`
})

function blankSourceDraft(): SourceDraft {
  return { name: '', kind: 'rss', url: '', circleId: null, weight: 1, enabled: true }
}

function draftOf(source: NewsSource): SourceDraft {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    circleId: source.circleId ?? null,
    weight: source.weight,
    enabled: source.enabled,
    authId: source.authId ?? null,
  }
}

function circleName(circleId: string | undefined): string {
  if (!circleId) return t('news.view.ungrouped')
  return circleList.value.find((circle) => circle.id === circleId)?.name ?? t('news.view.ungrouped')
}

function report(e: unknown): void {
  const parsed = parseError(e)
  showToast(`${t(`news.error.${parsed.code}`)}${parsed.detail ? `（${parsed.detail}）` : ''}`)
}

function openSourceDraft(draft: SourceDraft): void {
  sourceDraft.value = draft
}

async function submitSource(draft: SourceDraft): Promise<void> {
  try {
    if (draft.id) await updateSource(draft)
    else await addSource(draft)
    sourceDraft.value = null
    showToast(t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function toggleSource(source: NewsSource): Promise<void> {
  try {
    await updateSource({ ...draftOf(source), enabled: !source.enabled })
  } catch (e) {
    report(e)
  }
}

async function removeSource(source: NewsSource): Promise<void> {
  if (!window.confirm(t('news.settings.sources.deleteConfirm', { name: source.name }))) return
  try {
    await deleteSource(source.id)
    showToast(t('news.toast.deleted'))
  } catch (e) {
    report(e)
  }
}

async function retry(sourceId: string): Promise<void> {
  try {
    const result = await retrySource(sourceId)
    if (result.ok) showToast(t('news.toast.refreshed', { newItems: result.newItems }))
    else if (result.errorKind) showToast(errorKindText(t, result.errorKind))
  } catch (e) {
    report(e)
  }
}

async function submitCircle(draft: { id?: string; name: string; weight: number }): Promise<void> {
  try {
    if (draft.id) await updateCircle(draft.id, draft.name, draft.weight)
    else await addCircle(draft.name, draft.weight)
    circleDraft.value = null
    showToast(t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function removeCircle(id: string, name: string): Promise<void> {
  if (!window.confirm(t('news.settings.circles.deleteConfirm', { name }))) return
  try {
    await deleteCircle(id)
    showToast(t('news.toast.deleted'))
  } catch (e) {
    report(e)
  }
}

async function submitCredential(draft: CredentialDraft): Promise<void> {
  try {
    await saveCredential(draft)
    credentialDraft.value = null
    showToast(t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function removeCredential(id: string, label: string): Promise<void> {
  if (!window.confirm(t('news.settings.credentials.deleteConfirm', { label }))) return
  try {
    await deleteCredential(id)
    showToast(t('news.toast.deleted'))
  } catch (e) {
    report(e)
  }
}

async function submitAi(): Promise<void> {
  try {
    await saveAi({
      aiEnabled: aiEnabled.value,
      aiBaseUrl: aiBaseUrl.value,
      aiModel: aiModel.value,
      aiApiKey: aiApiKey.value || undefined,
    })
    aiApiKey.value = ''
    showToast(t('news.settings.ai.saved'))
  } catch (e) {
    report(e)
  }
}

async function summarizeToday(): Promise<void> {
  aiResult.value = ''
  try {
    const feed = (await context.commands.execute('news.list-feed', {
      view: 'today',
      nowMs: Date.now(),
    })) as { items: Array<{ id: string }> }
    const ids = feed.items.slice(0, 20).map((item) => item.id)
    const result = await summarize(ids)
    aiResult.value = t('news.settings.ai.result', {
      ok: result.okCount,
      failed: result.failedCount,
    })
  } catch (e) {
    report(e)
  }
}

async function exportData(): Promise<void> {
  try {
    exportedJson.value = await exportJson()
    showToast(t('news.settings.data.exported'))
  } catch (e) {
    report(e)
  }
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportedJson.value)
    showToast(t('news.toast.copied'))
  } catch {
    showToast(t('news.toast.copyFailed'))
  }
}

onMounted(async () => {
  await loadAll()
  const current = aiSettings.value
  if (current) {
    aiEnabled.value = current.aiEnabled
    aiBaseUrl.value = current.aiBaseUrl
    aiModel.value = current.aiModel
  }
})
</script>

<style scoped>
.news-ms-page {
  padding: var(--news-space-4) var(--news-space-3) 40px;
}
.news-ms-toast {
  position: sticky;
  top: 0;
  z-index: 5;
  margin: 0 0 var(--news-space-2);
  padding: 8px 12px;
  border-radius: var(--news-radius-control);
  background: var(--news-text-primary);
  color: var(--news-bg-page);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.news-ms-tabs {
  display: flex;
  gap: 20px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--news-border);
}
.news-ms-tabs button {
  position: relative;
  flex: none;
  border: 0;
  background: none;
  padding: var(--news-space-2) 0 12px;
  color: var(--news-text-tertiary);
  font-size: var(--news-text-body);
}
.news-ms-tabs button[aria-selected='true'] {
  color: var(--news-text-primary);
  font-weight: 600;
}
/* 选中下划线走伪元素，不占布局高度；forced-colors 下也能保住形状 */
.news-ms-tabs button[aria-selected='true']::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  bottom: -1px;
  border-block-end: 2px solid var(--news-accent);
}
.news-ms-head {
  display: flex;
  align-items: center;
  gap: var(--news-space-3);
  margin: 24px 0 var(--news-space-3);
}
.news-ms-head h3,
.news-ms-page h3 {
  margin: 0;
  font-family: var(--news-font-display);
  font-size: var(--news-text-title);
  font-weight: 600;
  color: var(--news-text-primary);
}
.news-ms-head .news-ms-link {
  margin-inline-start: auto;
}
.news-ms-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--news-space-2);
}
.news-ms-list li {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-1);
  padding: var(--news-space-3);
  border: 1px solid var(--news-border);
  border-radius: var(--news-radius-card);
  background: var(--news-bg-card);
}
.news-ms-list li.failing {
  border-inline-start: 3px solid var(--news-danger);
}
.news-ms-list li.failing .news-ms-item-title {
  color: var(--news-danger);
}
.news-ms-list li.muted {
  opacity: 0.65;
}
.news-ms-item-title {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}
.news-ms-item-sub {
  font-size: 12px;
  line-height: 1.55;
  font-variant-numeric: tabular-nums;
  color: var(--news-text-tertiary);
}
.news-ms-item-error {
  font-size: 12px;
  line-height: 1.55;
  color: var(--news-danger);
}
.news-ms-item-actions {
  display: flex;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  margin-top: var(--news-space-2);
  padding-top: var(--news-space-2);
  border-top: 1px solid var(--news-border);
}
/* 行内操作是真正的按钮：有边框、有点击区，不再是一串裸文字 */
.news-ms-item-actions .news-ms-link {
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: none;
  color: var(--news-text-secondary);
  font-size: 12px;
  line-height: 1.4;
  text-decoration: none;
}
.news-ms-item-actions .news-ms-link:active {
  background: var(--news-bg-hover);
}
.news-ms-item-actions .news-ms-link.danger {
  color: var(--news-danger);
}
.news-ms-tag {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--news-bg-hover);
  font-size: 11px;
  font-weight: 500;
  color: var(--news-text-tertiary);
}
.news-ms-field {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-2);
  margin-bottom: var(--news-space-4);
  font-size: var(--news-text-body);
  line-height: 1.5;
  color: var(--news-text-secondary);
}
.news-ms-field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--news-space-3);
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
  /* 16px 起，避免移动端 WebView 聚焦时自动放大页面 */
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
.news-ms-field input[type='checkbox'] {
  width: 20px;
  height: 20px;
  min-height: 0;
  padding: 0;
  accent-color: var(--news-accent);
}
.news-ms-field small {
  font-size: var(--news-text-meta);
  line-height: 1.5;
  color: var(--news-text-tertiary);
}
.news-ms-note {
  margin: var(--news-space-2) 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--news-text-tertiary);
}
.news-ms-error {
  margin: 0 0 var(--news-space-3);
  padding: 12px;
  border-inline-start: 3px solid var(--news-danger);
  border-radius: var(--news-radius-control);
  background: var(--news-danger-soft);
  color: var(--news-danger);
  font-size: 12px;
  line-height: 1.6;
}
.news-ms-actions {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  margin: var(--news-space-4) 0;
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
  transition:
    transform 100ms ease-out,
    opacity 100ms ease-out;
}
.news-ms-primary:active {
  transform: scale(0.98);
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
  font-size: 12.5px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.news-ms-link.danger {
  color: var(--news-danger);
}
.news-ms-export {
  box-sizing: border-box;
  width: 100%;
  min-height: 140px;
  margin-top: var(--news-space-2);
  padding: 12px;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-input);
  color: var(--news-text-secondary);
  font-family: var(--news-font-mono);
  font-size: 12px;
  line-height: 1.6;
}
</style>
