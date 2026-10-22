/**
 * Node.js 环境引导编排（P3）
 *
 * - 挂载时拉取持久化状态（host-storage `bootstrap` 键）与「计划」（确认弹窗
 *   展示版本 / 目标平台 / 来源 / 大小 / 校验值，**不启动**流水线）
 * - guest 每次阶段变化全量 emit `plugin:agent-hub:bootstrap`，本 composable
 *   订阅覆盖本地状态；与 `detection` 同模式按单调 `seq` 过滤乱序旧事件
 * - 失败一律走 `{ ok:false, error }`（友好 i18n 文案，ADR 0030：原文只进日志），
 *   不向上抛——调用方据此决定是否保留弹窗
 * - `remove()` 是 P4 的移除环境（删版本目录 + 摘 PATH，保留 npm 全局目录与缓存）；
 *   与 `start()` 共用 guest 侧串行锁（在途安装 / 引导时返回 busy）
 */
import { computed, onUnmounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { resolvePluginErrorText } from '../utils/pluginError'
import type { BootstrapPlan, BootstrapState } from '../types'

export interface BootstrapStartResult {
  ok: boolean
  /** 友好文案（guest 业务码优先；原文只进 console） */
  error?: string
}

export interface BootstrapRemoveResult {
  ok: boolean
  /** guest 是否真的移除了东西（幂等：没装过时返回 false 且不改状态） */
  removed?: boolean
  error?: string
}

export function useBootstrap(context: PluginContext) {
  const state = ref<BootstrapState | null>(null)
  const plan = ref<BootstrapPlan | null>(null)
  /** 命令在途（点「开始」到 guest 受理之间；防止连点重复触发） */
  const starting = ref(false)
  /** 已接受的最新事件 seq（0 = 尚未收到带 seq 的事件） */
  let lastSeq = 0

  async function refresh() {
    try {
      const data = await context.commands.execute('agent-hub.get-bootstrap-state', {})
      if (data?.state) state.value = data.state as BootstrapState
      if (data?.plan) plan.value = data.plan as BootstrapPlan
    } catch (e) {
      console.error('[Agent Hub] get-bootstrap-state failed', e)
    }
  }

  /**
   * 启动引导：guest 先跑 preflight（架构 / 工具 / 磁盘），再下载校验解压登记。
   * 已有可用 node 时 guest 直接返回 `alreadyReady` 的 done 状态（不下载）。
   */
  async function start(): Promise<BootstrapStartResult> {
    if (starting.value) return { ok: true }
    starting.value = true
    try {
      const data = await context.commands.execute('agent-hub.bootstrap-env', {})
      if (data?.state) state.value = data.state as BootstrapState
      return { ok: true }
    } catch (e) {
      // busy / 重复触发等用户可见拒绝：原文只进日志，界面取友好文案
      console.error('[Agent Hub] bootstrap-env failed', e)
      return { ok: false, error: resolvePluginErrorText(context, e, 'hub.boot.failed.generic') }
    } finally {
      starting.value = false
    }
  }

  /** 取消在途引导（guest 侧 kill 进程 + 清临时物，幂等） */
  async function cancel() {
    try {
      await context.commands.execute('agent-hub.cancel-bootstrap', {})
    } catch (e) {
      console.error('[Agent Hub] cancel-bootstrap failed', e)
    }
  }

  /** 移除引导中（防连点；guest 侧同样有串行锁，这里只是界面遮罩） */
  const removing = ref(false)

  /**
   * 移除本插件安装的 Node.js 运行时（P4）：删版本目录 + 摘 PATH 条目，
   * 保留 `npm-global`（已装 CLI）与下载缓存。幂等：没装过也返回成功。
   */
  async function remove(): Promise<BootstrapRemoveResult> {
    if (removing.value) return { ok: true }
    removing.value = true
    try {
      const data = await context.commands.execute('agent-hub.remove-env', {})
      if (data?.state) state.value = data.state as BootstrapState
      return { ok: true, removed: data?.removed === true }
    } catch (e) {
      console.error('[Agent Hub] remove-env failed', e)
      return { ok: false, error: resolvePluginErrorText(context, e, 'hub.remove.failed') }
    } finally {
      removing.value = false
    }
  }

  const subscription = context.events.on(
    'plugin:agent-hub:bootstrap',
    (payload: BootstrapState) => {
      const seq = payload?.seq ?? 0
      if (seq > 0 && seq < lastSeq) return
      lastSeq = seq
      state.value = payload
    },
  )

  onUnmounted(() => {
    subscription.dispose()
  })

  /** 是否有在途引导（互斥判定在 guest 侧，前端只渲染） */
  const running = computed(() => state.value?.active === true)
  const phase = computed(() => state.value?.phase ?? 'idle')

  return {
    state,
    plan,
    starting,
    removing,
    running,
    phase,
    refresh,
    start,
    cancel,
    remove,
  }
}

export type UseBootstrapReturn = ReturnType<typeof useBootstrap>
