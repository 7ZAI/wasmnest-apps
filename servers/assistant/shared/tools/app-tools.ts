/**
 * 应用工具目录（票 15 / spec §5.6、§4.2）
 *
 * - `app.list`（read）：列已安装 / 运行应用与它们声明给助手的工具；
 * - `app.open`（ui）：打开 / 切到目标应用（工具卡显示「正在打开」）；
 * - `app.invoke.<toolId>`（风险按目标声明）：调目标应用已声明的工具，
 *   经 `AppControlAPI` 桥（白名单 + 审计在宿主侧）；
 * - `monitor.snapshot`（read）：M1 的首个真实应用工具（monitor 声明）；
 * - `system.info`（read）：平台 / 版本 / 语言（本地，不含敏感信息）。
 *
 * 桥缺失（未注入 apps:control / 端不支持）时：app 类工具仍然注册，但执行
 * 显性报错点名缺什么——不静默返回空（spec §2.4 / 票 15 检查项）。
 * `app.invoke.*` 在桥缺失时不注册（没有目录可建）。
 */
import type { AppInvokeBridge } from '../types'
import type { ToolDescriptor } from './types'

/** 桥缺失时的显性错误文案（双端同构） */
export function bridgeMissingError(): string {
  return '应用调用桥不可用：当前端未注入 apps 桥（缺少 apps:control 权限或宿主不支持），无法调用其他应用'
}

/** `app.list`（read）：列应用与声明工具 */
export function appListDescriptor(apps: AppInvokeBridge | null): ToolDescriptor {
  return {
    name: 'app.list',
    label: '列出可用应用',
    description:
      '列出设备上已安装的应用、运行状态，以及各应用声明给助手的可用工具（含风险等级）。需要了解能调度哪些应用、或某个应用是否可用时使用。',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    async executor() {
      if (!apps) return { error: bridgeMissingError() }
      const list = await apps.list()
      if (list.length === 0) return { text: '当前没有可调度的应用。' }
      const lines = list.map((app) => {
        const tools = app.tools.length
          ? app.tools.map((t) => `${t.id}（${t.risk}）`).join('、')
          : '无声明工具'
        return `- ${app.name}（${app.id}，状态：${app.state}）：${tools}`
      })
      return { text: `可调度应用 ${list.length} 个：\n${lines.join('\n')}` }
    },
  }
}

/** `app.open`（ui）：打开 / 切到目标应用（用户可见动作） */
export function appOpenDescriptor(apps: AppInvokeBridge | null): ToolDescriptor {
  return {
    name: 'app.open',
    label: '打开应用',
    description:
      '打开或切换到指定应用（用户可见动作，界面会显示「正在打开」）。用户要求打开某个应用时使用；目标未安装 / 已停用会显性报错。',
    argsSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: '目标应用 id（可用 app.list 查询）' },
      },
      required: ['appId'],
      additionalProperties: false,
    },
    risk: 'ui',
    async executor(args) {
      if (!apps) return { error: bridgeMissingError() }
      const appId = String((args as { appId?: string } | undefined)?.appId ?? '').trim()
      if (!appId) return { error: 'app.open 需要 appId' }
      try {
        await apps.open(appId)
        return { text: `正在打开应用：${appId}` }
      } catch (e) {
        // 桥的 open 失败（未安装 / 已停用 / 激活被拒）原样上交，点名缺什么
        return { error: `打开应用失败：${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}

/**
 * 从桥目录快照构建 `app.invoke.<toolId>` 描述符。
 *
 * @param apps 桥（执行期用；缺失时返回空）
 * @param snapshot apps.list() 的结果（目录快照）
 */
export function buildAppInvokeDescriptorsFromSnapshot(
  apps: AppInvokeBridge | null,
  snapshot: Array<{ id: string; name: string; tools: Array<{ id: string; title: string; description: string; command: string; argsSchema: Record<string, unknown>; risk: 'read' | 'ui' | 'write' | 'danger' }> }>,
): ToolDescriptor[] {
  if (!apps) return []
  const out: ToolDescriptor[] = []
  for (const app of snapshot) {
    for (const tool of app.tools) {
      out.push({
        name: `app.invoke.${tool.id}`,
        label: `${app.name}：${tool.title}`,
        description: `调用 ${app.name}（${app.id}）声明的工具「${tool.id}」。${tool.description}`,
        argsSchema: tool.argsSchema,
        risk: tool.risk,
        appId: app.id,
        appToolId: tool.command,
      })
    }
  }
  return out
}

/** `monitor.snapshot`（read）：M1 首个真实应用工具（monitor 声明） */
export function monitorSnapshotDescriptor(apps: AppInvokeBridge | null): ToolDescriptor {
  return {
    name: 'monitor.snapshot',
    label: '读取运行指标快照',
    description:
      '读取所有已加载应用的运行时指标快照（内存 / CPU 等，只读，不含会话 / 文件 / 凭据内容）。用户询问「哪个应用占资源最多」「运行状态」等时使用，回答要有数据依据。',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    async executor() {
      if (!apps) return { error: bridgeMissingError() }
      try {
        const res = await apps.invoke('com.wasmnest.monitor', 'monitor.snapshot', {})
        return { text: JSON.stringify(res) }
      } catch (e) {
        // 未声明 / 未运行等桥错误原样上交（点名缺什么，给出路）
        return { error: `读取 monitor 快照失败：${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}

/** `system.info`（read）：平台 / 版本 / 语言（本地，不含敏感信息） */
export function systemInfoDescriptor(): ToolDescriptor {
  return {
    name: 'system.info',
    label: '系统信息',
    description:
      '获取当前运行平台、界面语言等基础系统信息（不含密钥、凭据等敏感内容）。用户询问设备 / 平台信息时使用。',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    async executor() {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
      const platform = /Android/i.test(ua)
        ? 'mobile (Android)'
        : /iPhone|iPad|iPod/i.test(ua)
          ? 'mobile (iOS)'
          : /Tauri|WebView/i.test(ua) || ua.length > 0
            ? 'desktop'
            : 'unknown'
      const lang = typeof document !== 'undefined' ? ((document as { language?: string }).language ?? '') : ''
      return {
        text: JSON.stringify({
          platform,
          language: lang,
          userAgentLength: ua.length,
        }),
      }
    },
  }
}

/** 应用工具基础件（app.list / app.open / monitor.snapshot / system.info） */
export function buildAppBaseDescriptors(apps: AppInvokeBridge | null): ToolDescriptor[] {
  return [appListDescriptor(apps), appOpenDescriptor(apps), monitorSnapshotDescriptor(apps), systemInfoDescriptor()]
}
