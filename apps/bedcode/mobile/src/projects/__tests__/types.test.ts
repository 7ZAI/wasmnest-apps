/**
 * 项目域纯函数契约（相对时间 / 环境 / 状态 / 可打开判据）
 *
 * 这些分支决定界面显示什么，不经过组件挂载也能钉住；组件测试只验证编排与动作。
 */
import { describe, expect, it } from 'vitest'
import {
  agentStartable,
  canOpenTerminal,
  envChipClass,
  envLabel,
  relativeTimeSpec,
  runStatusBadgeClass,
  runStatusChipClass,
  runStatusLabelKey,
  normalizeRunStatus,
} from '../types'

const NOW = new Date('2026-11-01T12:00:00Z').getTime()

function isoSecondsAgo(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString()
}

describe('relativeTimeSpec', () => {
  it('四档边界：刚刚 / 分钟 / 小时 / 天', () => {
    expect(relativeTimeSpec(isoSecondsAgo(5), NOW)).toEqual({
      key: 'project.time.justNow',
      params: {},
    })
    expect(relativeTimeSpec(isoSecondsAgo(59), NOW)).toEqual({
      key: 'project.time.justNow',
      params: {},
    })
    expect(relativeTimeSpec(isoSecondsAgo(60), NOW)).toEqual({
      key: 'project.time.minutesAgo',
      params: { n: 1 },
    })
    expect(relativeTimeSpec(isoSecondsAgo(3599), NOW)).toEqual({
      key: 'project.time.minutesAgo',
      params: { n: 59 },
    })
    expect(relativeTimeSpec(isoSecondsAgo(3600), NOW)).toEqual({
      key: 'project.time.hoursAgo',
      params: { n: 1 },
    })
    expect(relativeTimeSpec(isoSecondsAgo(86_400), NOW)).toEqual({
      key: 'project.time.daysAgo',
      params: { n: 1 },
    })
  })

  it('缺失 / 非法时间返回 null（界面显示暂无活动，不显示 NaN）', () => {
    expect(relativeTimeSpec(null, NOW)).toBeNull()
    expect(relativeTimeSpec(undefined, NOW)).toBeNull()
    expect(relativeTimeSpec('', NOW)).toBeNull()
    expect(relativeTimeSpec('not-a-date', NOW)).toBeNull()
  })

  it('未来时间按刚刚处理（不出现负分钟）', () => {
    expect(relativeTimeSpec(isoSecondsAgo(-30), NOW)).toEqual({
      key: 'project.time.justNow',
      params: {},
    })
  })
})

describe('环境徽标', () => {
  it('三取值固定映射；未知值原样大写不伪造', () => {
    expect(envLabel('wsl2')).toBe('WSL2')
    expect(envLabel('linux')).toBe('Linux')
    expect(envLabel('windows')).toBe('Windows')
    expect(envLabel('darwin')).toBe('DARWIN')
    expect(envLabel(null)).toBe('—')
  })

  it('语义色按环境归属', () => {
    expect(envChipClass('wsl2')).toBe('chip-violet')
    expect(envChipClass('linux')).toBe('chip-cyan')
    expect(envChipClass('windows')).toBe('chip-amber')
    expect(envChipClass('other')).toBe('chip-zinc')
  })
})

describe('运行状态映射', () => {
  it('externally tagged Error 对象折成 error；正常字符串原样保留', () => {
    expect(normalizeRunStatus('running')).toBe('running')
    expect(normalizeRunStatus({ error: 'pty closed' })).toBe('error')
    expect(normalizeRunStatus({ error: null })).toBe('error')
    expect(normalizeRunStatus(null)).toBe('idle')
    expect(normalizeRunStatus(undefined)).toBe('idle')
    expect(normalizeRunStatus('')).toBe('idle')
    expect(normalizeRunStatus(42)).toBe('idle')
  })

  it('每个状态都有文案键（缺省落 idle，不露空文字）', () => {
    expect(runStatusLabelKey('running')).toBe('hub.statusRunning')
    expect(runStatusLabelKey('waitingInput')).toBe('hub.statusWaiting')
    expect(runStatusLabelKey('stopped')).toBe('hub.statusStopped')
    expect(runStatusLabelKey('starting')).toBe('project.status.starting')
    expect(runStatusLabelKey('stopping')).toBe('project.status.stopping')
    expect(runStatusLabelKey('error')).toBe('project.status.error')
    expect(runStatusLabelKey('idle')).toBe('project.status.idle')
    expect(runStatusLabelKey('unknown-state')).toBe('project.status.idle')
  })

  it('徽章 / 图标 chip 同语义色', () => {
    expect(runStatusBadgeClass('running')).toBe('badge-emerald')
    expect(runStatusBadgeClass('waitingInput')).toBe('badge-amber')
    expect(runStatusBadgeClass('starting')).toBe('badge-cyan')
    expect(runStatusBadgeClass('error')).toBe('badge-red')
    expect(runStatusBadgeClass('stopped')).toBe('badge-zinc')
    expect(runStatusChipClass('running')).toBe('chip-emerald')
    expect(runStatusChipClass('error')).toBe('chip-red')
    expect(runStatusChipClass('stopped')).toBe('chip-zinc')
  })
})

describe('可操作判据', () => {
  it('只有活跃运行能打开终端（终态 PTY 已回收）', () => {
    expect(canOpenTerminal({ active: true })).toBe(true)
    expect(canOpenTerminal({ active: false })).toBe(false)
  })

  it('missing 之外都允许尝试启动（unknown 不谎称未安装）', () => {
    expect(agentStartable({ readiness: 'ready' })).toBe(true)
    expect(agentStartable({ readiness: 'unknown' })).toBe(true)
    expect(agentStartable({ readiness: 'missing' })).toBe(false)
  })
})
