<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
    data-testid="relay-settings-section"
  >
    <!-- 说明 + 当前状态 -->
    <div class="px-5 py-3.5 flex items-start justify-between gap-6">
      <div class="min-w-0">
        <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">{{ t('relay.desc') }}</p>
      </div>
      <span
        v-if="config"
        data-testid="relay-state-configured"
        class="flex-shrink-0 text-[calc(12px*var(--ui-scale))] text-[var(--color-primary)]"
      >
        {{ t('relay.state.configured', { count: config.relayAddrs.length }) }}
      </span>
      <span
        v-else-if="loaded"
        data-testid="relay-state-empty"
        class="flex-shrink-0 text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >
        {{ t('relay.state.empty') }}
      </span>
    </div>

    <!-- 存储损坏：只报错，不静默清除（配置是用户唯一的中继寻址来源） -->
    <p
      v-if="loadError"
      data-testid="relay-load-error"
      role="alert"
      class="px-5 py-3.5 text-xs text-[var(--color-danger-ink)] leading-relaxed"
    >
      {{ t('relay.import.loadFailed') }}
    </p>

    <!-- 当前配置（导入成功 / 已存配置） -->
    <div v-if="config" class="px-5 py-3.5 space-y-2.5" data-testid="relay-current">
      <div class="flex items-center justify-between gap-4">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ t('relay.current.title') }}
        </span>
        <button
          data-testid="relay-import-clear"
          class="text-[calc(12px*var(--ui-scale))] text-[var(--color-danger-ink)] hover:underline disabled:opacity-50"
          :disabled="busy"
          @click="clearConfig"
        >
          {{ t('relay.import.clear') }}
        </button>
      </div>

      <div class="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[calc(12px*var(--ui-scale))]">
        <span class="text-[var(--text-tertiary)]">{{ t('relay.current.peerId') }}</span>
        <span
          data-testid="relay-current-peer-id"
          class="wb-mono text-[var(--text-secondary)] break-all"
        >
          {{ config.peerId }}
        </span>

        <span class="text-[var(--text-tertiary)]">{{ t('relay.current.fingerprint') }}</span>
        <span class="min-w-0">
          <span
            data-testid="relay-current-fingerprint"
            class="wb-mono text-[var(--text-secondary)] break-all"
          >
            {{ config.peerIdSha256 }}
          </span>
          <span data-testid="relay-current-verified" class="ml-2 text-[var(--color-primary)]">
            {{ t('relay.current.verified') }}
          </span>
        </span>

        <span class="text-[var(--text-tertiary)]">{{ t('relay.current.access') }}</span>
        <span data-testid="relay-current-access" class="text-[var(--text-secondary)]">
          {{ accessLabel }}
        </span>

        <span class="text-[var(--text-tertiary)]">{{ t('relay.current.quota') }}</span>
        <span data-testid="relay-current-quota" class="text-[var(--text-secondary)]">
          {{ quotaLabel }}
        </span>

        <span v-if="config.relayVersion" class="text-[var(--text-tertiary)]">
          {{ t('relay.current.version') }}
        </span>
        <span v-if="config.relayVersion" class="wb-mono text-[var(--text-secondary)]">
          {{ config.relayVersion }}
        </span>

        <span class="text-[var(--text-tertiary)]">{{ t('relay.current.addrs') }}</span>
        <span
          data-testid="relay-current-addrs"
          class="wb-mono text-[var(--text-secondary)] break-all"
        >
          <span v-for="addr in config.relayAddrs" :key="addr" class="block">{{ addr }}</span>
        </span>
      </div>
    </div>

    <!-- 生成部署命令 / 下载 compose（只出文本，不执行远端命令） -->
    <div class="px-5 py-3.5 space-y-3" data-testid="relay-deploy">
      <div>
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ t('relay.deploy.title') }}
        </span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5 leading-relaxed">
          {{ t('relay.deploy.desc') }}
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-[1fr_8rem_7rem] gap-3">
        <AppTextField
          v-model="advertise"
          :label="t('relay.deploy.advertise')"
          :placeholder="t('relay.deploy.advertisePlaceholder')"
          testid="relay-deploy-advertise"
        />
        <AppNumberField
          :model-value="port"
          :label="t('relay.deploy.port')"
          :min="1"
          :max="65535"
          testid="relay-deploy-port"
          @update:model-value="port = $event"
        />
        <AppTextField
          v-model="version"
          :label="t('relay.deploy.version')"
          testid="relay-deploy-version"
        />
      </div>

      <div
        class="inline-flex items-center gap-1 rounded-[8px] border border-[var(--border-strong)] p-0.5"
        role="group"
        :aria-label="t('relay.deploy.title')"
      >
        <button
          v-for="opt in deployModes"
          :key="opt.value"
          :data-testid="`relay-deploy-mode-${opt.value}`"
          class="px-2.5 py-1 rounded-[6px] text-[calc(12px*var(--ui-scale))] transition-colors"
          :class="
            mode === opt.value
              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          "
          :aria-pressed="mode === opt.value"
          @click="mode = opt.value"
        >
          {{ t(opt.labelKey) }}
        </button>
      </div>

      <p
        v-if="deployError"
        data-testid="relay-deploy-error"
        class="text-xs text-[var(--color-danger-ink)]"
      >
        {{ t(deployError) }}
      </p>
      <p
        v-else-if="!deployText"
        data-testid="relay-deploy-empty"
        class="text-xs text-[var(--text-tertiary)]"
      >
        {{ t('relay.deploy.emptyHint') }}
      </p>

      <template v-if="deployText">
        <pre
          data-testid="relay-deploy-output"
          class="wb-mono max-h-72 overflow-auto rounded-[8px] bg-[var(--bg-input)] border border-[var(--border)] p-3 text-[calc(11.5px*var(--ui-scale))] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-all"
          >{{ deployText }}</pre>
        <div class="flex items-center gap-2">
          <button class="wb-btn-ghost" data-testid="relay-deploy-copy" @click="copyDeploy">
            {{ t('relay.deploy.copy') }}
          </button>
          <button
            v-if="mode === 'compose'"
            class="wb-btn-ghost"
            data-testid="relay-deploy-download"
            @click="downloadCompose"
          >
            {{ t('relay.deploy.download') }}
          </button>
        </div>
      </template>

      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">
        {{ t('relay.deploy.imageHint', { repo: RELAY_IMAGE_REPO }) }}
      </p>
      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">
        {{ t('relay.deploy.noCreds') }}
      </p>
    </div>

    <!-- 导入 relay 地址 -->
    <div class="px-5 py-3.5 space-y-3" data-testid="relay-import">
      <div>
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ t('relay.import.title') }}
        </span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5 leading-relaxed">
          {{ t('relay.import.desc') }}
        </p>
      </div>

      <AppTextField
        v-model="importText"
        multiline
        :rows="5"
        :placeholder="t('relay.import.placeholder')"
        testid="relay-import-input"
      />

      <div class="flex items-center gap-3">
        <button
          class="wb-btn-primary"
          data-testid="relay-import-submit"
          :disabled="busy || !importText.trim()"
          @click="submitImport"
        >
          {{ t('relay.import.submit') }}
        </button>
        <span
          v-if="importOk"
          data-testid="relay-import-ok"
          class="text-xs text-[var(--color-primary)]"
        >
          {{ t('relay.import.success') }}
        </span>
      </div>

      <p
        v-if="importError"
        data-testid="relay-import-error"
        role="alert"
        class="text-xs text-[var(--color-danger-ink)] leading-relaxed"
      >
        {{ t(importError.key) }}
        <code v-if="importError.detail" class="wb-mono block mt-1 break-all">{{
          importError.detail
        }}</code>
      </p>
    </div>

    <!-- 检测连通性（宿主 relay 拨号原语尚未装配：显性提示 + 服务器侧自检出路） -->
    <div class="px-5 py-3.5 space-y-2" data-testid="relay-probe">
      <div>
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ t('relay.probe.title') }}
        </span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5 leading-relaxed">
          {{ t('relay.probe.desc') }}
        </p>
      </div>
      <button class="wb-btn-ghost" data-testid="relay-probe-button" disabled>
        {{ t('relay.probe.action') }}
      </button>
      <p v-if="!config" data-testid="relay-probe-empty" class="text-xs text-[var(--text-tertiary)]">
        {{ t('relay.probe.empty') }}
      </p>
      <p
        data-testid="relay-probe-unsupported"
        class="text-xs text-[var(--color-warning-ink)] leading-relaxed"
      >
        {{ t('relay.probe.unsupported') }}
      </p>
      <pre
        data-testid="relay-probe-doctor"
        class="wb-mono rounded-[8px] bg-[var(--bg-input)] border border-[var(--border)] p-3 text-[calc(11.5px*var(--ui-scale))] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-all"
        >{{ doctorCommand }}</pre>
      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">
        {{ t('relay.probe.publicHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RelaySettingsSection — 设置页「中转服务器」分组正文（T14）
 *
 * 只做三件事：生成部署文本、导入 / 校验 relay 地址、展示当前配置与探测出路。
 * **不**在应用内 SSH、不保存服务器凭据、不代执行远端命令；enrollment token 由
 * 服务器侧 `wasmnest-relay token create` 单独产出。
 *
 * 连通性检测：T14 设计要求「复用 T02 引擎 relay 拨号 + 宿主 lookup_host」，但
 * 当前宿主 SDK 尚未装配 relay/tunnel 面（平台 T06）。这里**不伪造**能力：按钮显性
 * 禁用并给服务器侧 `doctor` 出路；T06 落地后把按钮接到宿主探测命令即可（身份
 * 校验与 RTT 文案已就位）。
 *
 * 读写：`appEnv.appStorageGet/Set/Delete`（插件 KV `network.relay`，见
 * `useRelaySettings`）；导入解析与部署文本生成是纯函数（`src/relay/**`）。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AppMountEnv } from '@/entry'
import { useAppI18n } from '@/composables/useAppI18n'
import { useToast } from '@/composables/useToast'
import { useRelaySettings } from '@/composables/useRelaySettings'
import AppTextField from '@/components/ui/AppTextField.vue'
import AppNumberField from '@/components/ui/AppNumberField.vue'
import {
  RELAY_DEFAULT_PORT,
  RELAY_DEFAULT_VERSION,
  RELAY_IMAGE_REPO,
  buildRelayDeployText,
  type RelayDeployMode,
} from '@/relay/relayDeploy'
import { parseRelayImport, type RelayImportErrorKey } from '@/relay/relayImport'

const env = inject<AppMountEnv | null>('appEnv', null)
const t = useAppI18n()
const toast = useToast()
const { config, loaded, loadError, load, save, clear } = useRelaySettings(env)

// ==================== 部署文本 ====================

const advertise = ref('')
const port = ref<number | null>(RELAY_DEFAULT_PORT)
const version = ref(RELAY_DEFAULT_VERSION)
const mode = ref<RelayDeployMode>('compose')

const deployModes: Array<{ value: RelayDeployMode; labelKey: string }> = [
  { value: 'compose', labelKey: 'relay.deploy.mode.compose' },
  { value: 'docker', labelKey: 'relay.deploy.mode.docker' },
  { value: 'systemd', labelKey: 'relay.deploy.mode.systemd' },
]

/** 没填对外域名时不出文本也不报错（先给空态提示） */
const deployResult = computed(() => {
  if (!advertise.value.trim()) return null
  return buildRelayDeployText(mode.value, {
    advertise: advertise.value,
    port: port.value ?? 0,
    version: version.value,
  })
})

const deployText = computed(() => (deployResult.value?.ok ? deployResult.value.text : ''))
const deployError = computed(() =>
  deployResult.value && !deployResult.value.ok ? deployResult.value.errorKey : null,
)

/** 服务器侧自检命令（探测能力未装配时的可操作出路） */
const doctorCommand = computed(() =>
  [
    'wasmnest-relay doctor --config /data/config.toml',
    'wasmnest-relay print-addrs --config /data/config.toml --json',
  ].join('\n'),
)

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走失败提示（不静默说「已复制」）
  }
  return false
}

