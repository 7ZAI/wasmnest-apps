/**
 * 「启动会话」glue（安装 → 使用的闭环）：从 agent 卡片直接拉起一个运行该
 * agent 的终端会话。
 *
 * 链路：配置复用/创建（`session.config.list` 查 (environment, workingDir,
 * command) 全同项，命中复用、未命中 `session.config.upsert` 新建）→
 * `session.create { start: true }`（launch 域做命名唯一化与两阶段启动）→
 * `session.get` 取会话名 → `context.session.openTerminal` 开终端窗。
 * 目录选取走 `@tauri-apps/plugin-dialog`（与 SessionConfigForm.browseDir 同一
 * 形态；非 Tauri 环境显性失败留日志，路径保持可手填）。会话启动后由视图层
 * 导航到 /sessions（本 composable 不持路由）。
 *
 * 命令取值固定为目标 agent 的 `binary`：卡片语义就是「启动这个 agent」。
 * `session.formDefaults` 只承接环境与工作目录——它的 `command` 是会话中心
 * 上次保存的任意命令（可能是另一个 agent），拿来覆盖会让卡片启动错对象。
 */
import { reactive, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { AgentDescriptor } from '../types'
import { SESSION_FORM_DEFAULTS_KEY, startSession, VALID_ENVIRONMENTS } from './sessionLaunch'

/** 弹窗表单模型（environment 值域 = 会话配置三环境） */
export interface LaunchForm {
  environment: string
  workingDir: string
  command: string
}

export function useLaunchSession(context: PluginContext) {
  const open = ref(false)
  const submitting = ref(false)
  const error = ref('')
  const agent = ref<AgentDescriptor | null>(null)
  const form = reactive<LaunchForm>({ environment: 'linux', workingDir: '', command: '' })

  /**
   * 打开弹窗：环境 / 工作目录预填 = 插件存储的会话表单默认值（读取失败不阻断，
   * 可手填）；启动命令恒取目标 agent 的 `binary`，不被默认值的 command 覆盖。
   */
  async function show(target: AgentDescriptor): Promise<void> {
    agent.value = target
    error.value = ''
    form.command = target.binary
    try {
      const defaults = (await context.storage.get(SESSION_FORM_DEFAULTS_KEY)) as
        { environment?: string; workingDir?: string } | undefined
      form.environment =
        defaults?.environment && VALID_ENVIRONMENTS.includes(defaults.environment)
          ? defaults.environment
          : 'linux'
      form.workingDir = defaults?.workingDir ?? ''
    } catch {
      form.environment = 'linux'
      form.workingDir = ''
    }
    open.value = true
  }

  function close(): void {
    if (submitting.value) return
    open.value = false
  }

  /** 系统目录选取框（Tauri 环境；失败静默留日志，表单保持可手填） */
  async function browseDir(): Promise<void> {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: form.workingDir || undefined,
      })
      if (selected) form.workingDir = selected as string
    } catch (e) {
      console.error('[agents] browse directory failed:', e)
    }
  }

  /** 确认启动。返回 sessionId（视图层据此导航）；失败时弹窗内联呈现并返回 null */
  async function submit(): Promise<{ sessionId: string } | null> {
    if (!agent.value) return null
    const workingDir = form.workingDir.trim()
    const command = form.command.trim()
    if (!workingDir || !command) {
      error.value = context.i18n.t('hub.launch.required')
      return null
    }
    submitting.value = true
    error.value = ''
    try {
      const { sessionId } = await startSession(context, {
        environment: form.environment,
        workingDir,
        command,
        name: agent.value.displayName,
      })
      open.value = false
      return { sessionId }
    } catch (e) {
      error.value = context.i18n.t('hub.launch.failed')
      console.error('[agents] launch session failed:', e)
      return null
    } finally {
      submitting.value = false
    }
  }

  return { open, submitting, error, agent, form, show, close, submit, browseDir }
}

export type UseLaunchSessionReturn = ReturnType<typeof useLaunchSession>
