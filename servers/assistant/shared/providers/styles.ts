/**
 * provider 方言 → pi-ai API 标识映射（票 10）
 *
 * pi-ai 的 `AssistantMessage.api` 字段用其已知 API 名标识生成协议；
 * 三家方言与 pi-ai 的 KnownApi 一一对应。重建 transcript（票 09 冷启动
 * 恢复）与流映射器组装消息都经此映射，避免在多处散落方言知识。
 */
import type { ProviderApiStyle } from '../types'

/** pi-ai KnownApi 子集（M1 三家方言对应值） */
export type PiApiName = 'openai-completions' | 'anthropic-messages' | 'google-generative-ai'

/** provider 方言 → pi-ai API 名 */
export function apiStyleToPiApi(style: ProviderApiStyle): PiApiName {
  switch (style) {
    case 'openai-compatible':
      return 'openai-completions'
    case 'anthropic':
      return 'anthropic-messages'
    case 'gemini':
      return 'google-generative-ai'
  }
}
