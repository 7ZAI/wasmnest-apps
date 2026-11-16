<script setup lang="ts">
/**
 * RelayConfigSection — 移动端设置页「内网穿透配置」区块
 *
 * 区块收口「外网接入」的全部内容：
 * - 接入信息：relay 地址 / 来源 / 中继状态 / 空间码 / 获取时间（只读展示）
 *   + 扫码导入（穿透配置分享 v1）；
 * - 拨号策略：中继（外网）开关 + 中继提示阈值（父组件经 `#relay` 插槽注入，
 *   逻辑与样式仍住在 SettingsSection，避免两套设置实例）。
 *
 * 移动端没有配置中心：导入即写本应用设置（`import-relay-config`，来源 `qr`），
 * 后端校验地址 / 空间码后再收敛中继预留。空间码只在分享携带非空值时对齐。
 *
 * 内网同步获取（从已配对设备拉配置）依赖能力仓对端配置接口，当前宿主未提供；
 * 界面显性说明，不摆一个按了没反应的按钮。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useMyDevice } from '../composables/useMyDevice'
import type { RelayConfigShare } from '../utils/pairingLink'
import { formatSyncedAt, maskRelayAddr, relaySourceKey, relayStateKey } from '../utils/relayConfig'
import ScanPanel from './ScanPanel.vue'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const my = useMyDevice(context)

/** 地址默认脱敏；点「显示完整地址」展开 */
const revealed = ref(false)
/** 扫码面板打开（只收穿透配置分享） */
const scanning = ref(false)
/** 非 null = 停在导入确认（此时不写任何设置） */
const pending = ref<RelayConfigShare | null>(null)
const importing = ref(false)
const importFailed = ref(false)
/** 同步状态（'' = 未操作；synced 成功；其余为后端 status 令牌） */
const syncStatus = ref('')
const syncing = ref(false)

/** 后端 status → 文案 key（未知 status 不猜，按失败提示并保留原文） */
const SYNC_STATUS_KEYS: Record<string, string> = {
  synced: 'transfer.relayConfig.syncSynced',
  'no-peer': 'transfer.relayConfig.syncNoPeer',
  'not-trusted': 'transfer.relayConfig.syncNotTrusted',
  'not-connected': 'transfer.relayConfig.syncNotConnected',
  'no-config': 'transfer.relayConfig.syncNoConfig',
  'invalid-config': 'transfer.relayConfig.syncInvalidConfig',
  unsupported: 'transfer.relayConfig.syncUnsupported',
  'fetch-failed': 'transfer.relayConfig.syncFailed',
}

onMounted(() => {
  void my.load()
})

const addrs = computed(() => my.info.value.relayAddrs)
const sourceText = computed(() => t(relaySourceKey(my.info.value.relaySource)))
const stateText = computed(() => t(relayStateKey(my.info.value.relayState)))
const syncedAtText = computed(() => formatSyncedAt(my.info.value.relaySyncedAt ?? 0))

/** 导入会替换当前配置（地址集合 / 空间码任一不同即提示） */
const replacesCurrent = computed(() => {
  const target = pending.value
  if (!target) return false
  const current = my.info.value
  const sameAddrs =
    current.relayAddrs.length === target.relayAddrs.length &&
    target.relayAddrs.every((addr) => current.relayAddrs.includes(addr))
  const sameRoom = !target.room || target.room === (current.relayRoom ?? '')
  return !(sameAddrs && sameRoom)
})

function displayAddr(addr: string): string {
  return revealed.value ? addr : maskRelayAddr(addr)
}

function openScan(): void {
  importFailed.value = false
  pending.value = null
  scanning.value = true
}

function closeScan(): void {
  scanning.value = false
}

/** 扫到配置：停在确认页，不直接覆盖本机配置 */
function onScanned(share: RelayConfigShare): void {
  scanning.value = false
  importFailed.value = false
  pending.value = share
}

function cancelImport(): void {
  pending.value = null
  importFailed.value = false
}

