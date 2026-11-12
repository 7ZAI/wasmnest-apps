/**
 * Agent 图标契约（pi 1.3+ 多色像素标）
 *
 * 契约来源：pi 包 `dist/modes/interactive/components/pi-logo.js` 与
 * `easter-egg-3d.js`（品牌三色 + 4×4 像素矩阵）。
 *
 * 断言只落在外部可观察行为：
 * ① `CLI_ICONS.pi` 是**三色固定填充**（不走 currentColor），色值等于官方
 *    coral / blue / yellow —— 单色标被改回来即红；
 * ② 两个消费方（概览卡片 CliIcon / 会话日志 AgentIcon）都按 path 的 fill
 *    渲染，pi 出三色；其余品牌标仍取 glyph 兜底色；
 * ③ 四个内置 agent 全部有品牌色（不再有 currentColor 兜底：单色标随主题
 *    前景色会导致「codex / opencode 看起来没上色」，用户 2026-11-01 反馈）；
 * ④ 非品牌适配器仍回退字母徽标（不因多色改造丢掉回退分支）。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CliIcon from '../../agents/components/CliIcon.vue'
import AgentIcon from '../../agents/components/AgentIcon.vue'
import { CLI_ICONS } from '../../agents/icons'

/** pi 官方品牌三色（与 pi TUI 同源） */
const PI_CORAL = '#e48a7a'
const PI_BLUE = '#4f8eb3'
const PI_YELLOW = '#eab55d'

/** codex / opencode 品牌色（各自 CLI TUI 强调色，见 icons.ts 头注） */
const CODEX_BLUE = '#63a8f8'
const OPENCODE_ORANGE = '#fab283'

function fills(wrapper: ReturnType<typeof mount>): (string | undefined)[] {
  return wrapper.findAll('path').map((p) => p.attributes('fill'))
}

describe('CLI_ICONS.pi 是 pi 1.3+ 的多色官方标', () => {
  it('按色拆成三条 path，全部是官方固定色（无 currentColor / 无兜底依赖）', () => {
    const pi = CLI_ICONS.pi
    expect(pi.viewBox).toBe('0 0 4 4')
    expect(pi.paths).toHaveLength(3)
    const pathFills = pi.paths.map((p) => p.fill)
    expect(pathFills).toEqual([PI_CORAL, PI_BLUE, PI_YELLOW])
    expect(pathFills).not.toContain('currentColor')
    for (const p of pi.paths) expect(p.d.length).toBeGreaterThan(0)
  })
})

describe('图标消费方按 path 填充渲染', () => {
  it('CliIcon(pi) 渲染三色；CliIcon(claude) 仍是单色品牌橙', () => {
    const pi = mount(CliIcon, { props: { cliId: 'pi' } })
    expect(fills(pi)).toEqual([PI_CORAL, PI_BLUE, PI_YELLOW])

    const claude = mount(CliIcon, { props: { cliId: 'claude' } })
    expect(fills(claude)).toEqual([CLI_ICONS.claude.color])
  })

  it('CliIcon(codex) / CliIcon(opencode) 用各自 TUI 强调色（不再随主题 currentColor）', () => {
    const codex = mount(CliIcon, { props: { cliId: 'codex' } })
    expect(fills(codex)).toEqual([CODEX_BLUE])

    const opencode = mount(CliIcon, { props: { cliId: 'opencode' } })
    expect(fills(opencode)).toEqual([OPENCODE_ORANGE])
  })

  it('内置四家都有固定品牌色：没有任何 glyph 走 currentColor', () => {
    for (const id of ['pi', 'opencode', 'codex', 'claude']) {
      expect(CLI_ICONS[id].color).not.toBe('currentColor')
    }
  })

  it('AgentIcon(pi) 与概览卡片同一份三色；未知适配器仍回退字母徽标', () => {
    const pi = mount(AgentIcon, { props: { adapter: 'pi' } })
    expect(fills(pi)).toEqual([PI_CORAL, PI_BLUE, PI_YELLOW])

    const custom = mount(AgentIcon, { props: { adapter: 'my-agent' } })
    expect(custom.findAll('path')).toHaveLength(0)
    expect(custom.find('.ah-agent-ic-letter').text()).toBe('M')
  })
})
