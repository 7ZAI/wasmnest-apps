/**
 * 预设任务的目标扩展（项目 × agent）
 *
 * 预设任务本体仍由宿主共享 `usePresetTasks()` 持有（平台仓的 `PresetTask`
 * 没有项目/agent 字段，改宿主模型需要跨仓升级 SDK，应用侧不做）。本模块用
 * 独立 localStorage 键按预设 id 记录目标，语义与桌面 `task_preset.project_id /
 * agent_id` 一致：
 *
 * - 新增预设后写入目标；编辑时覆盖；删除时清理；
 * - 旧预设没有记录 = 未绑定，执行时回退到「选择运行」列表；
 * - 键名带 `bedcode.` 前缀，避免与宿主 `preset-tasks` 冲突。
 *
 * 读失败按空表处理（localStorage 不可用不阻断预设任务本身）。
 */

/** 预设目标（项目 + agent） */
export interface PresetTarget {
  projectId: string
  agentId: string
}

const STORAGE_KEY = 'bedcode.preset-targets'

function readAll(): Record<string, PresetTarget> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<PresetTarget>>
    const out: Record<string, PresetTarget> = {}
    for (const [id, target] of Object.entries(parsed ?? {})) {
      if (target?.projectId && target?.agentId) {
        out[id] = { projectId: target.projectId, agentId: target.agentId }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(targets: Record<string, PresetTarget>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
  } catch {
    // localStorage 不可用：目标只影响执行时的预选，不阻断预设任务
  }
}

/** 读取单个预设目标（未绑定 → null） */
export function getPresetTarget(presetId: string): PresetTarget | null {
  return readAll()[presetId] ?? null
}

/** 写入 / 覆盖预设目标；传 null 清除 */
export function setPresetTarget(presetId: string, target: PresetTarget | null): void {
  if (!presetId) return
  const all = readAll()
  if (!target || !target.projectId || !target.agentId) {
    delete all[presetId]
  } else {
    all[presetId] = { projectId: target.projectId, agentId: target.agentId }
  }
  writeAll(all)
}

/** 删除预设时清理目标 */
export function removePresetTarget(presetId: string): void {
  const all = readAll()
  if (!(presetId in all)) return
  delete all[presetId]
  writeAll(all)
}
