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
 */
import { reactive, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { AgentDescriptor } from '../types'

/** 弹窗表单模型（environment 值域 = 会话配置三环境） */
export interface LaunchForm {
  environment: string
  workingDir: string
  command: string
}

/** 与 SessionConfigForm 的默认值同一份插件存储（上次成功保存的取值） */
const FORM_DEFAULTS_KEY = 'session.formDefaults'
const VALID_ENVIRONMENTS = ['linux', 'wsl2', 'windows']

interface SessionConfigLike {
  id?: unknown
  environment?: unknown
  workingDir?: unknown
  command?: unknown
}

export function useLaunchSession(context: PluginContext) {
  const open = ref(false)
  const submitting = ref(false)
  const error = ref('')
  const agent = ref<AgentDescriptor | null>(null)
  const form = reactive<LaunchForm>({ environment: 'linux', workingDir: '', command: '' })

  /** 打开弹窗：表单预填 = 插件存储的会话表单默认值（读取失败不阻断，可手填） */
  async function show(target: AgentDescriptor): Promise<void> {
    agent.value = target
    error.value = ''
    form.command = target.binary
    try {
      const defaults = (await context.storage.get(FORM_DEFAULTS_KEY)) as
        | { environment?: string; workingDir?: string; command?: string }
        | undefined
      form.environment =
        defaults?.environment && VALID_ENVIRONMENTS.includes(defaults.environment)
          ? defaults.environment
          : 'linux'
      form.workingDir = defaults?.workingDir ?? ''
      if (defaults?.command && defaults.command.trim()) form.command = defaults.command
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
      const configId = await ensureConfig(workingDir, command, form.environment)
      const size = await context.session.predictTerminalSize()
      const created = (await context.commands.execute('session.create', {
        configId,
        cols: size?.cols,
        rows: size?.rows,
        start: true,
      })) as { sessionId?: string } | null
      const sessionId = created?.sessionId ?? ''
      if (!sessionId) throw new Error('session.create returned no sessionId')
      let name = agent.value.displayName
      const view = (await context.commands.execute('session.get', { sessionId })) as
        | { name?: unknown }
        | null
      if (view && typeof view.name === 'string' && view.name) name = view.name
      await context.session.openTerminal({ id: sessionId, name })
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

  /** 同 (environment, workingDir, command) 配置复用；未命中新建（name 经 launch 域唯一化） */
  async function ensureConfig(
    workingDir: string,
    command: string,
    environment: string,
  ): Promise<string> {
    const raw = (await context.commands.execute('session.config.list', {})) as unknown
    const configs: SessionConfigLike[] = Array.isArray(raw) ? raw : []
    const same = (v: unknown, want: string) => v === want
    const hit = configs.find(
      (c) =>
        !!c &&
        same(c.environment, environment) &&
        same(c.workingDir, workingDir) &&
        same(c.command, command),
    )
    if (hit && typeof hit.id === 'string' && hit.id) return hit.id
    const saved = (await context.commands.execute('session.config.upsert', {
      name: agent.value?.displayName ?? command,
      environment,
      workingDir,
      command,
      autoStart: false,
    })) as { id?: unknown } | null
    if (saved && typeof saved.id === 'string' && saved.id) return saved.id
    throw new Error('session.config.upsert returned no id')
  }

  return { open, submitting, error, agent, form, show, close, submit, browseDir }
}

export type UseLaunchSessionReturn = ReturnType<typeof useLaunchSession>
