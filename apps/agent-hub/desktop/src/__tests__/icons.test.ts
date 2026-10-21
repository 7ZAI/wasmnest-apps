/**
 * Agent 图标契约（pi 1.3+ 多色像素标）
 *
 * 契约来源：pi 包 `dist/modes/interactive/components/pi-logo.js` 与
 * `easter-egg-3d.js`（品牌三色 + 4×4 像素矩阵）。
 *
 * 断言只落在外部可观察行为：
 * ① `CLI_ICONS.pi` 是**三色固定填充**（不再走 currentColor），色值等于官方
 *    coral / blue / yellow —— 单色标被改回来即红；
 * ② 两个消费方（概览卡片 CliIcon / 会话日志 AgentIcon）都按 path 的 fill
 *    渲染，pi 出三色；其余品牌标仍取 glyph 兜底色（codex 走 currentColor）；
 * ③ 非品牌适配器仍回退字母徽标（不因多色改造丢掉回退分支）。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CliIcon from '../components/CliIcon.vue'
import AgentIcon from '../components/AgentIcon.vue'
import { CLI_ICONS } from '../icons'

/** pi 官方品牌三色（与 pi TUI 同源） */
const PI_CORAL = '#e48a7a'
const PI_BLUE = '#4f8eb3'
const PI_YELLOW = '#eab55d'

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

  it('CliIcon(codex) 保留 currentColor（随主题 token）', () => {
    const codex = mount(CliIcon, { props: { cliId: 'codex' } })
    expect(fills(codex)).toEqual(['currentColor'])
  })

  it('AgentIcon(pi) 与概览卡片同一份三色；未知适配器仍回退字母徽标', () => {
    const pi = mount(AgentIcon, { props: { adapter: 'pi' } })
    expect(fills(pi)).toEqual([PI_CORAL, PI_BLUE, PI_YELLOW])

    const custom = mount(AgentIcon, { props: { adapter: 'my-agent' } })
    expect(custom.findAll('path')).toHaveLength(0)
    expect(custom.find('.ah-agent-ic-letter').text()).toBe('M')
  })
})