async function copyDeploy(): Promise<void> {
  if (!deployText.value) return
  const copied = await copyText(deployText.value)
  if (copied) toast.success(t('relay.deploy.copied'))
  else toast.error(t('relay.deploy.copyFailed'))
}

function downloadCompose(): void {
  if (!deployText.value) return
  if (typeof URL.createObjectURL !== 'function') {
    toast.error(t('relay.deploy.downloadFailed'))
    return
  }
  const blob = new Blob([deployText.value], { type: 'application/yaml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'docker-compose.yml'
  anchor.click()
  URL.revokeObjectURL(url)
}

// ==================== 导入 / 保存 ====================

const importText = ref('')
const importError = ref<{
  key: RelayImportErrorKey | 'relay.import.saveFailed'
  detail?: string
} | null>(null)
const importOk = ref(false)
const busy = ref(false)

async function submitImport(): Promise<void> {
  if (busy.value) return
  busy.value = true
  importError.value = null
  importOk.value = false
  try {
    const result = await parseRelayImport(importText.value)
    if (!result.ok) {
      importError.value = { key: result.errorKey, detail: result.detail }
      return
    }
    try {
      await save(result.value)
    } catch {
      importError.value = { key: 'relay.import.saveFailed' }
      return
    }
    importText.value = ''
    importOk.value = true
    toast.success(t('relay.import.success'))
  } finally {
    busy.value = false
  }
}

async function clearConfig(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await clear()
    importOk.value = false
    toast.success(t('relay.import.cleared'))
  } catch {
    toast.error(t('relay.import.clearFailed'))
  } finally {
    busy.value = false
  }
}

// ==================== 展示派生 ====================

const accessLabel = computed(() => {
  switch (config.value?.accessMode) {
    case 'open':
      return t('relay.current.accessOpen')
    case 'allowlist':
      return t('relay.current.accessAllowlist')
    default:
      return t('relay.current.accessUnknown')
  }
})

const quotaLabel = computed(() => {
  const quota = config.value?.quota
  if (!quota) return t('relay.current.quotaUnknown')
  return t('relay.current.quotaValue', {
    bytes: quota.maxCircuitBytes.toLocaleString(),
    secs: quota.maxCircuitDurationSecs.toLocaleString(),
  })
})

onMounted(async () => {
  try {
    await load()
  } catch {
    // 读取失败保持 fail-visible：loadError 由 useRelaySettings 的解析分支兜底，
    // 这里只避免未处理异常打断设置页其余分组
  }
})
</script>
