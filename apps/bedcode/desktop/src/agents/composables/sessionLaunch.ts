/**
 * 会话启动共用链（Agent 卡片启动 / 日志恢复共用）
 *
 * 链路：配置复用/创建（`session.config.list` 查 (environment, workingDir,
 * command) 全同项，命中复用、未命中 `session.config.upsert` 新建）→
 * `session.create { start: true }`（launch 域做命名唯一化与两阶段启动）→
 * `session.get` 取会话名 → `context.session.openTerminal` 开终端窗。
 *
 * 启动（新建 agent 会话）与恢复（CLI resume 既有会话）只在「命令从哪来」
 * 上不同；配置复用 / 终端尺寸 / 开终端窗必须走同一份实现，避免两条链
 * 各自漂移（例如忘了传 terminal size 或没入配置表）。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 与 SessionConfigForm 的默认值同一份插件存储（上次成功保存的取值） */
export const SESSION_FORM_DEFAULTS_KEY = 'session.formDefaults'
/** 会话配置三环境（SessionConfigForm / launch / resume 共用） */
export const VALID_ENVIRONMENTS = ['linux', 'wsl2', 'windows']

export interface StartSessionOptions {
  environment: string
  workingDir: string
  command: string
  /** 会话配置名（未命中复用时的新建名；启动后仍以 session.get 的名为准） */
  name: string
}

interface SessionConfigLike {
  id?: unknown
  environment?: unknown
  workingDir?: unknown
  command?: unknown
}

/**
 * 启动一个终端会话并把会话窗口打开。
 *
 * 失败向上抛（调用方负责界面错误与重试）；成功后返回 sessionId，供视图层
 * 导航或后续操作使用。
 */
export async function startSession(
  context: PluginContext,
  opts: StartSessionOptions,
): Promise<{ sessionId: string }> {
  const configId = await ensureConfig(context, opts)
  const size = await context.session.predictTerminalSize()
  const created = (await context.commands.execute('session.create', {
    configId,
    cols: size?.cols,
    rows: size?.rows,
    start: true,
  })) as { sessionId?: string } | null
  const sessionId = created?.sessionId ?? ''
  if (!sessionId) throw new Error('session.create returned no sessionId')
  let name = opts.name
  const view = (await context.commands.execute('session.get', { sessionId })) as {
    name?: unknown
  } | null
  if (view && typeof view.name === 'string' && view.name) name = view.name
  await context.session.openTerminal({ id: sessionId, name })
  return { sessionId }
}

/** 同 (environment, workingDir, command) 配置复用；未命中新建（name 经 launch 域唯一化） */
async function ensureConfig(context: PluginContext, opts: StartSessionOptions): Promise<string> {
  const raw = (await context.commands.execute('session.config.list', {})) as unknown
  const configs: SessionConfigLike[] = Array.isArray(raw) ? raw : []
  const same = (v: unknown, want: string) => v === want
  const hit = configs.find(
    (c) =>
      !!c &&
      same(c.environment, opts.environment) &&
      same(c.workingDir, opts.workingDir) &&
      same(c.command, opts.command),
  )
  if (hit && typeof hit.id === 'string' && hit.id) return hit.id
  const saved = (await context.commands.execute('session.config.upsert', {
    name: opts.name,
    environment: opts.environment,
    workingDir: opts.workingDir,
    command: opts.command,
    autoStart: false,
  })) as { id?: unknown } | null
  if (saved && typeof saved.id === 'string' && saved.id) return saved.id
  throw new Error('session.config.upsert returned no id')
}
