/**
 * 编排状态 → token 绑定视觉类（唯一映射）
 *
 * 状态色一律走宿主语义 token（`--color-*-light` / `--color-*-ink` / `--color-*`），
 * 不再写死 sky/blue/green/amber/red 调色板：宿主的六套色板与深浅主题会整体跟随，
 * 并且文字使用 `*-ink` 档（对 tinted 底仍满足 AA，见宿主 style.css 的注释）。
 *
 * 类名必须是完整字面量，Tailwind 内容扫描才能生成对应工具类；不要在运行时拼串。
 */
import type { OrchestrationStatusColor } from '@/composables/orchestration/types'

/** 徽标：浅底 + ink 文字 + 半透明描边 */
export const toneBadgeClass: Record<OrchestrationStatusColor, string> = {
  neutral: 'border-[var(--border-strong)] bg-[var(--bg-hover)] text-[var(--text-secondary)]',
  info: 'border-[color-mix(in_srgb,var(--color-info)_40%,transparent)] bg-[var(--color-info-light)] text-[var(--color-info-ink)]',
  active:
    'border-[color-mix(in_srgb,var(--color-info)_40%,transparent)] bg-[var(--color-info-light)] text-[var(--color-info-ink)]',
  success:
    'border-[color-mix(in_srgb,var(--color-success)_40%,transparent)] bg-[var(--color-success-light)] text-[var(--color-success-ink)]',
  warn: 'border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[var(--color-warning-light)] text-[var(--color-warning-ink)]',
  danger:
    'border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-light)] text-[var(--color-danger-ink)]',
}

/** 徽标前的小圆点（active 额外带脉冲，由调用方加 animate-pulse） */
export const toneDotClass: Record<OrchestrationStatusColor, string> = {
  neutral: 'bg-[var(--text-tertiary)]',
  info: 'bg-[var(--color-info)]',
  active: 'bg-[var(--color-info)]',
  success: 'bg-[var(--color-success)]',
  warn: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
}

/** 工作流节点：浅底 + 半透明描边（中性态保持卡面） */
export const toneNodeClass: Record<OrchestrationStatusColor, string> = {
  neutral: 'border-[var(--border)] bg-[var(--bg-card)]',
  info: 'border-[color-mix(in_srgb,var(--color-info)_45%,transparent)] bg-[var(--color-info-light)]',
  active:
    'border-[color-mix(in_srgb,var(--color-info)_45%,transparent)] bg-[var(--color-info-light)]',
  success:
    'border-[color-mix(in_srgb,var(--color-success)_45%,transparent)] bg-[var(--color-success-light)]',
  warn: 'border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[var(--color-warning-light)]',
  danger:
    'border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[var(--color-danger-light)]',
}

/** 状态文字（无底色时） */
export const toneTextClass: Record<OrchestrationStatusColor, string> = {
  neutral: 'text-[var(--text-secondary)]',
  info: 'text-[var(--color-info-ink)]',
  active: 'text-[var(--color-info-ink)]',
  success: 'text-[var(--color-success-ink)]',
  warn: 'text-[var(--color-warning-ink)]',
  danger: 'text-[var(--color-danger-ink)]',
}

/** 流水线/进度条：实色（非文字档） */
export const toneBarClass: Record<OrchestrationStatusColor, string> = {
  neutral: 'bg-[var(--border-strong)]',
  info: 'bg-[var(--color-info)]',
  active: 'bg-[var(--color-info)]',
  success: 'bg-[var(--color-success)]',
  warn: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
}

/**
 * 时间线事件 kind → 色调
 *
 * 事件 kind 是稳定的 wire 枚举（`node_failed` / `node_succeeded` / `pausing` …），
 * 这里只做展示分组；未知 kind 落 info，不因新增事件而崩。
 */
export function eventTone(kind: string): OrchestrationStatusColor {
  if (kind === 'created' || kind === 'cancelled' || kind === 'node_cancelled') return 'neutral'
  if (kind.includes('failed') || kind === 'budget_exhausted') return 'danger'
  if (kind.includes('succeeded') || kind === 'completed') return 'success'
  if (
    kind.includes('awaiting') ||
    kind.includes('blocked') ||
    kind.includes('paus') ||
    kind === 'plan_invalid'
  ) {
    return 'warn'
  }
  return 'info'
}
