<script setup lang="ts">
/**
 * BatchRequestDialog — 入站批量传输请求弹窗（接收端应答，spec 14.4）
 *
 * 旧宿主全局弹窗（context.ui.showDialog）退役后由挂载包自持渲染：本组件自带
 * 遮罩 + 卡片，倒计时按「批创建时刻 + 审批窗口」结算（迟到打开/排队仍准确）。
 * 超时不在这里发拒绝——宿主 TTL 负责结算（reason=timeout），本组件只上报
 * timeout，由编排层把该批标记为已提示并推进下一批。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { PendingBatch } from '../types'
import { formatBytes } from '../utils/format'

const props = defineProps<{ batch: PendingBatch; timeoutMs: number }>()
const emit = defineEmits<{ accept: []; reject: []; timeout: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const now = ref(Date.now())
const remainingSeconds = computed(() =>
  Math.max(0, Math.ceil((props.batch.createdAt + props.timeoutMs - now.value) / 1000)),
)

let tick: ReturnType<typeof setInterval> | null = null

function stopTick(): void {
  if (tick) {
    clearInterval(tick)
    tick = null
  }
}

onMounted(() => {
  if (remainingSeconds.value <= 0) {
    emit('timeout')
    return
  }
  tick = setInterval(() => {
    now.value = Date.now()
    if (remainingSeconds.value <= 0) {
      stopTick()
      emit('timeout')
    }
  }, 1000)
})

onBeforeUnmount(stopTick)
</script>

<template>
  <Teleport to="body">
    <div class="ft-batch-overlay" data-ft-batch-overlay>
      <div class="ft-batch-sheet" role="dialog" aria-modal="true">
        <div class="ft-batch-head">
          <span class="ft-dialog-title">{{ t('transfer.request.title') }}</span>
          <span
            class="ft-dialog-countdown"
            :class="{ 'ft-dialog-countdown--urgent': remainingSeconds <= 10 }"
          >
            {{ t('transfer.request.countdown', { seconds: remainingSeconds }) }}
          </span>
        </div>

        <p class="ft-batch-body">
          {{
            t('transfer.request.body', {
              name: batch.peerName || t('transfer.peer.unknown'),
              count: batch.files?.length ?? 1,
              size: formatBytes(batch.totalSize),
            })
          }}
        </p>

        <div class="ft-dialog-actions">
          <button class="ft-btn" @click="emit('reject')">
            {{ t('transfer.request.rejectAll') }}
          </button>
          <button class="ft-btn ft-btn--primary" @click="emit('accept')">
            {{ t('transfer.request.acceptAll') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-batch-overlay {
  position: fixed;
  inset: 0;
  z-index: 998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
}

.ft-batch-sheet {
  width: min(440px, calc(100vw - 48px));
  border-radius: 12px;
  background: var(--bg-elevated, var(--bg-card, #1c1a16));
  padding: 20px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}

.ft-batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ft-batch-body {
  margin: 16px 0 20px;
  color: var(--text-primary);
  font-size: var(--font-size-label);
  line-height: 1.6;
}
</style>
