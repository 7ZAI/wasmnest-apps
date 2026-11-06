/**
 * 终端会话域模型（插件侧自持副本）
 *
 * 宿主 `SessionInfo` 的按值复制（插件不引宿主模块的既有约定——同
 * `BUILTIN_MENU_ORDERS` 槽位常量先例，票 18 核对口径）。字段与线协议 DTO
 * 对齐，保持 camelCase / snake_case 双形态兼容（老端忽略未知字段）。
 */
export interface SessionInfo {
  id: string
  name: string
  config_id: string
  configId?: string
  status: string
  session_type?: string
  sessionType?: string
  created_at: string
  createdAt?: string
  startedAt?: string
  stoppedAt?: string
  /** 任务执行状态（Plugin 会话使用） */
  taskStatus?: string
  /** 任务状态原因 */
  taskReason?: string
}

/**
 * 会话是否可能持有 PTY（resize / 输入等 PTY 命令的前置判据）
 *
 * `stopped` / `error` 的 PTY 已回收、`idle` 从未启动，对它们发 PTY 命令宿主会以
 * 「会话缺少 PTY 句柄」显性报错。`error` 经 `session.get`（`SessionInfoView`）读出
 * 时是 externally-tagged 的 `{ error: "…" }` 对象，同样视为无 PTY。
 */
export function sessionHasPty(status: unknown): boolean {
  if (typeof status !== 'string') return false
  return status !== 'idle' && status !== 'stopped' && status !== 'error'
}
