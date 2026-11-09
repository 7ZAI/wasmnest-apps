<script setup lang="ts">
/**
 * 网络配置中心主界面（桌面服务型 wasm）
 *
 * 承载原 BedCode「中转服务器」卡片的全部内容（部署文本、地址导入、指纹展示、
 * 连通性出路），并新增业务 WAN 注册表。所有写操作只走本插件命令面
 * （`net-config.relay.*` / `net-config.wan-policy.*`）——本页是配置的唯一写入口。
 *
 * 边界：本页不拨号、不代任何业务 `expose` / `connect`；业务仍按自己的权限与时机
 * 调宿主隧道原语。
 *
 * 失败语义（fail-visible）：
 * - 中心命令失败 / 存储损坏 → 显性错误横幅，**不**降级成「未配置」；
 * - 导入非法 / 保存失败 → 明确原因，不显示「已保存」假象；
 * - 连通性探测在宿主未装配时按钮禁用 + 服务器侧自检出路，不伪造可用。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { NetConfigContext } from '@/appContext'
import { useRelayConfig } from '@/composables/useRelayConfig'
import { useWanPolicy } from '@/composables/useWanPolicy'
import {
  RELAY_DEFAULT_PORT,
  RELAY_DEFAULT_VERSION,
  RELAY_IMAGE_REPO,
  buildRelayDeployText,
  type RelayDeployMode,
} from '@/relay/relayDeploy'
import { parseRelayImport, type RelayImportErrorKey } from '@/relay/relayImport'
import WanPolicyCard from './WanPolicyCard.vue'

const context = inject<NetConfigContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const relay = useRelayConfig(context)
const wan = useWanPolicy(context)

const wanError = ref<string | null>(null)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ==================== 部署文本 ====================

const advertise = ref('')
const port = ref<number | null>(RELAY_DEFAULT_PORT)
const version = ref(RELAY_DEFAULT_VERSION)
const mode = ref<RelayDeployMode>('compose')
const copyState = ref<'idle' | 'ok' | 'failed'>('idle')
const downloadFailed = ref(false)

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
const doctorCommand = ['wasmnest-relay doctor --config /data/config.toml', 'wasmnest-relay print-addrs --config /data/config.toml --json'].join(
  '\n',
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
  copyState.value = (await copyText(deployText.value)) ? 'ok' : 'failed'
}

function downloadCompose(): void {
  downloadFailed.value = false
  if (!deployText.value) return
  if (typeof URL.createObjectURL !== 'function') {
    downloadFailed.value = true
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

// ==================== 导入 / 移除 ====================

const importText = ref('')
const importError = ref<{
  key: RelayImportErrorKey | 'relay.import.saveFailed'
  detail?: string
} | null>(null)
const importOk = ref(false)
const clearOk = ref(false)

async function submitImport(): Promise<void> {
  if (relay.busy.value) return
  importError.value = null
  importOk.value = false
  clearOk.value = false
  const result = await parseRelayImport(importText.value)
  if (!result.ok) {
    importError.value = { key: result.errorKey, detail: result.detail }
    return
  }
  try {
    await relay.save(result.value)
  } catch {
    importError.value = { key: 'relay.import.saveFailed' }
    return
  }
  importText.value = ''
  importOk.value = true
}

async function removeConfig(): Promise<void> {
  if (relay.busy.value) return
  importOk.value = false
  clearOk.value = false
  try {
    await relay.clear()
    clearOk.value = true
  } catch {
    importError.value = { key: 'relay.import.saveFailed' }
  }
}

// ==================== 业务注册表 ====================

async function loadWan(): Promise<void> {
  await wan.load()
  wanError.value = wan.loadError.value
}

async function toggleWan(pluginId: string, allowWan: boolean): Promise<void> {
  try {
    await wan.set(pluginId, allowWan)
    wanError.value = null
  } catch (error) {
    wanError.value = messageOf(error)
  }
}

const allowedWanCount = computed(
  () => wan.rows.value.filter((row) => row.entry?.allowWan).length,
)
/** 已配置地址但所有业务都关着外网：状态必须区分「未配置」与「配置了但关闭」 */
const configuredButWanOff = computed(
  () => relay.config.value !== null && allowedWanCount.value === 0,
)

