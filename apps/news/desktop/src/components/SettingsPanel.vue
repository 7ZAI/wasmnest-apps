<template>
  <section class="news-settings" data-news-settings data-testid="news-settings">
    <header class="news-settings-head">
      <h2>{{ t('news.settings.title') }}</h2>
      <button
        type="button"
        class="news-icon-btn"
        :aria-label="t('news.toolbar.close')"
        data-news-settings-close
        data-testid="news-settings-close"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <nav class="news-tabs" role="tablist">
      <button
        v-for="item in TABS"
        :key="item"
        type="button"
        role="tab"
        :aria-selected="tab === item"
        :class="{ on: tab === item }"
        :data-news-tab="item"
        :data-testid="`news-settings-tab-${item}`"
        @click="selectTab(item)"
      >
        {{ t(`news.settings.tab.${item}`) }}
      </button>
    </nav>

    <div class="news-settings-body">
      <p v-if="error" class="news-error" role="alert" data-news-settings-error>{{ error }}</p>

      <!-- ==================== 源 ==================== -->
      <section
        v-if="tab === 'sources'"
        data-news-pane="sources"
        data-testid="news-settings-pane-sources"
      >
        <div class="news-section-head">
          <h3>{{ t('news.settings.tab.sources') }}</h3>
          <button
            type="button"
            class="news-primary"
            data-news-add-source
            data-testid="news-add-source"
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
          @submit="saveSource"
          @cancel="sourceDraft = null"
        />

        <p v-if="!sourceList.length" class="news-empty">
          <b>{{ t('news.settings.sources.empty') }}</b>
        </p>

        <ul class="news-list" data-news-source-list data-testid="news-source-list">
          <li
            v-for="source in sourceList"
            :key="source.id"
            class="news-list-row"
            :class="{ failing: source.state.failCount >= 3, muted: !source.enabled }"
            :data-news-source="source.id"
            :data-news-failing="source.state.failCount >= 3"
            :data-news-enabled="source.enabled"
            :data-testid="`news-source-${source.id}`"
          >
            <div class="news-list-main">
              <span class="news-list-title">
                {{ source.name }}
                <span v-if="source.experimental" class="news-tag" data-news-source-experimental>
                  {{ t('news.settings.sources.experimental') }}
                </span>
                <span v-if="!source.enabled" class="news-tag">
                  {{ t('news.settings.sources.disabled') }}
                </span>
              </span>
              <span class="news-list-sub">
                {{ t(`news.settings.sources.kind.${source.kind}`) }}
                · {{ t('news.settings.sources.weight') }} {{ weightLabel(source.weight) }} ·
                {{ circleName(source.circleId) }}
              </span>
              <span class="news-list-status">
                <template v-if="source.state.lastFetchAt">
                  {{
                    t('news.settings.sources.lastOk', {
                      time: stampLabel(source.state.lastOkAt ?? 0),
                    })
                  }}
                </template>
                <template v-else>{{ t('news.settings.sources.neverFetched') }}</template>
                <template v-if="source.state.nextRetryAt && source.state.nextRetryAt > now">
                  ·
                  {{
                    t('news.settings.sources.nextRetry', {
                      time: stampLabel(source.state.nextRetryAt),
                    })
                  }}
                </template>
                <template v-if="source.state.failCount >= 3">
                  · {{ t('news.settings.sources.failing', { count: source.state.failCount }) }}
                </template>
                <template v-if="source.experimental && !source.hasCredential">
                  · {{ t('news.settings.sources.credentialMissing') }}
                </template>
              </span>
              <details
                v-if="source.state.lastErrorKind"
                class="news-list-error"
                data-news-source-error
                :data-testid="`news-source-error-${source.id}`"
                :title="source.state.lastErrorDetail ?? ''"
              >
                <summary>{{ errorKindText(t, source.state.lastErrorKind) }}</summary>
                <p v-if="source.state.lastErrorDetail" class="news-list-error-detail">
                  {{ source.state.lastErrorDetail }}
                </p>
              </details>
            </div>
            <div class="news-list-actions">
              <button
                type="button"
                class="news-link-btn"
                data-news-source-retry
                :data-testid="`news-source-retry-${source.id}`"
                :disabled="busy"
                @click="retry(source.id)"
              >
                {{ t('news.settings.sources.retry') }}
              </button>
              <button
                type="button"
                class="news-link-btn"
                data-news-source-edit
                :data-testid="`news-source-edit-${source.id}`"
                @click="openSourceDraft(draftOf(source))"
              >
                {{ t('news.settings.sources.edit') }}
              </button>
              <button
                type="button"
                class="news-link-btn"
                data-news-source-toggle
                :data-testid="`news-source-toggle-${source.id}`"
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
                class="news-link-btn danger"
                data-news-source-delete
                :data-testid="`news-source-delete-${source.id}`"
                :disabled="busy"
                @click="removeSource(source)"
              >
                {{ t('news.settings.sources.delete') }}
              </button>
            </div>
          </li>
        </ul>

        <section class="news-subsection">
          <div class="news-section-head">
            <h3>{{ t('news.settings.credentials.title') }}</h3>
            <button
              type="button"
              class="news-link-btn"
              data-news-add-credential
              data-testid="news-add-credential"
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
          <ul v-if="credentialList.length" class="news-list" data-testid="news-credential-list">
            <li
              v-for="credential in credentialList"
              :key="credential.id"
              class="news-list-row"
              :data-news-credential="credential.id"
              :data-testid="`news-credential-${credential.id}`"
            >
              <div class="news-list-main">
                <span class="news-list-title">{{ credential.label }}</span>
                <span class="news-list-sub">
                  {{ t(`news.settings.sources.kind.${credential.kind}`) }} ·
                  {{
                    t('news.settings.credentials.masked', {
                      mask: `···${credential.tail} (${credential.len})`,
                    })
                  }}
                </span>
              </div>
              <div class="news-list-actions">
                <button
                  type="button"
                  class="news-link-btn danger"
                  data-news-credential-delete
                  :data-testid="`news-credential-delete-${credential.id}`"
                  :disabled="busy"
                  @click="removeCredential(credential.id, credential.label)"
                >
                  {{ t('news.settings.credentials.delete') }}
                </button>
              </div>
            </li>
          </ul>
          <p class="news-note">{{ t('news.settings.credentials.plaintext') }}</p>
        </section>
      </section>

      <!-- ==================== 圈子 ==================== -->
      <section
        v-else-if="tab === 'circles'"
        data-news-pane="circles"
        data-testid="news-settings-pane-circles"
      >
        <div class="news-section-head">
          <h3>{{ t('news.settings.tab.circles') }}</h3>
          <button
            type="button"
            class="news-primary"
            data-news-add-circle
            data-testid="news-add-circle"
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
          @submit="saveCircle"
          @cancel="circleDraft = null"
        />

        <p v-if="!circleList.length" class="news-empty">
          <b>{{ t('news.settings.circles.empty') }}</b>
        </p>

        <ul class="news-list" data-news-circle-list data-testid="news-circle-list">
          <li
            v-for="circle in circleList"
            :key="circle.id"
            class="news-list-row"
            :data-news-circle="circle.id"
            :data-testid="`news-circle-row-${circle.id}`"
          >
            <div class="news-list-main">
              <span class="news-list-title">{{ circle.name }}</span>
              <span class="news-list-sub">
                {{ t('news.settings.circles.sources', { count: circle.sourceCount }) }} ·
                {{ t('news.settings.circles.weight') }} {{ weightLabel(circle.weight) }}
              </span>
            </div>
            <div class="news-list-actions">
              <button
                type="button"
                class="news-link-btn"
                data-news-circle-edit
                :data-testid="`news-circle-edit-${circle.id}`"
                @click="circleDraft = { id: circle.id, name: circle.name, weight: circle.weight }"
              >
                {{ t('news.settings.circles.edit') }}
              </button>
              <button
                type="button"
                class="news-link-btn danger"
                data-news-circle-delete
                :data-testid="`news-circle-delete-${circle.id}`"
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
      <section v-else-if="tab === 'ai'" data-news-pane="ai" data-testid="news-settings-pane-ai">
        <div class="news-form-grid">
          <label class="news-field news-field-wide checkbox">
            <input
              v-model="aiEnabled"
              type="checkbox"
              data-news-ai-enabled
              data-testid="news-ai-enabled"
            />
            <span>{{ t('news.settings.ai.enabled') }}</span>
          </label>
          <label class="news-field news-field-wide">
            <span>{{ t('news.settings.ai.baseUrl') }}</span>
            <input
              v-model="aiBaseUrl"
              type="url"
              spellcheck="false"
              placeholder="https://api.openai.com"
              data-news-ai-base-url
              data-testid="news-ai-base-url"
            />
          </label>
          <label class="news-field">
            <span>{{ t('news.settings.ai.model') }}</span>
            <input
              v-model="aiModel"
              type="text"
              spellcheck="false"
              data-news-ai-model
              data-testid="news-ai-model"
            />
          </label>
          <label class="news-field">
            <span>{{ t('news.settings.ai.apiKey') }}</span>
            <input
              v-model="aiApiKey"
              type="password"
              autocomplete="off"
              spellcheck="false"
              :placeholder="keyMask"
              data-news-ai-key
              data-testid="news-ai-key"
            />
            <small>{{ t('news.settings.ai.keyHint') }}</small>
          </label>
        </div>
        <p class="news-note">{{ t('news.settings.ai.plaintext') }}</p>
        <p v-if="!aiEnabled" class="news-note" data-news-ai-disabled data-testid="news-ai-disabled">
          {{ t('news.settings.ai.disabled') }}
        </p>
        <div class="news-form-actions">
          <button
            type="button"
            class="news-primary"
            data-news-ai-save
            data-testid="news-ai-save"
            :disabled="busy"
            @click="submitAi"
          >
            {{ t('news.settings.ai.save') }}
          </button>
          <button
            type="button"
            class="news-link-btn"
            data-news-ai-summarize
            data-testid="news-ai-summarize"
            :disabled="busy || !aiEnabled || !!aiProgress"
            @click="summarizeToday"
          >
            {{ t('news.settings.ai.summarizeToday') }}
          </button>
          <span
            v-if="aiProgress"
            class="news-note"
            data-news-ai-progress
            data-testid="news-ai-progress"
          >
            {{
              t('news.settings.ai.summarizing', {
                done: aiProgress.done,
                total: aiProgress.total,
              })
            }}
          </span>
        </div>
        <p v-if="aiResult" class="news-note" data-news-ai-result data-testid="news-ai-result">
          {{ aiResult }}
        </p>
      </section>

      <!-- ==================== 抓取记录 ==================== -->
      <section v-else-if="tab === 'log'" data-news-pane="log" data-testid="news-settings-pane-log">
        <div class="news-section-head">
          <h3>{{ t('news.settings.log.title') }}</h3>
          <button
            type="button"
            class="news-link-btn"
            data-testid="news-log-refresh"
            @click="loadLog()"
          >
            {{ t('news.toolbar.refresh') }}
          </button>
        </div>
        <p v-if="!logEntries.length" class="news-empty" data-testid="news-log-empty">
          <b>{{ t('news.settings.log.empty') }}</b>
        </p>
        <table v-else class="news-table" data-news-log-table data-testid="news-log-table">
          <thead>
            <tr>
              <th>{{ t('news.settings.log.time') }}</th>
              <th>{{ t('news.settings.log.source') }}</th>
              <th>{{ t('news.settings.log.items') }}</th>
              <th>{{ t('news.settings.log.duration') }}</th>
              <th>{{ t('news.settings.log.result') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in logEntries"
              :key="entry.id"
              :class="{ failing: !entry.ok }"
              :data-testid="`news-log-row-${entry.id}`"
            >
              <td class="numeric">{{ stampLabel(entry.startedAt) }}</td>
              <td>{{ entry.sourceName }}</td>
              <td class="numeric">{{ entry.itemCount ?? 0 }}</td>
              <td class="numeric">{{ durationLabel(entry.durationMs) }}</td>
              <td>
                <template v-if="entry.ok">{{ t('news.settings.log.ok') }}</template>
                <template v-else>
                  {{ entry.httpStatus ? `HTTP ${entry.httpStatus} · ` : ''
                  }}{{ errorKindText(t, entry.errorKind) }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ==================== 数据 ==================== -->
      <section
        v-else-if="tab === 'data'"
        data-news-pane="data"
        data-testid="news-settings-pane-data"
      >
        <section class="news-subsection">
          <h3>{{ t('news.settings.autostart.title') }}</h3>
          <p class="news-autostart" data-news-autostart data-testid="news-autostart">
            <b>{{ autostartLabel }}</b>
          </p>
          <p class="news-note">{{ t('news.settings.autostart.pathDesktop') }}</p>
          <p class="news-note">{{ t('news.settings.autostart.note') }}</p>
        </section>

        <section class="news-subsection">
          <h3>{{ t('news.settings.data.export') }}</h3>
          <p class="news-note">{{ t('news.settings.data.exportHint') }}</p>
          <p class="news-note">
            {{
              t('news.settings.data.summary', {
                sources: sourceList.length,
                circles: circleList.length,
              })
            }}
          </p>
          <div class="news-form-actions">
            <button
              type="button"
              class="news-primary"
              data-news-export
              data-testid="news-export"
              :disabled="busy"
              @click="exportData"
            >
              {{ t('news.settings.data.export') }}
            </button>
            <button
              v-if="exportedJson"
              type="button"
              class="news-link-btn"
              data-news-export-download
              data-testid="news-export-download"
              @click="downloadExport"
            >
              {{ t('news.settings.data.download') }}
            </button>
            <button
              v-if="exportedJson"
              type="button"
              class="news-link-btn"
              data-news-export-copy
              data-testid="news-export-copy"
              @click="copyExport"
            >
              {{ t('news.settings.data.copy') }}
            </button>
          </div>
          <textarea
            v-if="exportedJson"
            class="news-export-box"
            readonly
            :value="exportedJson"
            data-news-export-json
            data-testid="news-export-json"
          ></textarea>
        </section>
      </section>

      <!-- ==================== 关于 ==================== -->
      <section v-else data-news-pane="about" data-testid="news-settings-pane-about">
        <p class="news-note">{{ t('news.settings.about.version', { version: version }) }}</p>
        <h3>{{ t('news.settings.about.differencesTitle') }}</h3>
        <p class="news-note">{{ t('news.settings.about.differences') }}</p>
        <p class="news-note">{{ t('news.settings.about.noNotifications') }}</p>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 设置页：源 / 圈子 / 凭据 / AI / 抓取记录 / 数据 / 关于。
 *
 * 所有写操作走后端命令；写成功后 `emit('changed')`，由父组件重拉列表与排序。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NewsSource } from '../types'
import type { CredentialDraft, SourceDraft } from '../composables/useSettings'
import { useSettings } from '../composables/useSettings'
import { durationLabel, stampLabel, weightLabel } from '../utils/format'
import { errorKindText, parseError } from '../utils/errors'
import SourceForm from './SourceForm.vue'
import CircleForm from './CircleForm.vue'
import CredentialForm from './CredentialForm.vue'

const props = defineProps<{
  version: string
  invokeHost?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
}>()
const emit = defineEmits<{ close: []; changed: []; toast: [text: string] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const TABS = ['sources', 'circles', 'ai', 'log', 'data', 'about'] as const
type Tab = (typeof TABS)[number]
const tab = ref<Tab>('sources')
const now = ref(Date.now())

// 控制器解构到顶层：模板里的 ref 由 Vue 自动解包，避免嵌套 ref 的读写歧义
const {
  sources: sourceList,
  circles: circleList,
  credentials: credentialList,
  settings: aiSettings,
  log: logEntries,
  busy,
  error,
  autostart: autostartState,
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
  loadAutostart,
} = useSettings(context, props.invokeHost)

const sourceDraft = ref<SourceDraft | null>(null)
const circleDraft = ref<{ id?: string; name: string; weight: number } | null>(null)
const credentialDraft = ref<CredentialDraft | null>(null)

const aiEnabled = ref(false)
const aiBaseUrl = ref('')
const aiModel = ref('')
const aiApiKey = ref('')
const aiResult = ref('')
const exportedJson = ref('')

const existingUrls = computed(() => sourceList.value.map((source) => source.url))
const keyMask = computed(() => {
  const current = aiSettings.value
  if (!current || !current.aiApiKeyLen) return ''
  return `···${current.aiApiKeyTail} (${current.aiApiKeyLen})`
})
const autostartLabel = computed(() => {
  const state = autostartState.value
  if (!state.readable) return t('news.settings.autostart.unknown')
  return state.enabled ? t('news.settings.autostart.on') : t('news.settings.autostart.off')
})

function selectTab(next: Tab): void {
  tab.value = next
}

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
  emit(
    'toast',
    parsed.detail
      ? `${t(`news.error.${parsed.code}`)}（${parsed.detail}）`
      : t(`news.error.${parsed.code}`),
  )
}

function openSourceDraft(draft: SourceDraft): void {
  sourceDraft.value = draft
}

async function saveSource(draft: SourceDraft): Promise<void> {
  try {
    if (draft.id) await updateSource(draft)
    else await addSource(draft)
    sourceDraft.value = null
    emit('changed')
    emit('toast', t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function toggleSource(source: NewsSource): Promise<void> {
  try {
    await updateSource({
      ...draftOf(source),
      enabled: !source.enabled,
    })
    emit('changed')
  } catch (e) {
    report(e)
  }
}

async function removeSource(source: NewsSource): Promise<void> {
  if (!window.confirm(t('news.settings.sources.deleteConfirm', { name: source.name }))) return
  try {
    await deleteSource(source.id)
    emit('changed')
    emit('toast', t('news.toast.deleted'))
  } catch (e) {
    report(e)
  }
}

async function retry(sourceId: string): Promise<void> {
  try {
    const result = await retrySource(sourceId)
    emit('changed')
    if (result.ok) {
      emit('toast', t('news.toast.refreshed', { newItems: result.newItems }))
    } else if (result.errorKind) {
      emit('toast', errorKindText(t, result.errorKind))
    } else if (result.skipped) {
      emit('toast', t(`news.error.refresh.debounced`))
    }
  } catch (e) {
    report(e)
  }
}

async function saveCircle(draft: { id?: string; name: string; weight: number }): Promise<void> {
  try {
    if (draft.id) await updateCircle(draft.id, draft.name, draft.weight)
    else await addCircle(draft.name, draft.weight)
    circleDraft.value = null
    emit('changed')
    emit('toast', t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function removeCircle(id: string, name: string): Promise<void> {
  if (!window.confirm(t('news.settings.circles.deleteConfirm', { name }))) return
  try {
    await deleteCircle(id)
    emit('changed')
    emit('toast', t('news.toast.deleted'))
  } catch (e) {
    report(e)
  }
}

async function submitCredential(draft: CredentialDraft): Promise<void> {
  try {
    await saveCredential(draft)
    credentialDraft.value = null
    emit('changed')
    emit('toast', t('news.toast.saved'))
  } catch (e) {
    report(e)
  }
}

async function removeCredential(id: string, label: string): Promise<void> {
  if (!window.confirm(t('news.settings.credentials.deleteConfirm', { label }))) return
  try {
    await deleteCredential(id)
    emit('changed')
    emit('toast', t('news.toast.deleted'))
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
    emit('toast', t('news.settings.ai.saved'))
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
    emit('changed')
  } catch (e) {
    report(e)
  }
}

async function exportData(): Promise<void> {
  try {
    exportedJson.value = await exportJson()
    emit('toast', t('news.settings.data.exported'))
  } catch (e) {
    report(e)
  }
}

/** 下载走浏览器 Blob（不碰文件原语）；失败时上面的文本框仍可复制。 */
function downloadExport(): void {
  if (!exportedJson.value) return
  try {
    const blob = new Blob([exportedJson.value], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'news-export.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    emit('toast', t('news.toast.copyFailed'))
  }
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportedJson.value)
    emit('toast', t('news.toast.copied'))
  } catch {
    emit('toast', t('news.toast.copyFailed'))
  }
}

onMounted(async () => {
  now.value = Date.now()
  await loadAll()
  const current = aiSettings.value
  if (current) {
    aiEnabled.value = current.aiEnabled
    aiBaseUrl.value = current.aiBaseUrl
    aiModel.value = current.aiModel
  }
  await loadAutostart()
})
</script>

<style scoped>
.news-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.news-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 52px;
  padding: 0 24px;
  /* 与顶栏同一块面（--bg-sidebar）：设置页头与页签是同一层，不再各压一条横线 */
  background: var(--bg-sidebar);
  border-bottom: 0;
}
.news-settings-head h2 {
  margin: 0;
  font-size: var(--font-size-h2, 15px);
  font-weight: 600;
}
.news-settings-head .news-icon-btn {
  margin-inline-start: auto;
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-button, 8px);
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
}
.news-settings-head .news-icon-btn:hover {
  color: var(--text-primary);
}
.news-tabs {
  display: flex;
  gap: 18px;
  flex: none;
  padding: 0 24px;
  background: var(--bg-sidebar);
  border-bottom: 0;
}
.news-tabs button {
  position: relative;
  height: 40px;
  border: 0;
  background: none;
  padding: 0 1px;
  color: var(--text-secondary);
  font-size: var(--font-size-body, 13px);
  font-weight: 500;
  cursor: pointer;
}
.news-tabs button:hover {
  color: var(--text-primary);
}
.news-tabs button.on {
  color: var(--text-primary);
  font-weight: 600;
}
.news-tabs button.on::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  bottom: -1px;
  height: 2px;
  background: var(--color-info);
}
.news-settings-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px 48px;
}
/* 内容区限宽：设置项按行阅读，过宽的行长会拖垮扫读 */
.news-settings-body > * {
  max-width: 760px;
}
.news-section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 10px;
}
.news-section-head h3,
.news-subsection h3 {
  margin: 0;
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  color: var(--text-primary);
}
.news-section-head .news-primary,
.news-section-head .news-link-btn {
  margin-inline-start: auto;
}
.news-subsection {
  margin-top: 26px;
  padding-top: 8px;
  border-top: 0;
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
.news-link-btn.danger:hover {
  color: var(--color-danger-ink);
}
.news-link-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.news-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.news-list-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  /* 列表行之间用块面 + 间距分层，不再压 1px 横线 */
  border: 0;
  border-radius: var(--radius-card, 10px);
  background: var(--bg-card);
}
.news-list-row.failing .news-list-title {
  color: var(--color-danger-ink);
}
.news-list-row.muted {
  opacity: 0.65;
}
.news-list-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.news-list-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-lg, 14px);
  font-weight: 600;
}
.news-list-sub,
.news-list-status {
  font-size: var(--font-size-label, 12px);
  color: var(--text-tertiary);
}
/* 错误只露分类（人话），原始串收进可展开的详情，默认收起 */
.news-list-error {
  font-size: var(--font-size-label, 12px);
  color: var(--color-danger-ink);
}
.news-list-error summary {
  cursor: pointer;
}
.news-list-error summary::marker {
  color: var(--color-danger-ink);
}
.news-list-error-detail {
  margin: 4px 0 0;
  font-size: var(--font-size-tag, 11px);
  line-height: 1.6;
  color: var(--text-tertiary);
  word-break: break-all;
}
.news-tag {
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-tag, 6px);
  background: var(--bg-hover);
  font-size: var(--font-size-tag, 11px);
  font-weight: 500;
  color: var(--text-secondary);
}
.news-list-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  flex: none;
  justify-content: flex-end;
}
.news-note {
  margin: 8px 0 0;
  font-size: var(--font-size-label, 12px);
  line-height: 1.7;
  color: var(--text-tertiary);
}
.news-autostart {
  margin: 6px 0;
  font-size: var(--font-size-body, 13px);
}
.news-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 8px;
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
.news-field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 8px;
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
.news-field input[type='checkbox'] {
  width: 16px;
  height: 16px;
  padding: 0;
}
.news-field small {
  font-size: var(--font-size-tag, 11px);
  color: var(--text-tertiary);
}
.news-form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.news-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-label, 12px);
}
.news-table th {
  text-align: start;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid var(--border-strong);
}
.news-table td {
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
}
.news-table tr.failing td {
  color: var(--color-danger-ink);
}
.news-table .numeric {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.news-export-box {
  margin-top: 12px;
  width: 100%;
  min-height: 160px;
  padding: 10px;
  border: 1px solid var(--border-input, var(--border));
  border-radius: var(--radius-card, 10px);
  background: var(--bg-page);
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--font-size-label, 12px);
  line-height: 1.6;
  resize: vertical;
}
.news-empty {
  margin: 0;
  padding: 24px 0;
  color: var(--text-secondary);
}
.news-empty b {
  display: block;
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  margin-bottom: 4px;
}
.news-error {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-card, 10px);
  background: var(--color-danger-light);
  color: var(--color-danger-ink);
  font-size: var(--font-size-label, 12px);
}
@media (max-width: 720px) {
  .news-settings-head,
  .news-tabs,
  .news-settings-body {
    padding-inline: 12px;
  }
  .news-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .news-list-row {
    flex-direction: column;
  }
  .news-list-actions {
    justify-content: flex-start;
  }
}
</style>
