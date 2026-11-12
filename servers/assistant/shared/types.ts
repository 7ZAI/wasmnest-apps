/**
 * Nest 助手共享 TS 核 —— 类型（骨架阶段，票 05）
 *
 * spec §5.1（D3 双端同构）：助手应用的共享 TS 核住应用级 `shared/` 目录，
 * 双端只写入口与宿主适配。本文件是骨架阶段的共享类型定义；后续票
 * （07 数据底座 / 08 对话主链路 / 12 记忆 / 13 工具运行时）在此处续接，
 * 形状以 spec 为裁决面。
 *
 * 不单独发布：双端经相对路径 import，构建期各自内联进本端 bundle
 * （桌面自足挂载包；移动经 SDK vite 插件外置宿主全局）。
 */

/** 插件身份（与双端 plugin.json 的 id 一致） */
export const ASSISTANT_PLUGIN_ID = 'com.wasmnest.assistant'

/** 骨架阶段命令 id（唯一命令入口；真实命令面随对应票加入） */
export const ASSISTANT_PING_COMMAND = 'assistant.ping'

/**
 * `assistant.ping` 命令返回
 *
 * 用途：证明「前端 appInvoke → 共享 crate invoke_command → 宿主返回」链路
 * 在双端都通。骨架阶段只此一条命令；返回形状在此钉住，后续命令的形状
 * 同样在本文件定义（共享核单一类型源）。
 */
export interface AssistantPingResult {
  /** 命令执行成功 */
  ok: boolean
  /** 执行该命令的插件身份回显（双端同源，可与其它应用区分） */
  appId: string
}

/**
 * 占位页命令验证状态
 *
 * 占位页在挂载后自动跑一次 ping，把链路状态显性呈现（fail-visible：
 * 失败点名原因，不静默假装可用，spec §2.4）。
 */
export type PlaceholderPingState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; result: AssistantPingResult }
  | { status: 'error'; message: string }