/** 确认导入：地址 / 空间码 / 来源 / 同步时刻一并写入（后端整批校验） */
async function confirmImport(): Promise<void> {
  const target = pending.value
  if (!target || importing.value) return
  importing.value = true
  importFailed.value = false
  try {
    await context.commands.execute('file-transfer.import-relay-config', {
      source: 'qr',
      relayAddrs: target.relayAddrs,
      // 分享未带空间码 = relay-wide：不清除本机既有空间码
      ...(target.room ? { room: target.room } : {}),
      syncedAt: Date.now(),
    })
    pending.value = null
    await my.load()
    context.dialogs.showToast(t('transfer.relayConfig.imported'), 'success')
  } catch (e) {
    importFailed.value = true
    console.error('[File Transfer] import relay config failed:', e)
  } finally {
    importing.value = false
  }
}

const syncText = computed(() => {
  if (!syncStatus.value) return ''
  return t(SYNC_STATUS_KEYS[syncStatus.value] ?? 'transfer.relayConfig.syncFailed')
})

/**
 * 从当前活跃的可信设备同步配置（后端只接受既有会话，不隐式拨号）。
 * 后端所有可预期失败都以 status 返回，这里逐项映射；成功后再读一遍展示面。
 */
async function syncFromPeer(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  syncStatus.value = ''
  try {
    const result = await context.commands.execute('file-transfer.sync-peer-relay-config', {
      syncedAt: Date.now(),
    })
    const status = typeof result?.status === 'string' ? result.status : 'fetch-failed'
    syncStatus.value = status
    if (status === 'synced') {
      await my.load()
      context.dialogs.showToast(t('transfer.relayConfig.syncSynced'), 'success')
    }
  } catch (e) {
    syncStatus.value = 'fetch-failed'
    console.error('[File Transfer] sync peer relay config failed:', e)
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <section class="space-y-2" data-testid="mobile-settings-section-relay-config">
    <h2 class="settings-section-title">{{ t('transfer.relayConfig.title') }}</h2>

    <!-- 扫码（全屏取景）：只收穿透配置分享二维码 -->
    <ScanPanel v-if="scanning" :t="t" @relay-config="onScanned" @close="closeScan" />

    <p v-if="my.loading.value" class="settings-desc" data-testid="mobile-relay-config-loading">
      {{ t('transfer.relayConfig.loading') }}
    </p>
    <p
      v-else-if="my.loadError.value"
      class="ft-device-error"
      data-testid="mobile-relay-config-load-error"
    >
      {{ t('transfer.relayConfig.loadFailed') }}
    </p>

    <div v-else class="settings-group">
      <!-- 未配置：只给原因与可执行下一步 -->
      <div v-if="addrs.length === 0" class="settings-row">
        <div class="flex-1 min-w-0" data-testid="mobile-relay-config-empty">
          <div class="settings-label">{{ t('transfer.relayConfig.emptyTitle') }}</div>
          <div class="settings-desc">{{ t('transfer.relayConfig.empty') }}</div>
        </div>
      </div>
      <template v-else>
        <div class="settings-row">
          <div class="flex-1 min-w-0">
            <div class="settings-label">{{ t('transfer.relayConfig.addresses') }}</div>
            <div class="ft-relay-addrs" data-testid="mobile-relay-config-list">
              <code v-for="addr in addrs" :key="addr" data-testid="mobile-relay-config-addr">{{
                displayAddr(addr)
              }}</code>
            </div>
          </div>
          <button
            class="ft-relay-mini-btn flex-shrink-0"
            data-testid="mobile-relay-config-reveal"
            @click="revealed = !revealed"
          >
            {{ revealed ? t('transfer.relayConfig.hideAddr') : t('transfer.relayConfig.showAddr') }}
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-label">{{ t('transfer.relayConfig.source') }}</div>
          <div class="settings-value" data-testid="mobile-relay-config-source">
            {{ sourceText }}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">{{ t('transfer.relayConfig.relayState') }}</div>
          <div class="settings-value" data-testid="mobile-relay-config-state">
            {{ stateText }}
          </div>
        </div>
        <div v-if="my.info.value.relayRoom" class="settings-row">
          <div class="settings-label">{{ t('transfer.relayConfig.room') }}</div>
          <code class="settings-value" data-testid="mobile-relay-config-room">{{
            my.info.value.relayRoom
          }}</code>
        </div>
        <div v-if="syncedAtText" class="settings-row">
          <div class="settings-label">{{ t('transfer.relayConfig.syncedAt') }}</div>
          <div class="settings-value" data-testid="mobile-relay-config-synced-at">
            {{ syncedAtText }}
          </div>
        </div>
      </template>
    </div>

    <!-- 拨号策略（中继开关 / 提示阈值）：由设置页以 #relay 插槽注入，
         与本区块同属「内网穿透配置」 -->
    <slot name="relay" />

    <p
      v-if="my.info.value.relayError"
      class="ft-device-error"
      data-testid="mobile-relay-config-error"
    >
      {{ t('transfer.relayConfig.centerError', { message: my.info.value.relayError }) }}
    </p>

    <!-- 导入确认页：先展示将改什么，再落设置 -->
    <div v-if="pending" class="ft-relay-confirm" data-testid="mobile-relay-config-confirm">
      <p class="settings-label">{{ t('transfer.relayConfig.confirmTitle') }}</p>
      <p class="settings-desc" data-testid="mobile-relay-config-confirm-relay">
        {{ pending.relayAddrs.join(', ') }}
      </p>
      <p v-if="pending.room" class="settings-desc" data-testid="mobile-relay-config-confirm-room">
        {{ t('transfer.relayConfig.room') }}：{{ pending.room }}
      </p>
      <p
        v-if="replacesCurrent"
        class="ft-device-error"
        data-testid="mobile-relay-config-confirm-replace"
      >
        {{ t('transfer.relayConfig.confirmReplace') }}
      </p>
      <p v-if="importFailed" class="ft-device-error" data-testid="mobile-relay-config-import-error">
        {{ t('transfer.relayConfig.importFailed') }}
      </p>
      <div class="ft-relay-confirm-actions">
        <button class="fv2-btn-text" data-testid="mobile-relay-config-cancel" @click="cancelImport">
          {{ t('transfer.relayConfig.cancel') }}
        </button>
        <button
          class="fv2-btn-primary"
          :disabled="importing"
          data-testid="mobile-relay-config-import"
          @click="confirmImport"
        >
          {{ importing ? t('transfer.relayConfig.importing') : t('transfer.relayConfig.import') }}
        </button>
      </div>
    </div>

    <div class="ft-relay-actions">
      <button class="fv2-btn-primary" data-testid="mobile-relay-config-scan" @click="openScan">
        {{ t('transfer.relayConfig.scanImport') }}
      </button>
      <button class="fv2-btn-text" data-testid="mobile-relay-config-refresh" @click="my.load()">
        {{ t('transfer.relayConfig.refresh') }}
      </button>
    </div>

    <!-- 内网同步获取：只接受既有会话（后端不隐式拨号），失败按 status 逐项说明 -->
    <div class="ft-relay-actions">
      <button
        class="fv2-btn-text"
        :disabled="syncing"
        data-testid="mobile-relay-config-sync"
        @click="syncFromPeer"
      >
        {{ syncing ? t('transfer.relayConfig.syncing') : t('transfer.relayConfig.syncNow') }}
      </button>
    </div>
    <p
      v-if="syncText"
      class="settings-desc"
      :class="{ 'ft-device-error': syncStatus !== 'synced' }"
      data-testid="mobile-relay-config-sync-status"
    >
      {{ syncText }}
    </p>
  </section>
</template>

<style scoped>
.ft-relay-addrs {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.ft-relay-addrs code {
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  background: var(--ft-bg-tertiary);
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-xs);
  color: var(--ft-text-secondary);
  overflow-wrap: anywhere;
}

.ft-relay-mini-btn {
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--ft-border);
  background: var(--ft-bg-elevated);
  color: var(--ft-accent-text);
  font-size: var(--font-size-sm);
}

.ft-relay-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.ft-relay-confirm {
  padding: 0.75rem;
  border: 1px solid var(--ft-border-strong);
  border-radius: 0.75rem;
  background: var(--ft-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.ft-relay-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

/* 行内错误：与设备行同一视觉（红字，不占按钮位） */
.ft-device-error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--ft-error);
}
</style>
