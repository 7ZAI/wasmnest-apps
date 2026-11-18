/**
 * 「恢复会话」glue（会话日志详情 → 一键 resume）
 *
 * 与启动会话共用同一条会话创建链（见 `sessionLaunch.ts`），差别只在命令：
 * 恢复命令由 guest 注册表按 (adapter, cliSessionId) 生成（pi / opencode
 * `--session <id>`、codex `resume <id>`、claude `--resume <id>`），前端不维护
 * 第二份映射。工作目录默认取日志里的项目绝对路径，允许用户改（项目被移动 /
 * 原始记录缺 project 时仍可恢复）。
 *
 * 失败一律留在弹窗内联呈现：命令生成失败（未知 agent / 不安全会话 ID）
 * 不静默给空命令，确认按钮由必填校验兜住。
 */
import { reactive, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { ResumeCommandInfo, UsageSessionRow } from '../types'
import { SESSION_FORM_DEFAULTS_KEY, startSession, VALID_ENVIRONMENTS } from './sessionLaunch'

/** 恢复弹窗表单模型（工作目录 / 环境 / 恢复命令均可微调） */
export interface ResumeForm {
  environment: string
  workingDir: string
  command: string
}

export function useResumeSession(context: PluginContext) {
  const open = ref(false)
  /** 恢复命令生成中（确认按钮禁用；失败落 error） */
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref('')
  /** 当前要恢复的日志会话（null = 未打开） */
  const session = ref<UsageSessionRow | null>(null)
  const agentName = ref('')
  const form = reactive<ResumeForm>({ environment: 'linux', workingDir: '', command: '' })

  /** 请求序号：快速关闭 / 切换目标时丢弃上一轮的迟到响应 */
  let seq = 0

  /** 打开弹窗并生成恢复命令；工作目录 = 日志记录的项目绝对路径 */
  async function show(target: UsageSessionRow): Promise<void> {
    const my = ++seq
    session.value = target
    agentName.value = target.adapter
    error.value = ''
    loading.value = false
    form.workingDir = target.project?.trim() ?? ''
    form.command = ''
    try {
      const defaults = (await context.storage.get(SESSION_FORM_DEFAULTS_KEY)) as
        { environment?: string } | undefined
      form.environment =
        defaults?.environment && VALID_ENVIRONMENTS.includes(defaults.environment)
          ? defaults.environment
          : 'linux'
    } catch {
      form.environment = 'linux'
    }
    open.value = true

    const cliSessionId = target.cli_session_id?.trim() ?? ''
    if (!cliSessionId) {
      // 历史 / 自定义来源的会话可能没有 CLI 会话 ID：显性拒绝，不猜一个 id
      error.value = context.i18n.t('hub.lg.resume.unsupported')
      return
    }
    loading.value = true
    try {
      const info = (await context.commands.execute('agent.get-resume-command', {
        adapter: target.adapter,
        cliSessionId,
      })) as ResumeCommandInfo | null
      if (my !== seq) return
      if (!info?.command) throw new Error('get-resume-command returned empty command')
      form.command = info.command
      if (info.displayName) agentName.value = info.displayName
    } catch (e) {
      if (my !== seq) return
      console.error('[Agent Hub] get-resume-command failed:', e)
      error.value = context.i18n.t('hub.lg.resume.unsupported')
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function close(): void {
    if (submitting.value) return
    // 关闭即作废在途命令生成结果（迟到响应不再写进已关闭的弹窗）
    seq += 1
    loading.value = false
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

  /** 确认恢复。返回 sessionId（视图层据此导航）；失败时弹窗内联呈现并返回 null */
  async function submit(): Promise<{ sessionId: string } | null> {
    if (!session.value) return null
    const workingDir = form.workingDir.trim()
    const command = form.command.trim()
    if (!workingDir || !command) {
      error.value = context.i18n.t('hub.lg.resume.required')
      return null
    }
    submitting.value = true
    error.value = ''
    try {
      const { sessionId } = await startSession(context, {
        environment: form.environment,
        workingDir,
        command,
        name: agentName.value || session.value.adapter,
      })
      open.value = false
      return { sessionId }
    } catch (e) {
      error.value = context.i18n.t('hub.lg.resume.failed')
      console.error('[Agent Hub] resume session failed:', e)
      return null
    } finally {
      submitting.value = false
    }
  }

  return {
    open,
    loading,
    submitting,
    error,
    session,
    agentName,
    form,
    show,
    close,
    submit,
    browseDir,
  }
}

export type UseResumeSessionReturn = ReturnType<typeof useResumeSession>
