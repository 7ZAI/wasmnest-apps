<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div
        v-if="visible"
        class="fixed inset-0 z-[var(--mobile-z-sheet)] flex items-end justify-center mobile-ui"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-[var(--mobile-overlay-light)]" @click="emit('close')"></div>
        <div
          class="relative bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-t-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl modal-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-[var(--mobile-border)]">
            <span class="font-semibold text-[var(--mobile-text-primary)] text-base">{{ title }}</span>
            <button
              class="p-1.5 rounded-lg hover:bg-[var(--mobile-accent-muted)] active:opacity-70 transition-colors"
              :aria-label="closeLabel"
              @click="emit('close')"
            >
              <svg class="w-5 h-5 text-[var(--mobile-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Markdown Content -->
          <div class="flex-1 overflow-y-auto p-4">
            <div class="md-body" v-html="renderedContent"></div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Markdown 文档弹窗（#18 收敛件）——底部 sheet + marked 渲染静态文档。
 * 收敛 TerminalHelpModal ≡ ShortcutHelpModal 逐字重复（二者退役）：仅差标题与
 * md 资产，本组件以 props 承载差异；locale 切换随宿主 i18n 实例响应。
 * markdown-body.css 由域 activate 统一注入（?inline 运行时挂载）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'

const props = defineProps<{
  visible: boolean
  /** 标题（父层传 t() 结果） */
  title: string
  /** 关闭按钮无障碍标签（父层传 t() 结果） */
  closeLabel: string
  /** zh-CN 文档 markdown 源文（?raw 资产） */
  markdownZh: string
  /** en 文档 markdown 源文（?raw 资产） */
  markdownEn: string
}>()

const emit = defineEmits<{
  close: []
}>()

// locale 取宿主 i18n 实例（语言切换响应式）；marked 输出走 v-html（静态资产，非用户输入）
const { locale } = useI18n()

const renderedContent = computed(() => {
  const md = locale.value === 'zh-CN' ? props.markdownZh : props.markdownEn
  return marked.parse(md) as string
})
</script>
