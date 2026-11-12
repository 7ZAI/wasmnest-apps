<template>
  <!-- 操作区被点时不把事件交给格子：mousedown 交给格子会先 focus 终端，
       原生 select 的下拉会被抢焦点。格子选中态由格子的 focusin 负责。 -->
  <div class="flex items-center gap-1 min-w-0 shrink" @mousedown.stop @click.stop>
    <RunAgentSelects :run="run" compact @changed="$emit('changed')" />

    <!-- 任务队列：按该运行自己的后端判据显示，不借用当前焦点运行 -->
    <button
      v-if="taskSupported"
      class="w-5 h-5 shrink-0 rounded-[4px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
      :title="t('task.title')"
      data-testid="run-tile-task"
      @click.stop="$emit('task')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M4 6h16M4 12h16M4 18h10"
        />
      </svg>
    </button>

    <button
      class="w-5 h-5 shrink-0 rounded-[4px] flex items-center justify-center text-[var(--color-danger)] hover:bg-[var(--bg-hover)] transition-colors"
      :title="t('project.run.stop')"
      data-testid="run-tile-stop"
      @click.stop="$emit('stop')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6h12v12H6z" />
      </svg>
    </button>

    <button
      class="w-5 h-5 shrink-0 rounded-[4px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
      :title="t('project.run.openWindow')"
      data-testid="run-tile-open"
      @click.stop="$emit('open')"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
        />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 拼屏格子的运行工具栏（每格一份）
 *
 * 拼屏后「停止 / 切模型 / 切思考等级 / 任务队列 / 独立开窗」都属于**某一条运行**，
 * 不能再挂在全局终端 header 上（全局 header 只有一个焦点运行，看起来像对所有格生效）。
 * 本组件只负责格子自己的控制与展示，动作经事件交给工作台编排（停止要关终端、
 * 开窗要宿主发起、任务队列要注入共享弹窗）。
 */
import { inject, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { RunView } from '@/composables/useProjects'
import RunAgentSelects from './RunAgentSelects.vue'

const props = defineProps<{ run: RunView }>()

defineEmits<{ stop: []; open: []; task: []; changed: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

/** 该运行是否适配任务域（后端 `is_supported`；不猜 agent 白名单） */
const taskSupported = ref(false)
let taskSupportSeq = 0

async function evaluateTaskSupport(): Promise<void> {
  const seq = ++taskSupportSeq
  try {
    const result = (await context.commands.execute('session.task.running-sessions')) as {
      sessions?: { session_id?: string; is_supported?: boolean }[]
    } | null
    if (seq !== taskSupportSeq) return
    const match = (result?.sessions ?? []).find((item) => item.session_id === props.run.id)
    taskSupported.value = match?.is_supported ?? false
  } catch {
    if (seq === taskSupportSeq) taskSupported.value = false
  }
}

// 桥接从离线变在线后判据可能翻转；运行 id 变化（同位置换入另一条运行）也要重取
watch(
  () => ({ runId: props.run.id, bridge: props.run.bridgeConnected }),
  () => void evaluateTaskSupport(),
  { immediate: true },
)
</script>
