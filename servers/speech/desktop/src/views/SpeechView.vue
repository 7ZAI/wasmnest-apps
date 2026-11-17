<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppMountEnv } from '../entry'
import type { ModelInfo } from '../composables/useSpeechService'
import { formatBytes, useSpeechService } from '../composables/useSpeechService'

const env = inject<AppMountEnv>('speechEnv')
if (!env) throw new Error('speechEnv missing: mountApp must provide it')
const { t } = useI18n()
const service = useSpeechService(env)
const confirmRemove = ref<string | null>(null)

const modes = [
  { value: 'auto', key: 'modeAuto' },
  { value: 'local-only', key: 'modeLocal' },
  { value: 'remote-only', key: 'modeRemote' },
] as const

const languages = [
  { value: 'auto', key: 'languageAuto' },
  { value: 'zh', key: 'languageZh' },
  { value: 'en', key: 'languageEn' },
] as const

const levelPct = computed(() => Math.min(100, Math.round((service.capture.level ?? 0) * 100)))

const formMessage = computed(() => {
  if (service.formError.value) return t(service.formError.value)
  if (service.saved.value) return t('saved')
  return null
})

function modelStatusText(model: ModelInfo): string | null {
  const status = service.modelStatuses[model.id]
  if (!status) return null
  if (status.state === 'downloading' || status.state === 'verifying') {
    return `${t('downloading')} ${formatBytes(status.downloadedBytes)} / ${formatBytes(
      status.totalBytes || model.sizeBytes,
    )}`
  }
  if (status.state === 'installed') return t('modelInstalled')
  if (status.state === 'error') return `${t('downloadFailed')}: ${status.message ?? ''}`
  return null
}

function progressValue(model: ModelInfo): number {
  const status = service.modelStatuses[model.id]
  if (!status) return 0
  return status.totalBytes || model.sizeBytes || 1
}

function progressNow(model: ModelInfo): number {
  return service.modelStatuses[model.id]?.downloadedBytes ?? 0
}

function stateLabel(state: string): string {
  switch (state) {
    case 'completed':
      return t('jobCompleted')
    case 'failed':
      return t('jobFailed')
    case 'cancelled':
      return t('jobCancelled')
    default:
      return t('jobRunning')
  }
}

function channelLabel(channel: string): string {
  return channel === 'local' ? t('channelLocal') : t('channelRemote')
}

