/**
 * 运行内 agent 控制（模型 / 思考等级下拉）
 *
 * 唯一控制面是后端 `run.agent.options` / `run.agent.set`：本模块只做取数与调用，
 * 不拼斜杠语法、不判断 agent 支持哪些档位、不持第二份「agent → 能力」真源
 * （四种 agent 的差异住在 Rust `run/agent_control.rs` 的 profile）。
 *
 * 失败语义：命令抛出的错误原样上抛，由视图层用 `resolvePluginErrorText` 转文案；
 * 能力不可用（如桥接离线 / codex 版本低）不抛错，落在 `capabilities.*.reason`
 * 上由界面显性呈现（禁用的下拉 + 原因 title）。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 可选模型项（`source` = current / catalog / preset） */
export interface AgentModelOption {
  value: string
  label: string
  source: string
}

/** 单项能力（supported=false 时 reason/message 必填） */
export interface AgentCapability {
  supported: boolean
  channel: string
  reason: string | null
  message: string | null
}

/** `run.agent.options` 的响应形状 */
export interface AgentControlOptions {
  runId: string
  agent: string
  current: {
    model: string | null
    thinkingLevel: string | null
  }
  models: AgentModelOption[]
  thinkingLevels: string[]
  capabilities: {
    model: AgentCapability
    thinking: AgentCapability
  }
}

export function useRunAgentControl(context: PluginContext) {
  const options: Ref<AgentControlOptions | null> = ref(null)
  const isLoading = ref(false)
  const isApplying = ref(false)
  /** 取数代次：快速切换运行 / 连续刷新时丢弃过期响应 */
  let loadSeq = 0

  /** 取某条运行的可选清单与当前值（不可用的运行不报错，返回 null） */
  async function load(runId: string): Promise<AgentControlOptions | null> {
    const seq = ++loadSeq
    if (!runId) {
      options.value = null
      return null
    }
    isLoading.value = true
    try {
      const raw = (await context.commands.execute('run.agent.options', {
        runId,
      })) as AgentControlOptions | null
      if (seq !== loadSeq) return options.value
      options.value = raw?.runId ? raw : null
      return options.value
    } catch (e) {
      if (seq === loadSeq) options.value = null
      throw e
    } finally {
      if (seq === loadSeq) isLoading.value = false
    }
  }

  /** 切换模型（运行内生效；不重启、不丢上下文） */
  async function setModel(runId: string, model: string): Promise<void> {
    await apply(runId, { model })
  }

  /** 切换思考等级 */
  async function setThinking(runId: string, level: string): Promise<void> {
    await apply(runId, { thinkingLevel: level })
  }

  async function apply(runId: string, patch: { model?: string; thinkingLevel?: string }) {
    if (!runId || isApplying.value) return
    isApplying.value = true
    try {
      const raw = (await context.commands.execute('run.agent.set', {
        runId,
        ...patch,
      })) as { applied?: { model?: string | null; thinkingLevel?: string | null } } | null
      // 乐观更新当前值：桥接 agent 的真实值随后经上行 meta 回填（同一条 options 再取即最新）
      const applied = raw?.applied
      if (options.value && applied) {
        options.value = {
          ...options.value,
          current: {
            model: applied.model ?? options.value.current.model,
            thinkingLevel: applied.thinkingLevel ?? options.value.current.thinkingLevel,
          },
        }
      }
    } finally {
      isApplying.value = false
    }
  }

  return { options, isLoading, isApplying, load, setModel, setThinking }
}

export type RunAgentControl = ReturnType<typeof useRunAgentControl>
