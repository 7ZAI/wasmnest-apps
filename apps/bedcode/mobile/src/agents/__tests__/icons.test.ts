/**
 * 移动端 Agent 图标契约
 *
 * 移动端凡表达「这是哪个 Agent」的图标位，一律用 Agent 自己的官方品牌标，
 * 不得自绘通用机器人 / 字母块替代内置四家。图元真源在桌面端
 * `apps/bedcode/desktop/src/agents/icons.ts`（两端独立构建、没有共享前端包），
 * 本测试直接比对桌面文件：任一端口改图标而另一端口没跟，移动端测试即红。
 *
 * 断言只落在外部可观察行为：
 * ① 移动端 AGENT_ICONS 与桌面 CLI_ICONS 逐字一致（含品牌色与 path）；
 * ② 通用占位与桌面 registry 的 GENERIC_AGENT_GLYPH 一致；
 * ③ 组件对内置四家按 path 渲染品牌色，pi 出官方三色；
 * ④ 未登记 id 回退通用占位（不自造品牌、不白屏）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { AGENT_ICONS, GENERIC_AGENT_GLYPH, agentGlyph, isBrandAgent } from '../icons'
import AgentIcon from '../components/AgentIcon.vue'
import { CLI_ICONS } from '../../../../desktop/src/agents/icons'
import { GENERIC_AGENT_GLYPH as DESKTOP_GENERIC } from '../../../../desktop/src/agents/registry'

/** pi 官方品牌三色（与 pi TUI 同源） */
const PI_CORAL = '#e48a7a'
const PI_BLUE = '#4f8eb3'
const PI_YELLOW = '#eab55d'
/** codex / opencode 品牌色（各自 CLI TUI 强调色） */
const CODEX_BLUE = '#63a8f8'
const OPENCODE_ORANGE = '#fab283'

function fills(wrapper: ReturnType<typeof mount>): (string | undefined)[] {
  return wrapper.findAll('path').map((p) => p.attributes('fill'))
}

describe('图元与桌面端同源', () => {
  it('内置四家的 path / viewBox / 品牌色逐字一致', () => {
    expect(AGENT_ICONS).toEqual(CLI_ICONS)
  })

  it('通用占位与桌面 registry 一致', () => {
    expect(GENERIC_AGENT_GLYPH).toEqual(DESKTOP_GENERIC)
  })

  it('四个内置 agent 全部是固定品牌色，没有 currentColor 兜底', () => {
    for (const id of ['pi', 'opencode', 'codex', 'claude']) {
      expect(isBrandAgent(id)).toBe(true)
      expect(AGENT_ICONS[id].color).not.toBe('currentColor')
    }
    expect(isBrandAgent('my-agent')).toBe(false)
    expect(agentGlyph('my-agent')).toBe(GENERIC_AGENT_GLYPH)
  })
})

describe('AgentIcon 渲染', () => {
  it('pi 渲染官方三色像素标', () => {
    const wrapper = mount(AgentIcon, { props: { agentId: 'pi' } })
    expect(fills(wrapper)).toEqual([PI_CORAL, PI_BLUE, PI_YELLOW])
    expect(wrapper.classes()).toContain('agent-icon--pi')
  })

  it('claude / codex / opencode 用各自固定品牌色', () => {
    expect(fills(mount(AgentIcon, { props: { agentId: 'claude' } }))).toEqual([
      AGENT_ICONS.claude.color,
    ])
    expect(fills(mount(AgentIcon, { props: { agentId: 'codex' } }))).toEqual([CODEX_BLUE])
    expect(fills(mount(AgentIcon, { props: { agentId: 'opencode' } }))).toEqual([OPENCODE_ORANGE])
  })

  it('未登记 id 回退通用占位（同一 path，不渲染品牌色）', () => {
    const wrapper = mount(AgentIcon, { props: { agentId: 'my-agent' } })
    expect(fills(wrapper)).toEqual([GENERIC_AGENT_GLYPH.color])
    expect(wrapper.classes()).toContain('agent-icon--generic')
    expect(wrapper.attributes('aria-label')).toBe('my-agent')
  })
})