function recordTime(ts: number): string {
  if (!ts) return '—'
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function recordError(record: { errorKind?: string | null }): string {
  return record.errorKind ?? '—'
}

function onRemove(modelId: string): void {
  if (confirmRemove.value === modelId) {
    confirmRemove.value = null
    void service.removeModel(modelId)
    return
  }
  confirmRemove.value = modelId
}

onMounted(() => {
  void service.loadAll()
})
</script>

<template>
  <main class="speech-page" data-testid="speech-page">
    <div class="speech-wrap">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="speech-title" class="text-xl font-semibold" data-testid="speech-title">
            {{ t('title') }}
          </h1>
          <p class="speech-muted mt-1 max-w-3xl">{{ t('subtitle') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="speech-badge"
            :class="service.localChannel.value?.available ? 'speech-badge-ok' : 'speech-badge-bad'"
            data-testid="speech-channel-local"
          >
            {{ t('channelLocal') }} ·
            {{ service.localChannel.value?.available ? t('available') : t('unavailable') }}
          </span>
          <span
            class="speech-badge"
            :class="service.remoteChannel.value?.available ? 'speech-badge-ok' : 'speech-badge-bad'"
            data-testid="speech-channel-remote"
          >
            {{ t('channelRemote') }} ·
            {{ service.remoteChannel.value?.available ? t('available') : t('unavailable') }}
          </span>
          <button type="button" class="speech-btn" data-testid="speech-refresh" @click="service.loadAll">
            {{ t('refresh') }}
          </button>
        </div>
      </header>

      <p v-if="service.loading.value" class="speech-muted" role="status">{{ t('loading') }}</p>
      <p v-if="service.error.value" class="speech-alert" role="alert">
        {{ t('error') }}: {{ service.error.value }}
      </p>

      <form class="flex flex-col gap-4" aria-labelledby="speech-title" @submit.prevent="service.save">
        <section class="speech-card" data-testid="speech-settings">
          <h2>{{ t('mode') }}</h2>
          <fieldset class="mt-2 border-0 p-0">
            <legend class="speech-muted mb-2">{{ t('mode') }}</legend>
            <div class="speech-radio-row">
              <label v-for="mode in modes" :key="mode.value" class="speech-choice" :for="`mode-${mode.value}`">
                <input
                  :id="`mode-${mode.value}`"
                  v-model="service.form.mode"
                  type="radio"
                  name="speech-mode"
                  :value="mode.value"
                  :data-testid="`speech-mode-${mode.value}`"
                />
                <span>{{ t(mode.key) }}</span>
              </label>
            </div>
          </fieldset>
          <p class="speech-muted mt-2">{{ t('modeHint') }}</p>
        </section>

        <div class="speech-grid-2">
          <section class="speech-card" data-testid="speech-local">
            <div class="flex items-center justify-between gap-3">
              <h2>{{ t('local') }}</h2>
              <label class="speech-switch-row" for="speech-local-enabled">
                <input
                  id="speech-local-enabled"
                  v-model="service.form.localEnabled"
                  class="speech-switch"
                  type="checkbox"
                  role="switch"
                  :aria-checked="service.form.localEnabled"
                  data-testid="speech-local-enabled"
                />
                <span class="speech-muted">{{ t('enabled') }}</span>
              </label>
            </div>
            <p class="speech-muted">{{ t('localHint') }}</p>

            <fieldset class="mt-3 border-0 p-0">
              <legend class="speech-muted mb-2">{{ t('model') }}</legend>
              <div class="flex flex-col gap-2">
                <div
                  v-for="model in service.models.value"
                  :key="model.id"
                  class="speech-choice"
                  :data-testid="`speech-model-${model.id}`"
                >
                  <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2" :for="`model-${model.id}`">
                    <input
                      :id="`model-${model.id}`"
                      v-model="service.form.localModel"
                      type="radio"
                      name="speech-model"
                      :value="model.id"
                    />
                    <span class="min-w-0">
                      <span class="flex flex-wrap items-center gap-2">
                        <strong class="text-sm">{{ model.name }}</strong>
                        <span v-if="model.recommended" class="speech-badge">{{ t('modelRecommended') }}</span>
                        <span v-if="model.installed" class="speech-badge speech-badge-ok">
                          {{ t('installed') }}
                        </span>
                        <span v-else-if="model.downloading" class="speech-badge">
                          {{ t('downloading') }}
                        </span>
                      </span>
                      <span class="speech-muted block">{{ model.description }}</span>
                      <span class="speech-muted block">
                        {{ t('size') }}: {{ formatBytes(model.sizeBytes) }}
                      </span>
                    </span>
                  </label>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <button
                      v-if="!model.installed"
                      type="button"
                      class="speech-btn"
                      :disabled="model.downloading"
                      :data-testid="`speech-download-${model.id}`"
                      @click.stop="service.downloadModel(model.id)"
                    >
                      {{ model.downloading ? t('downloading') : t('download') }}
                    </button>
                    <button
                      v-else
                      type="button"
                      class="speech-btn speech-btn-danger"
                      :data-testid="`speech-remove-${model.id}`"
                      @click.stop="onRemove(model.id)"
                    >
                      {{ confirmRemove === model.id ? t('removeConfirm') : t('remove') }}
                    </button>
                  </div>
                </div>
                <p v-if="!service.models.value.length" class="speech-muted">{{ t('loading') }}</p>
              </div>
              <template v-for="model in service.models.value" :key="`progress-${model.id}`">
                <div v-if="model.downloading || service.modelStatuses[model.id]" class="mt-1">
                  <progress
                    v-if="service.modelStatuses[model.id]?.state === 'downloading' || service.modelStatuses[model.id]?.state === 'verifying'"
                    class="speech-progress"
                    :value="progressNow(model)"
                    :max="progressValue(model)"
                    :aria-label="`${model.name} ${t('downloading')}`"
                  ></progress>
                  <p class="speech-muted">{{ modelStatusText(model) }}</p>
                </div>
              </template>
            </fieldset>

            <fieldset class="mt-3 border-0 p-0">
              <legend class="speech-muted mb-2">{{ t('language') }}</legend>
              <div class="speech-radio-row">
                <label v-for="language in languages" :key="language.value" class="speech-choice" :for="`lang-${language.value}`">
                  <input
                    :id="`lang-${language.value}`"
                    v-model="service.form.language"
                    type="radio"
                    name="speech-language"
                    :value="language.value"
                  />
                  <span>{{ t(language.key) }}</span>
                </label>
              </div>
            </fieldset>
          </section>

          <section class="speech-card" data-testid="speech-remote">
            <div class="flex items-center justify-between gap-3">
              <h2>{{ t('remote') }}</h2>
              <label class="speech-switch-row" for="speech-remote-enabled">
                <input
                  id="speech-remote-enabled"
                  v-model="service.form.remoteEnabled"
                  class="speech-switch"
                  type="checkbox"
                  role="switch"
                  :aria-checked="service.form.remoteEnabled"
                  data-testid="speech-remote-enabled"
                />
                <span class="speech-muted">{{ t('enabled') }}</span>
              </label>
            </div>

            <div class="speech-field">
              <label for="speech-endpoint">{{ t('endpoint') }}</label>
              <input
                id="speech-endpoint"
                v-model="service.form.endpoint"
                class="speech-input"
                type="url"
                inputmode="url"
                autocomplete="off"
                spellcheck="false"
                :aria-describedby="'speech-endpoint-hint'"
                data-testid="speech-endpoint"
              />
              <span id="speech-endpoint-hint" class="speech-muted">{{ t('endpointHint') }}</span>
            </div>

            <div class="speech-field">
              <label for="speech-remote-model">{{ t('remoteModel') }}</label>
              <input
                id="speech-remote-model"
                v-model="service.form.remoteModel"
                class="speech-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                data-testid="speech-remote-model"
              />
            </div>

            <div class="speech-field">
              <label for="speech-api-key">{{ t('apiKey') }}</label>
              <input
                id="speech-api-key"
                v-model="service.form.apiKey"
                class="speech-input"
                type="password"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="none"
                autocorrect="off"
                :placeholder="service.hasKey.value ? t('apiKeySet') : ''"
                :aria-describedby="'speech-api-key-hint'"
                data-testid="speech-api-key"
              />
              <span id="speech-api-key-hint" class="speech-muted">{{ t('apiKeyHint') }}</span>
              <button
                v-if="service.hasKey.value"
                type="button"
                class="speech-btn speech-btn-danger mt-2 w-fit"
                :aria-pressed="service.form.clearKey"
                data-testid="speech-api-key-clear"
                @click="service.form.clearKey = !service.form.clearKey"
              >
                {{ t('apiKeyClear') }}
              </button>
            </div>
          </section>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" class="speech-btn speech-btn-primary" :disabled="service.busy.value" data-testid="speech-save">
            {{ t('save') }}
          </button>
          <span v-if="formMessage" class="speech-ok" role="status" data-testid="speech-save-status">
            {{ formMessage }}
          </span>
        </div>
      </form>

      <section class="speech-card" data-testid="speech-diagnostics">
        <h2>{{ t('diagnostics') }}</h2>
        <p class="speech-muted">{{ t('diagnosticsHint') }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button
            v-if="!service.recording.value"
            type="button"
            class="speech-btn speech-btn-primary"
            data-testid="speech-record-start"
            @click="service.startCapture"
          >
            {{ t('recordStart') }}
          </button>
          <template v-else>
            <button type="button" class="speech-btn speech-btn-primary" data-testid="speech-record-stop" @click="service.stopCapture">
              {{ t('recordStop') }}
            </button>
            <button type="button" class="speech-btn" data-testid="speech-record-abort" @click="service.abortCapture">
              {{ t('recordAbort') }}
            </button>
            <span class="speech-badge speech-badge-bad">{{ t('recording') }}</span>
          </template>
        </div>

        <div v-if="service.recording.value" class="mt-3">
          <div class="speech-muted mb-1">
            {{ t('captured') }}: {{ formatBytes(service.capture.bytes) }} · {{ t('level') }}
          </div>
          <div class="speech-level" role="progressbar" :aria-valuenow="levelPct" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ width: `${levelPct}%` }"></span>
          </div>
        </div>

        <div v-if="service.job.value" class="mt-3 flex flex-col gap-2" data-testid="speech-job">
          <div class="flex flex-wrap items-center gap-2">
            <span class="speech-badge" :class="service.job.value.state === 'completed' ? 'speech-badge-ok' : service.job.value.state === 'failed' ? 'speech-badge-bad' : ''">
              {{ stateLabel(service.job.value.state) }}
            </span>
            <span class="speech-badge">{{ channelLabel(service.job.value.channel) }}</span>
            <span class="speech-badge">{{ service.job.value.modelId }}</span>
            <span class="speech-muted">{{ (service.job.value.elapsedMs / 1000).toFixed(1) }} {{ t('seconds') }}</span>
            <button
              v-if="service.job.value.state === 'running'"
              type="button"
              class="speech-btn"
              data-testid="speech-job-cancel"
              @click="service.cancelJob"
            >
              {{ t('cancelJob') }}
            </button>
          </div>
          <p v-if="service.job.value.error" class="speech-alert">
            {{ t('error') }}: {{ service.job.value.error.kind }} — {{ service.job.value.error.message }}
          </p>
          <div class="speech-result" data-testid="speech-result">
            {{ service.job.value.text || t('noResult') }}
          </div>
        </div>
        <p v-else class="speech-muted mt-3">{{ t('noResult') }}</p>
      </section>

      <section class="speech-card" data-testid="speech-records">
        <div class="flex items-center justify-between gap-3">
          <h2>{{ t('records') }}</h2>
          <button type="button" class="speech-btn" data-testid="speech-records-refresh" @click="service.loadRecords">
            {{ t('refresh') }}
          </button>
        </div>
        <p class="speech-muted">{{ t('recordsHint') }}</p>
        <div v-if="service.records.value.length" class="speech-records mt-2 overflow-x-auto">
          <div class="speech-record speech-muted">
            <span>time</span><span>channel</span><span>model</span><span>bytes</span><span>chars</span><span>elapsed</span>
          </div>
          <div v-for="record in service.records.value" :key="record.id" class="speech-record">
            <span>{{ recordTime(record.createdAt) }}</span>
            <span>{{ channelLabel(record.channel) }}</span>
            <span class="truncate" :title="record.modelId">{{ record.modelId }}</span>
            <span>{{ formatBytes(record.audioBytes) }}</span>
            <span>{{ record.textChars }}</span>
            <span :class="record.errorKind ? 'speech-record-error' : ''">
              {{ (record.elapsedMs / 1000).toFixed(1) }} {{ t('seconds') }}
              <template v-if="record.errorKind"> · {{ recordError(record) }}</template>
            </span>
          </div>
        </div>
        <p v-else class="speech-muted mt-2">{{ t('emptyRecords') }}</p>
      </section>
    </div>
  </main>
</template>