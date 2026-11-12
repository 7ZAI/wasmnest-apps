<script setup lang="ts">
/**
 * Nest 占位视图（共享组件，双端同构 · 票 05 骨架）
 *
 * 双端入口（桌面 `desktop/src/entry.ts` / 移动 `mobile/src/index.ts`）各自把
 * 宿主适配后的 ping 函数传进来，组件本身不依赖任何端侧 API（不碰 vue-i18n
 * 实例、不碰宿主全局），保持共享核的端无关性。
 *
 * 挂载后自动执行一次 ping，把「前端 → 共享 crate 命令 → 宿主返回」链路的
 * 状态显性呈现：idle → running → ok / error（spec §2.4 失败语义：点名缺什么，
 * 不静默返回空）。文案由各端 i18n 经 props 传入（组件内不做翻译，避免共享核
 * 引入端侧 i18n 依赖的构建形态差异）。
 */
import { onMounted, ref } from 'vue'
import type { AssistantPingResult, PlaceholderPingState } from '../types'

const props = defineProps<{
  /** 标题（各端 i18n 译文，如「Nest」/「巢」） */
  title: string
  /** 副标题（各端 i18n 译文） */
  subtitle: string
  /** 状态文案（各端 i18n 译文：idle / running / ok / error 四态） */
  stateLabel: (state: PlaceholderPingState) => string
  /** 结果行文案（各端 i18n 译文，参数为结果对象） */
  resultLabel: (result: AssistantPingResult) => string
  /** ping 函数（各端绑定本端宿主命令调用面）；缺省不验证，只显示标题 */
  ping?: () => Promise<AssistantPingResult>
}>()

const state = ref<PlaceholderPingState>({ status: 'idle' })

onMounted(async () => {
  if (!props.ping) return
  state.value = { status: 'running' }
  try {
    const result = await props.ping()
    state.value = { status: 'ok', result }
  } catch (e) {
    state.value = {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    }
  }
})
</script>

<template>
  <div class="nest-placeholder" data-testid="nest-placeholder">
    <div class="nest-placeholder__card">
      <div class="nest-placeholder__icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="56" height="56">
          <path
            d="M8 30c4-8 10-12 16-12s12 4 16 12c0 8-8 12-16 12S8 38 8 30z"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <circle cx="24" cy="26" r="4.5" fill="currentColor" />
        </svg>
      </div>
      <h1 class="nest-placeholder__title">{{ title }}</h1>
      <p class="nest-placeholder__subtitle">{{ subtitle }}</p>

      <p
        class="nest-placeholder__state"
        :class="`nest-placeholder__state--${state.status}`"
        data-testid="nest-placeholder-state"
      >
        {{ stateLabel(state) }}
      </p>

      <p v-if="state.status === 'error'" class="nest-placeholder__error" data-testid="nest-placeholder-error">
        {{ state.message }}
      </p>
      <p v-if="state.status === 'ok'" class="nest-placeholder__result" data-testid="nest-placeholder-result">
        {{ resultLabel(state.result) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.nest-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 0;
  padding: 2rem 1.5rem;
  background: var(--bg-page, #f6f7f9);
  color: var(--text-primary, #1f2329);
}

.nest-placeholder__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  max-width: 32rem;
  padding: 2.5rem 2rem;
  border: 1px solid var(--border-secondary, #e5e6eb);
  border-radius: var(--radius-card, 12px);
  background: var(--bg-surface, #ffffff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
  text-align: center;
}

.nest-placeholder__icon {
  color: var(--accent-primary, #2f6fed);
}

.nest-placeholder__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.nest-placeholder__subtitle {
  margin: 0;
  font-size: 0.875rem;
  opacity: 0.7;
}

.nest-placeholder__state {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: var(--bg-hover, #f2f3f5);
}

.nest-placeholder__state--ok {
  color: var(--success, #1a7f37);
  background: var(--success-bg, #e8f5ec);
}

.nest-placeholder__state--error {
  color: var(--danger, #d4380d);
  background: var(--danger-bg, #fdecea);
}

.nest-placeholder__state--running {
  color: var(--accent-primary, #2f6fed);
  background: var(--accent-bg, #eaf1fe);
}

.nest-placeholder__error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--danger, #d4380d);
  word-break: break-all;
}

.nest-placeholder__result {
  margin: 0;
  font-size: 0.8125rem;
  opacity: 0.75;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
