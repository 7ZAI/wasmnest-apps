/**
 * Agent 池命令面（`agent.profile.*`）
 *
 * 红线与其余域一致：只经 `context.commands.execute`，不直连网络 / 文件 / 导航。
 * 后端已把 `profile-*` 业务码映射为注册后的完整 i18n key 信封，前端统一走
 * `resolvePluginErrorText` 解析，不再自持码表。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { resolvePluginErrorText } from '@/utils/pluginError'
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

/** 池错误 → 文案：信封 code 已是注册后的完整 key，直接走通用解析与兜底。 */
export function resolveAgentProfileError(
  context: PluginContext,
  error: unknown,
  fallbackKey: string,
): string {
  return resolvePluginErrorText(context, error, fallbackKey)
}
