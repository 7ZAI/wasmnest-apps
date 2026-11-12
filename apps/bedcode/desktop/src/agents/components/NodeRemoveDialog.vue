<script setup lang="ts">
/**
 * 移除 Node.js 运行时确认弹窗（P4）
 *
 * 只做确认与结果呈现，动作由父层调 `agent-hub.remove-env`（guest 侧串行锁 +
 * 幂等）。为什么必须是弹窗而不是一键：移除会让已装的 npm 全局 CLI 暂时跑不起来
 * （它们依赖 Node.js），必须先把后果说清楚。
 *
 * 文案契约（spec §P4）：确认弹窗必须包含「已装 CLI 会暂时无法运行；重新安装
 * Node.js 后恢复」，且说明保留 npm 全局目录与下载缓存（不擅自删用户已装的 CLI）。
 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

const props = defineProps<{
  open: boolean
  /** 本插件安装的版本（展示用；缺失显示 —） */
  version?: string | null
  /** 命令在途（禁用按钮，防连点） */
  busy?: boolean
  /** 失败文案（命令面拒绝 / 异常；原文只进日志） */
  error?: string | null
}>()

const emit = defineEmits<{ close: []; confirm: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const versionText = computed(() => props.version || '—')
</script>

<template>
  <Teleport to="body">
    <Transition name="ah-modal">
      <div
        v-if="open"
        class="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        data-testid="remove-dialog"
        @click.self="emit('close')"
      >
        <div class="ah-modal-panel ah-card">
          <div class="ah-modal-head">
            <h2 id="remove-title" class="ah-modal-title">{{ t('hub.remove.title') }}</h2>
            <button
              type="button"
              class="ah-modal-close"
              :aria-label="t('hub.boot.close')"
              :title="t('hub.boot.close')"
              data-testid="remove-close"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <div class="ah-modal-body">
            <div class="ah-env-row">
              <span class="ah-env-label">{{ t('hub.boot.row.version') }}</span>
              <span class="ah-env-value ah-mono" data-testid="remove-version">{{ versionText }}</span>
            </div>
            <p class="ah-inst-hint" data-testid="remove-body">{{ t('hub.remove.body') }}</p>
            <div class="ah-cli-error" data-testid="remove-warning">{{ t('hub.remove.warning') }}</div>
            <div v-if="error" class="ah-cli-error" data-testid="remove-error">{{ error }}</div>
          </div>

          <div class="ah-modal-foot">
            <button
              type="button"
              class="ah-btn ah-btn-ghost"
              data-testid="remove-cancel"
              @click="emit('close')"
            >
              {{ t('hub.boot.close') }}
            </button>
            <button
              type="button"
              class="ah-btn ah-btn-warn"
              :disabled="busy"
              data-testid="remove-confirm"
              @click="emit('confirm')"
            >
              {{ busy ? t('hub.remove.working') : t('hub.remove.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
