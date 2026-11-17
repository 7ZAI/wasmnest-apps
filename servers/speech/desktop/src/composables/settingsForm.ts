/**
 * 设置表单的纯逻辑：默认值 / 从服务设置同步 / 生成补丁 / 前置校验。
 *
 * 后端仍做最终校验；这里只把明显缺项在提交前标出来，避免无意义往返。
 */

export interface SpeechSettings {
  mode: 'auto' | 'local-only' | 'remote-only'
  local: { enabled: boolean; modelId: string; language: string }
  remote: { enabled: boolean; endpoint: string; adapter: string; model: string }
}

export interface SettingsForm {
  mode: SpeechSettings['mode']
  localEnabled: boolean
  localModel: string
  language: string
  remoteEnabled: boolean
  endpoint: string
  remoteModel: string
  apiKey: string
  clearKey: boolean
}

export const DEFAULT_FORM: SettingsForm = {
  mode: 'auto',
  localEnabled: true,
  localModel: 'small',
  language: 'auto',
  remoteEnabled: false,
  endpoint: '',
  remoteModel: 'whisper-1',
  apiKey: '',
  clearKey: false,
}

export function formFromSettings(settings: SpeechSettings): SettingsForm {
  return {
    mode: settings.mode,
    localEnabled: settings.local.enabled,
    localModel: settings.local.modelId,
    language: settings.local.language,
    remoteEnabled: settings.remote.enabled,
    endpoint: settings.remote.endpoint,
    remoteModel: settings.remote.model,
    apiKey: '',
    clearKey: false,
  }
}

/** 校验码（前端映射为 i18n key；后端仍会再校验一次） */
export type FormError = 'endpointRequired' | 'endpointInvalid' | 'apiKeyRequired'

export function validateForm(form: SettingsForm, hasKey: boolean): FormError | null {
  if (!form.remoteEnabled) return null
  const endpoint = form.endpoint.trim()
  if (!endpoint) return 'endpointRequired'
  if (!/^https?:\/\//i.test(endpoint)) return 'endpointInvalid'
  if (!hasKey && !form.apiKey.trim()) return 'apiKeyRequired'
  if (form.clearKey) return 'apiKeyRequired'
  return null
}

/** 生成 `settings-set` 补丁；密钥只在用户输入或明确清除时出现 */
export function buildPatch(form: SettingsForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    mode: form.mode,
    local: {
      enabled: form.localEnabled,
      modelId: form.localModel.trim(),
      language: form.language,
    },
    remote: {
      enabled: form.remoteEnabled,
      endpoint: form.endpoint.trim(),
      adapter: 'openai-compatible',
      model: form.remoteModel.trim(),
    },
  }
  if (form.apiKey.trim()) {
    patch.apiKey = form.apiKey.trim()
  } else if (form.clearKey) {
    patch.apiKey = ''
  }
  return patch
}