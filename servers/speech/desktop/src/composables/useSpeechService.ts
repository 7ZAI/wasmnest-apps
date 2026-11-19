/**
 * Speech 服务页的数据与动作。
 *
 * 所有宿主调用都经 `env.appInvoke`（插件命令面）；本 composable 不做网络、文件
 * 或导航原语。轮询定时器在卸载时统一清理。
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import type { AppMountEnv } from '../entry'
import {
  buildPatch,
  formFromSettings,
  validateForm,
  type SettingsForm,
  type SpeechSettings,
} from './settingsForm'

export interface ModelInfo {
  id: string
  name: string
  description: string
  languages: string[]
  sizeBytes: number
  installed: boolean
  downloading: boolean
  recommended: boolean
}

export interface ModelStatus {
  modelId: string
  state: 'idle' | 'downloading' | 'verifying' | 'installed' | 'error'
  downloadedBytes: number
  totalBytes: number
  message?: string | null
}

export interface ChannelProbe {
  channel: 'local' | 'remote'
  available: boolean
  reason?: string | null
}

export interface JobView {
  jobId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  channel: 'local' | 'remote'
  modelId: string
  language?: string | null
  text?: string | null
  segments?: Array<{ text: string; startMs: number; endMs: number; isFinal: boolean }>
  error?: { kind: string; message: string } | null
  elapsedMs: number
  audioBytes?: number
}

export interface RecordEntry {
  id: string
  createdAt: number
  channel: 'local' | 'remote'
  modelId: string
  language?: string | null
  audioBytes: number
  textChars: number
  elapsedMs: number
  errorKind?: string | null
  callerTag?: string | null
}

export interface CaptureState {
  bytes: number
  level: number | null
  truncated: boolean
}

export function useSpeechService(env: AppMountEnv) {
  const settings = ref<SpeechSettings | null>(null)
  const hasKey = ref(false)
  const models = ref<ModelInfo[]>([])
  const channels = ref<ChannelProbe[]>([])
  const records = ref<RecordEntry[]>([])
  const job = ref<JobView | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const saved = ref(false)
  const formError = ref<string | null>(null)
  const recording = ref(false)
  const capture = reactive<CaptureState>({ bytes: 0, level: null, truncated: false })
  const modelStatuses = reactive<Record<string, ModelStatus>>({})
  const form = reactive<SettingsForm>(formFromSettings(defaultSettings()))

  const modelTimers = new Map<string, number>()
  let captureTimer: number | null = null
  let jobTimer: number | null = null

  function defaultSettings(): SpeechSettings {
    return {
      mode: 'auto',
      local: { enabled: true, modelId: 'small', language: 'auto' },
      remote: { enabled: false, endpoint: '', adapter: 'openai-compatible', model: 'whisper-1' },
    }
  }

  function syncForm(next: SpeechSettings | null): void {
    const source = next ?? defaultSettings()
    Object.assign(form, formFromSettings(source))
  }

  function setError(err: unknown): void {
    error.value =
      typeof err === 'string'
        ? err
        : err instanceof Error
          ? err.message
          : JSON.stringify(err)
  }

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [settingsView, modelView, channelView, recordView] = await Promise.all([
        env.appInvoke<{ settings: SpeechSettings; hasKey: boolean }>('speech.settings-get'),
        env.appInvoke<{ models: ModelInfo[] }>('speech.models-list'),
        env.appInvoke<{ channels: ChannelProbe[] }>('speech.channels-probe'),
        env.appInvoke<RecordEntry[]>('speech.records-list', { limit: 50 }),
      ])
      settings.value = settingsView.settings
      hasKey.value = settingsView.hasKey
      syncForm(settingsView.settings)
      models.value = modelView.models
      channels.value = channelView.channels
      records.value = recordView
    } catch (err) {
      setError(err)
    } finally {
      loading.value = false
    }
  }

  async function loadModels(): Promise<void> {
    try {
      const view = await env.appInvoke<{ models: ModelInfo[] }>('speech.models-list')
      models.value = view.models
    } catch (err) {
      setError(err)
    }
  }

  async function loadRecords(): Promise<void> {
    try {
      records.value = await env.appInvoke<RecordEntry[]>('speech.records-list', { limit: 50 })
    } catch (err) {
      setError(err)
    }
  }

  async function probeChannels(): Promise<void> {
    try {
      const view = await env.appInvoke<{ channels: ChannelProbe[] }>('speech.channels-probe')
      channels.value = view.channels
    } catch (err) {
      setError(err)
    }
  }

  async function save(): Promise<boolean> {
    busy.value = true
    error.value = null
    saved.value = false
    formError.value = validateForm(form, hasKey.value)
    if (formError.value) {
      busy.value = false
      return false
    }
    try {
      const view = await env.appInvoke<{ settings: SpeechSettings; hasKey: boolean }>(
        'speech.settings-set',
        buildPatch(form),
      )
      settings.value = view.settings
      hasKey.value = view.hasKey
      form.apiKey = ''
      form.clearKey = false
      syncForm(view.settings)
      saved.value = true
      await probeChannels()
      return true
    } catch (err) {
      setError(err)
      return false
    } finally {
      busy.value = false
    }
  }

  async function downloadModel(modelId: string): Promise<void> {
    error.value = null
    try {
      const status = await env.appInvoke<ModelStatus>('speech.model-download', { modelId })
      modelStatuses[modelId] = status
      await loadModels()
      startModelPolling(modelId)
    } catch (err) {
      setError(err)
    }
  }

  function startModelPolling(modelId: string): void {
    if (modelTimers.has(modelId)) return
    const timer = window.setInterval(async () => {
      try {
        const status = await env.appInvoke<ModelStatus>('speech.model-status', { modelId })
        modelStatuses[modelId] = status
        if (status.state === 'installed' || status.state === 'error') {
          stopModelTimer(modelId)
          await loadModels()
        }
      } catch (err) {
        stopModelTimer(modelId)
        setError(err)
      }
    }, 800)
    modelTimers.set(modelId, timer)
  }

  function stopModelTimer(modelId: string): void {
    const timer = modelTimers.get(modelId)
    if (timer === undefined) return
    window.clearInterval(timer)
    modelTimers.delete(modelId)
  }

  async function removeModel(modelId: string): Promise<void> {
    error.value = null
    try {
      await env.appInvoke('speech.model-remove', { modelId })
      await loadModels()
      await probeChannels()
    } catch (err) {
      setError(err)
    }
  }

  async function startCapture(): Promise<void> {
    error.value = null
    capture.bytes = 0
    capture.level = null
    capture.truncated = false
    try {
      await env.appInvoke('speech.capture-start')
      recording.value = true
      captureTimer = window.setInterval(() => {
        void pullCapture()
      }, 250)
    } catch (err) {
      recording.value = false
      setError(err)
    }
  }

  async function pullCapture(): Promise<void> {
    if (!recording.value) return
    try {
      const view = await env.appInvoke<{
        bytes: number
        level: { rms: number; peak: number; windowSamples: number } | null
        truncated: boolean
      }>('speech.capture-pull')
      capture.bytes = view.bytes
      capture.level = view.level ? view.level.rms : null
      capture.truncated = capture.truncated || view.truncated
    } catch (err) {
      recording.value = false
      setError(err)
      await abortCapture()
    }
  }

  async function stopCapture(): Promise<void> {
    if (!recording.value) return
    recording.value = false
    clearCaptureTimer()
    try {
      const view = await env.appInvoke<JobView & { audioBytes?: number }>('speech.capture-stop')
      job.value = { ...view, state: view.state ?? 'running' }
      startJobPolling(view.jobId)
      await loadRecords()
    } catch (err) {
      setError(err)
    }
  }

  async function abortCapture(): Promise<void> {
    recording.value = false
    clearCaptureTimer()
    try {
      await env.appInvoke('speech.capture-abort')
    } catch (err) {
      setError(err)
    }
  }

  function startJobPolling(jobId: string): void {
    if (jobTimer !== null) {
      window.clearInterval(jobTimer)
      jobTimer = null
    }
    const poll = async () => {
      try {
        const view = await env.appInvoke<JobView>('speech.job-result', { jobId })
        job.value = view
        if (view.state !== 'running') {
          if (jobTimer !== null) {
            window.clearInterval(jobTimer)
            jobTimer = null
          }
          await loadRecords()
        }
      } catch (err) {
        if (jobTimer !== null) {
          window.clearInterval(jobTimer)
          jobTimer = null
        }
        setError(err)
      }
    }
    void poll()
    jobTimer = window.setInterval(() => {
      void poll()
    }, 600)
  }

  async function cancelJob(): Promise<void> {
    const id = job.value?.jobId
    if (!id) return
    try {
      await env.appInvoke('speech.job-cancel', { jobId: id })
      const view = await env.appInvoke<JobView>('speech.job-result', { jobId: id })
      job.value = view
    } catch (err) {
      setError(err)
    }
  }

  function clearCaptureTimer(): void {
    if (captureTimer !== null) {
      window.clearInterval(captureTimer)
      captureTimer = null
    }
  }

  function clearTimers(): void {
    clearCaptureTimer()
    for (const timer of modelTimers.values()) {
      window.clearInterval(timer)
    }
    modelTimers.clear()
    if (jobTimer !== null) {
      window.clearInterval(jobTimer)
      jobTimer = null
    }
  }

  onBeforeUnmount(() => {
    clearTimers()
    if (recording.value) {
      void abortCapture()
    }
  })

  const localChannel = computed(() => channels.value.find((channel) => channel.channel === 'local'))
  const remoteChannel = computed(() => channels.value.find((channel) => channel.channel === 'remote'))
  const installedModels = computed(() => models.value.filter((model) => model.installed))
  const selectedModelInstalled = computed(() =>
    models.value.some((model) => model.id === form.localModel && model.installed),
  )

  return {
    settings,
    hasKey,
    models,
    channels,
    records,
    job,
    error,
    loading,
    busy,
    saved,
    formError,
    recording,
    capture,
    modelStatuses,
    form,
    localChannel,
    remoteChannel,
    installedModels,
    selectedModelInstalled,
    loadAll,
    loadModels,
    loadRecords,
    probeChannels,
    save,
    downloadModel,
    removeModel,
    startCapture,
    stopCapture,
    abortCapture,
    cancelJob,
  }
}

/** 字节数 → 人类可读（服务页诊断用） */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}