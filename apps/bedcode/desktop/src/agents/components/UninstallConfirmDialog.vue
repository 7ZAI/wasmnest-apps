<script setup lang="ts">
/**
 * 概览卡片卸载确认弹窗
 *
 * 卸载是危险动作（npm 全局包 / 独立二进制将从本机移除，不可逆），
 * 以弹窗确认替代按钮原地两击确认：后果先说清楚再让用户点确认，
 * 避免误触直接发出卸载命令。
 *
 * 只做确认与在途状态呈现，动作本身经 `confirm` 上抛，由卡片层执行。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

defineProps<{
  open: boolean
  /** Agent 展示名（标题与正文用其指明卸载对象） */
  name: string
  /** 在途状态（任意在途 run / 本卡卸载中）：确认按钮禁用防连点 */
  busy?: boolean
}>()

const emit = defineEmits<{ close: []; confirm: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
</script>

<template>
  <Teleport to="body">
    <Transition name="ah-modal">
      <div
        v-if="open"
        class="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uninstall-title"
        data-testid="uninstall-dialog"
        @click.self="emit('close')"
      >
        <div class="ah-modal-panel ah-card">
          <div class="ah-modal-head">
            <h2 id="uninstall-title" class="ah-modal-title" data-testid="uninstall-dialog-title">
              {{ t('hub.card.uninstallDialogTitle', { name }) }}
            </h2>
            <button
              type="button"
              class="ah-modal-close"
              :aria-label="t('hub.boot.close')"
              :title="t('hub.boot.close')"
              data-testid="uninstall-close"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <div class="ah-modal-body">
            <p class="ah-inst-hint" data-testid="uninstall-body">
              {{ t('hub.card.uninstallDialogBody', { name }) }}
            </p>
          </div>

          <div class="ah-modal-foot">
            <button
              type="button"
              class="ah-btn ah-btn-ghost"
              data-testid="uninstall-cancel"
              @click="emit('close')"
            >
              {{ t('hub.boot.close') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-danger"
              :disabled="busy"
              data-testid="uninstall-confirm"
              @click="emit('confirm')"
            >
              {{ busy ? t('hub.card.uninstallRunning') : t('hub.card.uninstall') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
