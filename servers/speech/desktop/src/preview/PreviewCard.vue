<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppPreviewEnv } from '../entry'
import type { SpeechSettings } from '../composables/settingsForm'

const env = inject<AppPreviewEnv>('speechPreviewEnv')
if (!env) throw new Error('speechPreviewEnv missing: mountPreview must provide it')
const { t } = useI18n()
const settings = ref<SpeechSettings | null>(null)

function modeLabel(mode: string): string {
  switch (mode) {
    case 'local-only':
      return t('modeLocal')
    case 'remote-only':
      return t('modeRemote')
    default:
      return t('modeAuto')
  }
}

onMounted(async () => {
  try {
    const stored = await env.appStorageGet<SpeechSettings>('speech.settings')
    settings.value = stored ?? null
  } catch {
    settings.value = null
  }
})
</script>

<template>
  <article class="speech-card m-3" data-testid="speech-preview">
    <h2>{{ t('previewTitle') }}</h2>
    <p class="speech-muted mt-1">{{ modeLabel(settings?.mode ?? 'auto') }}</p>
    <p class="speech-muted">
      {{ t('previewModel') }}:
      {{ settings?.local.modelId ?? t('previewNoModel') }}
    </p>
    <p class="speech-muted">
      {{ settings?.remote.enabled ? t('previewRemote') : t('previewRemoteOff') }}
    </p>
  </article>
</template>