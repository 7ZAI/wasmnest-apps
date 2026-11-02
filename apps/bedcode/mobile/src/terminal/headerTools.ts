/**
 * 终端 Header 工具栏的图标与文案真源（issue #19）
 *
 * 旧实现把六个工具项的 SVG 与 `v-if` 分支在「常驻按钮」和「溢出菜单」各写
 * 一遍（新增一项要改两处、两份图标容易漂移）。这里收敛为一张表：
 * 新增工具项 = 表里加一条 + `ALL_TOOLBAR_ITEMS`（TerminalView）加一条。
 *
 * 文案沿用旧实现的 key（`terminal.pendingTasks` 等），不改用户可见文案。
 */

export interface HeaderToolIcon {
  /** SVG path 的 `d` 序列（多段按序渲染） */
  paths: string[]
  /** true = 实心图标（fill），false/缺省 = 描边图标（stroke） */
  filled?: boolean
}

/** 图标表：key 与 `ToolbarItemConfig.key` 对齐 */
export const HEADER_TOOL_ICONS: Record<string, HeaderToolIcon> = {
  task: {
    filled: true,
    paths: [
      'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.59-2.58-2.57-1.42 1.41 4 3.99z',
    ],
  },
  autoTask: {
    paths: ['M4 6h16M4 11h11M4 16h8', 'M15 15l4 2.5-4 2.5v-5z'],
  },
  shortcut: {
    paths: ['M4 6h16M4 12h16M4 18h16M8 6v12M16 6v12'],
  },
  clear: {
    paths: [
      'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    ],
  },
  refresh: {
    paths: [
      'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    ],
  },
  settings: {
    paths: [
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
      'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    ],
  },
  folder: {
    paths: ['M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z'],
  },
}

/** 文案键表（沿用旧实现，避免文案回归） */
export const HEADER_TOOL_LABEL_KEYS: Record<string, string> = {
  task: 'terminal.pendingTasks',
  autoTask: 'terminal.toolbarAutoTask',
  shortcut: 'shortcutConfig.title',
  clear: 'terminal.clearScreen',
  refresh: 'terminal.refreshFormat',
  settings: 'terminal.settings',
  folder: 'terminal.files',
}
