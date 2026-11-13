/**
 * 工具风险分级（票 13 / spec §5.6、§5.9）
 *
 * 四档：read（自动）→ ui（自动 + 可见卡）→ write（内联批准）→
 * danger（二次确认，第二次展示影响范围）。
 *
 * 「风险只能升不能降」：应用声明的 risk 是下限，助手侧策略（如用户在
 * 设置里要求 ui 也确认）按更高档执行。
 */

export type Risk = 'read' | 'ui' | 'write' | 'danger'

/** 升档序（越靠后越需要确认） */
const RISK_ORDER: Array<Risk> = ['read', 'ui', 'write', 'danger']

/** 升档：返回两者中更严的一档（应用声明 + 助手策略，只升不降） */
export function elevateRisk(declared: Risk, policy?: Risk): Risk {
  if (!policy) return declared
  const a = RISK_ORDER.indexOf(declared)
  const b = RISK_ORDER.indexOf(policy)
  return b > a ? policy : declared
}

/** 是否需要用户确认（write / danger 暂停等待；danger 需二次） */
export function requiresConfirmation(risk: Risk): boolean {
  return risk === 'write' || risk === 'danger'
}

/** 是否需要二次确认（仅 danger） */
export function requiresSecondConfirmation(risk: Risk): boolean {
  return risk === 'danger'
}

/** 风险标记文案键（i18n 域内 key，双端共用） */
export function riskLabelKey(risk: Risk): string {
  return `assistant.tool.risk.${risk}`
}
