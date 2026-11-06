/**
 * Agent 池命令面（`agent.profile.*`）
 *
 * 红线与其余域一致：只经 `context.commands.execute`，不直连网络 / 文件 / 导航。
 * 错误先按 `profile-*` 业务码映射，再落 `resolvePluginErrorText` 的通用兜底。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { parsePluginError, resolvePluginErrorText } from '@/utils/pluginError'
import type { AgentProfileInput, AgentProfileOptions, AgentProfileView } from './types'

export function useAgentProfiles(context: PluginContext) {
  const execute = <T>(command: string, args: unknown): Promise<T> =>
    context.commands.execute(command, args) as Promise<T>

  return {
    list: async (): Promise<AgentProfileView[]> => {
      const raw = await execute<{ profiles: AgentProfileView[] }>('agent.profile.list', {})
      return raw.profiles ?? []
    },
    create: async (input: AgentProfileInput): Promise<AgentProfileView> => {
      const raw = await execute<{ profile: AgentProfileView }>('agent.profile.create', input)
      return raw.profile
    },
    update: async (id: string, input: AgentProfileInput): Promise<AgentProfileView> => {
      const raw = await execute<{ profile: AgentProfileView }>('agent.profile.update', {
        id,
        ...input,
      })
      return raw.profile
    },
    remove: (id: string) => execute<{ deleted: boolean }>('agent.profile.delete', { id }),
    options: (cli: string) => execute<AgentProfileOptions>('agent.profile.options', { cli }),
  }
}

export type AgentProfilesApi = ReturnType<typeof useAgentProfiles>

/** 池业务码 → 文案；未命中走通用错误信封。 */
export function resolveAgentProfileError(
  context: PluginContext,
  error: unknown,
  fallbackKey: string,
): string {
  const envelope = parsePluginError(error)
  const code = envelope?.code ?? ''
  const base = code.split(':', 1)[0].trim()
  if (base.startsWith('profile-')) {
    const key = `orchestration.pool.error.${base}`
    const text = context.i18n.t(key)
    if (text !== key) return text
  }
  return resolvePluginErrorText(context, error, fallbackKey)
}