// ==================== 展示派生 ====================

const accessLabel = computed(() => {
  switch (relay.config.value?.accessMode) {
    case 'open':
      return t('relay.current.accessOpen')
    case 'allowlist':
      return t('relay.current.accessAllowlist')
    default:
      return t('relay.current.accessUnknown')
  }
})

const quotaLabel = computed(() => {
  const quota = relay.config.value?.quota
  if (!quota) return t('relay.current.quotaUnknown')
  return t('relay.current.quotaValue', {
    bytes: quota.maxCircuitBytes.toLocaleString(),
    secs: quota.maxCircuitDurationSecs.toLocaleString(),
  })
})

const sourceLabel = computed(() =>
  relay.config.value?.source === 'text'
    ? t('relay.current.sourceText')
    : t('relay.current.sourceJson'),
)

onMounted(async () => {
  await Promise.all([relay.load(), loadWan()])
})
</script>

<template>
  <div class="nc-page" data-testid="net-config-page">
    <header class="nc-topbar">
      <div class="nc-wrap nc-topbar-inner">
        <span class="nc-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="2.2" />
            <circle cx="5" cy="5.5" r="1.8" />
            <circle cx="19" cy="5.5" r="1.8" />
            <circle cx="5" cy="18.5" r="1.8" />
            <circle cx="19" cy="18.5" r="1.8" />
            <path d="M6.4 6.8 10.3 10.3M17.6 6.8 13.7 10.3M6.4 17.2l3.9-3.5M17.6 17.2l-3.9-3.5" />
          </svg>
        </span>
        <div class="nc-heading">
          <h1 class="nc-title">{{ t('title') }}</h1>
          <p class="nc-sub">{{ t('subtitle') }}</p>
        </div>
        <button class="nc-btn nc-refresh" :disabled="relay.busy.value" data-testid="net-config-refresh" @click="relay.load(); loadWan()">
          {{ t('refresh') }}
        </button>
      </div>
    </header>

    <main class="nc-wrap nc-main">
      <!-- 当前配置 -->
      <section class="nc-card" data-testid="net-config-current-card">
        <div class="nc-card-head">
          <h2 class="nc-h2">{{ t('relay.current.title') }}</h2>
          <span
            v-if="relay.config.value"
            data-testid="net-config-state-configured"
            class="nc-state is-ok"
          >
            {{ t('relay.state.configured', { count: relay.config.value.relayAddrs.length }) }}
          </span>
          <span
            v-else-if="relay.loaded.value && !relay.loadError.value"
            data-testid="net-config-state-empty"
            class="nc-state is-muted"
          >
            {{ t('relay.state.empty') }}
          </span>
          <span v-if="clearOk" class="nc-ok" data-testid="net-config-relay-cleared">
            {{ t('relay.import.cleared') }}
          </span>
        </div>

        <p v-if="relay.loadError.value" class="nc-error" role="alert" data-testid="net-config-load-error">
          {{ t('relay.import.loadFailed') }}
          <code class="nc-mono nc-break">{{ relay.loadError.value }}</code>
        </p>

        <div v-if="relay.config.value" class="nc-meta" data-testid="net-config-current">
          <div>
            <span class="nc-dt">{{ t('relay.current.peerId') }}</span>
            <span class="nc-dd nc-mono nc-break" data-testid="net-config-current-peer-id">
              {{ relay.config.value.peerId }}
            </span>
          </div>
          <div>
            <span class="nc-dt">{{ t('relay.current.fingerprint') }}</span>
            <span class="nc-dd">
              <span class="nc-mono nc-break" data-testid="net-config-current-fingerprint">
                {{ relay.config.value.peerIdSha256 }}
              </span>
              <span class="nc-verified" data-testid="net-config-current-verified">
                {{ t('relay.current.verified') }}
              </span>
            </span>
          </div>
          <div>
            <span class="nc-dt">{{ t('relay.current.access') }}</span>
            <span class="nc-dd" data-testid="net-config-current-access">{{ accessLabel }}</span>
          </div>
          <div>
            <span class="nc-dt">{{ t('relay.current.quota') }}</span>
            <span class="nc-dd" data-testid="net-config-current-quota">{{ quotaLabel }}</span>
          </div>
          <div v-if="relay.config.value.relayVersion">
            <span class="nc-dt">{{ t('relay.current.version') }}</span>
            <span class="nc-dd nc-mono">{{ relay.config.value.relayVersion }}</span>
          </div>
          <div>
            <span class="nc-dt">{{ t('relay.current.importedAt') }}</span>
            <span class="nc-dd nc-mono" data-testid="net-config-current-imported-at">
              {{ relay.config.value.importedAt }}
            </span>
          </div>
          <div>
            <span class="nc-dt">{{ t('relay.current.source') }}</span>
            <span class="nc-dd" data-testid="net-config-current-source">{{ sourceLabel }}</span>
          </div>
          <div class="nc-meta-wide">
            <span class="nc-dt">{{ t('relay.current.addrs') }}</span>
            <span class="nc-dd nc-mono nc-break" data-testid="net-config-current-addrs">
              <span v-for="addr in relay.config.value.relayAddrs" :key="addr" class="nc-block">{{ addr }}</span>
            </span>
          </div>
        </div>

        <div v-if="relay.config.value" class="nc-actions">
          <button
            class="nc-btn nc-btn-danger"
            data-testid="net-config-import-clear"
            :disabled="relay.busy.value"
            @click="removeConfig"
          >
            {{ t('relay.import.clear') }}
          </button>
        </div>
      </section>

      <!-- 业务注册表 -->
      <WanPolicyCard
        :rows="wan.rows.value"
        :error-text="wanError"
        :busy="wan.busy.value"
        :t="t"
        @toggle="toggleWan"
      />

      <p
        v-if="configuredButWanOff"
        class="nc-note"
        data-testid="net-config-wan-off-hint"
      >
        已配置中转地址，但当前没有业务允许走外网：业务仍可局域网访问，跨网入口保持关闭。
      </p>

      <!-- 部署文本 -->
      <section class="nc-card" data-testid="net-config-deploy">
        <h2 class="nc-h2">{{ t('relay.deploy.title') }}</h2>
        <p class="nc-hint">{{ t('relay.deploy.desc') }}</p>

        <div class="nc-grid">
          <label class="nc-field">
            <span class="nc-dt">{{ t('relay.deploy.advertise') }}</span>
            <input
              v-model="advertise"
              class="nc-input"
              type="text"
              :placeholder="t('relay.deploy.advertisePlaceholder')"
              data-testid="net-config-deploy-advertise"
            />
          </label>
          <label class="nc-field nc-field-narrow">
            <span class="nc-dt">{{ t('relay.deploy.port') }}</span>
            <input
              :value="port ?? ''"
              class="nc-input"
              type="number"
              min="1"
              max="65535"
              data-testid="net-config-deploy-port"
              @input="port = Number(($event.target as HTMLInputElement).value) || null"
            />
          </label>
          <label class="nc-field nc-field-narrow">
            <span class="nc-dt">{{ t('relay.deploy.version') }}</span>
            <input
              v-model="version"
              class="nc-input"
              type="text"
              data-testid="net-config-deploy-version"
            />
          </label>
        </div>

        <div class="nc-modes" role="group" :aria-label="t('relay.deploy.title')">
          <button
            v-for="opt in deployModes"
            :key="opt.value"
            class="nc-mode"
            :class="{ 'is-active': mode === opt.value }"
            :data-testid="`net-config-deploy-mode-${opt.value}`"
            :aria-pressed="mode === opt.value"
            @click="mode = opt.value"
          >
            {{ t(opt.labelKey) }}
          </button>
        </div>

        <p v-if="deployError" class="nc-error" data-testid="net-config-deploy-error">
          {{ t(deployError) }}
        </p>
        <p v-else-if="!deployText" class="nc-hint" data-testid="net-config-deploy-empty">
          {{ t('relay.deploy.emptyHint') }}
        </p>

        <template v-if="deployText">
          <pre class="nc-pre" data-testid="net-config-deploy-output">{{ deployText }}</pre>
          <div class="nc-actions">
            <button class="nc-btn" data-testid="net-config-deploy-copy" @click="copyDeploy">
              {{ t('relay.deploy.copy') }}
            </button>
            <button
              v-if="mode === 'compose'"
              class="nc-btn"
              data-testid="net-config-deploy-download"
              @click="downloadCompose"
            >
              {{ t('relay.deploy.download') }}
            </button>
            <span v-if="copyState === 'ok'" class="nc-ok" data-testid="net-config-deploy-copied">
              {{ t('relay.deploy.copied') }}
            </span>
            <span
              v-else-if="copyState === 'failed'"
              class="nc-error-inline"
              data-testid="net-config-deploy-copy-failed"
            >
              {{ t('relay.deploy.copyFailed') }}
            </span>
            <span
              v-if="downloadFailed"
              class="nc-error-inline"
              data-testid="net-config-deploy-download-failed"
            >
              {{ t('relay.deploy.downloadFailed') }}
            </span>
          </div>
        </template>

        <p class="nc-hint">{{ t('relay.deploy.imageHint', { repo: RELAY_IMAGE_REPO }) }}</p>
        <p class="nc-hint">{{ t('relay.deploy.noCreds') }}</p>
      </section>

      <!-- 导入 -->
      <section class="nc-card" data-testid="net-config-import">
        <h2 class="nc-h2">{{ t('relay.import.title') }}</h2>
        <p class="nc-hint">{{ t('relay.import.desc') }}</p>

        <textarea
          v-model="importText"
          class="nc-input nc-textarea"
          rows="5"
          :placeholder="t('relay.import.placeholder')"
          data-testid="net-config-import-input"
        />

        <div class="nc-actions">
          <button
            class="nc-btn nc-btn-primary"
            data-testid="net-config-import-submit"
            :disabled="relay.busy.value || !importText.trim()"
            @click="submitImport"
          >
            {{ t('relay.import.submit') }}
          </button>
          <span v-if="importOk" class="nc-ok" data-testid="net-config-import-ok">
            {{ t('relay.import.success') }}
          </span>
        </div>

        <p v-if="importError" class="nc-error" role="alert" data-testid="net-config-import-error">
          {{ t(importError.key) }}
          <code v-if="importError.detail" class="nc-mono nc-break nc-block">{{ importError.detail }}</code>
        </p>
      </section>

      <!-- 连通性探测（宿主原语未装配：不伪造可用） -->
      <section class="nc-card" data-testid="net-config-probe">
        <h2 class="nc-h2">{{ t('relay.probe.title') }}</h2>
        <p class="nc-hint">{{ t('relay.probe.desc') }}</p>
        <button class="nc-btn" data-testid="net-config-probe-button" disabled>
          {{ t('relay.probe.action') }}
        </button>
        <p v-if="!relay.config.value" class="nc-hint" data-testid="net-config-probe-empty">
          {{ t('relay.probe.empty') }}
        </p>
        <p class="nc-warn" data-testid="net-config-probe-unsupported">
          {{ t('relay.probe.unsupported') }}
        </p>
        <pre class="nc-pre" data-testid="net-config-probe-doctor">{{ doctorCommand }}</pre>
        <p class="nc-hint">{{ t('relay.probe.publicHint') }}</p>
      </section>
    </main>
  </div>
</template>
