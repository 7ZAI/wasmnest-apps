import { describe, it, expect } from 'vitest'
import type { AlertInput, PluginRow, RuntimeSample } from '../types'
import {
  DEFAULT_ALERT_SETTINGS,
  EVENT_ALERT_TTL_MS,
  alertMessage,
  alertRatio,
  buildObservations,
  createAlertState,
  evaluateAlerts,
  normalizeAlertSettings,
  sortAlerts,
} from '../utils/alerts'
import { mergePluginRows } from '../utils/format'
import { platformTotals } from '../utils/platform'
import { info, metrics, snapshot } from './fixtures'

function sample(overrides: Partial<RuntimeSample> & { at: number }): RuntimeSample {
  return { callsTotal: 0, callsInFlight: 0, trapsTotal: 0, ...overrides }
}

function settings(overrides: Partial<typeof DEFAULT_ALERT_SETTINGS> = {}) {
  return normalizeAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...overrides })
}

/** 一次评估输入：快照派生的合计 + 台账行 + 采样序列 */
function inputOf(
  now: number,
  snap: ReturnType<typeof snapshot>,
  samples: RuntimeSample[] = [],
  rows?: PluginRow[],
): AlertInput {
  return {
    now,
    totals: platformTotals(snap, samples),
    rows: rows ?? mergePluginRows(snap, []),
    samples,
  }
}

const MIB = 1024 * 1024
/** 平台内存规则用绝对值；配额给足（4 GiB）避免同时触发单插件配额规则 */
const memorySnapshot = (current: number, quota = 4096 * MIB) =>
  snapshot({ a: metrics({ memory_current_bytes: current, quota: { memory_bytes: quota } }) })

describe('normalizeAlertSettings（阈值归一化）', () => {
  it('缺失 / 非对象 / 损坏 JSON → 默认值', () => {
    expect(normalizeAlertSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(normalizeAlertSettings('{oops')).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(normalizeAlertSettings(42)).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(normalizeAlertSettings({})).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  it('接受 JSON 字符串并夹到合法区间', () => {
    const parsed = normalizeAlertSettings(
      JSON.stringify({
        platformMemoryWarnBytes: 2e12,
        platformMemoryCriticalBytes: 0,
        pluginMemoryWarn: -1,
        breachSamples: 99,
        recoverSamples: 0,
        cooldownMs: 99_999_999,
        computeWarnFuelPerSecond: -5,
        enabled: 'yes',
        notify: false,
      }),
    )
    expect(parsed.platformMemoryWarnBytes).toBe(1e12)
    expect(parsed.platformMemoryCriticalBytes).toBe(1e12 + 1)
    expect(parsed.pluginMemoryWarn).toBe(0.05)
    expect(parsed.breachSamples).toBe(20)
    expect(parsed.recoverSamples).toBe(1)
    expect(parsed.cooldownMs).toBe(3_600_000)
    expect(parsed.computeWarnFuelPerSecond).toBe(0)
    // 非布尔值不猜 true，回落默认
    expect(parsed.enabled).toBe(DEFAULT_ALERT_SETTINGS.enabled)
    expect(parsed.notify).toBe(false)
  })

  it('critical 必须严格大于 warn（否则两条规则互相吞掉）', () => {
    const parsed = normalizeAlertSettings({
      platformMemoryWarnBytes: 1000,
      platformMemoryCriticalBytes: 800,
    })
    expect(parsed.platformMemoryCriticalBytes).toBe(1001)
  })

  it('平台内存阈值 0 = 关闭（warn 关掉时不强推 critical）', () => {
    const parsed = normalizeAlertSettings({
      platformMemoryWarnBytes: 0,
      platformMemoryCriticalBytes: 0,
    })
    expect(parsed.platformMemoryWarnBytes).toBe(0)
    expect(parsed.platformMemoryCriticalBytes).toBe(0)
  })
})

describe('evaluateAlerts（平台内存 level 规则）', () => {
  const cfg = settings({ breachSamples: 2, recoverSamples: 2 })

  it('连续越界才升警；连续正常才解除', () => {
    const breaching = 300 * MIB
    let result = evaluateAlerts(createAlertState(), inputOf(1000, memorySnapshot(breaching)), cfg)
    expect(result.transitions).toEqual([])

    result = evaluateAlerts(result.state, inputOf(2000, memorySnapshot(breaching)), cfg)
    expect(result.transitions).toHaveLength(1)
    const opened = result.transitions[0]
    expect(opened.type).toBe('open')
    expect(opened.alert.id).toBe('platform-memory:-')
    expect(opened.alert.level).toBe('warning')
    expect(opened.alert.value).toBe(breaching)
    expect(opened.alert.threshold).toBe(DEFAULT_ALERT_SETTINGS.platformMemoryWarnBytes)
    expect(opened.alert.since).toBe(1000)

    // 健康一轮：不解除
    result = evaluateAlerts(result.state, inputOf(3000, memorySnapshot(10 * MIB)), cfg)
    expect(result.transitions).toEqual([])
    // 健康第二轮：解除
    result = evaluateAlerts(result.state, inputOf(4000, memorySnapshot(10 * MIB)), cfg)
    expect(result.transitions.map((t) => t.type)).toEqual(['resolve'])
    expect(Object.keys(result.state.entries)).toHaveLength(0)
  })

  it('升级为 critical 产生 escalate（不重复 open）', () => {
    const cfgImmediate = settings({ breachSamples: 1 })
    let result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, memorySnapshot(300 * MIB)),
      cfgImmediate,
    )
    expect(result.transitions[0].type).toBe('open')
    expect(result.transitions[0].alert.level).toBe('warning')

    result = evaluateAlerts(result.state, inputOf(2000, memorySnapshot(600 * MIB)), cfgImmediate)
    // 600 MiB 越过默认严重线（512 MiB）——按 id 取平台内存那一条，避免依赖同轮顺序
    const platformEscalation = result.transitions.filter((t) => t.alert.id === 'platform-memory:-')
    expect(platformEscalation).toHaveLength(1)
    expect(platformEscalation[0].type).toBe('escalate')
    expect(platformEscalation[0].alert.level).toBe('critical')
  })

  it('低于绝对阈值不升警；绝对阈值不依赖配额声明', () => {
    const cfgImmediate = settings({ breachSamples: 1 })
    const low = evaluateAlerts(
      createAlertState(),
      inputOf(1000, memorySnapshot(10 * MIB)),
      cfgImmediate,
    )
    expect(low.transitions).toEqual([])

    // 无配额也照样按合计字节判（平台规则不依赖 quota）
    const noQuota = snapshot({ a: metrics({ memory_current_bytes: 300 * MIB }) })
    const result = evaluateAlerts(createAlertState(), inputOf(1000, noQuota), cfgImmediate)
    expect(result.transitions[0].alert.id).toBe('platform-memory:-')
  })

  it('阈值设为 0 = 关闭该规则', () => {
    const cfgOff = settings({
      breachSamples: 1,
      platformMemoryWarnBytes: 0,
      platformMemoryCriticalBytes: 0,
    })
    const result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, memorySnapshot(2048 * MIB)),
      cfgOff,
    )
    expect(result.transitions).toEqual([])
  })

  it('总开关关闭：清空状态、不产生迁移', () => {
    const cfgImmediate = settings({ breachSamples: 1 })
    const opened = evaluateAlerts(
      createAlertState(),
      inputOf(1000, memorySnapshot(300 * MIB)),
      cfgImmediate,
    )
    expect(opened.transitions).toHaveLength(1)

    const disabled = evaluateAlerts(
      opened.state,
      inputOf(2000, memorySnapshot(300 * MIB)),
      settings({ enabled: false }),
    )
    expect(disabled.transitions).toEqual([])
    expect(Object.keys(disabled.state.entries)).toHaveLength(0)
  })
})

describe('evaluateAlerts（单插件配额 / 状态）', () => {
  it('单插件内存越界按 plugin_id 出预警（平台合计仍健康）', () => {
    const snap = snapshot({
      small: metrics({ memory_current_bytes: 950, quota: { memory_bytes: 1000 } }),
      large: metrics({ memory_current_bytes: 0, quota: { memory_bytes: 1_000_000 } }),
    })
    const cfg = settings({ breachSamples: 1 })
    const result = evaluateAlerts(createAlertState(), inputOf(1000, snap), cfg)
    const ids = result.transitions.map((t) => t.alert.id)
    expect(ids).toContain('plugin-memory:small')
    expect(ids).not.toContain('platform-memory:-')
  })

  it('状态错误 / 降级立即升警，状态恢复后解除', () => {
    const snap = snapshot({})
    const errorRows = mergePluginRows(snap, [
      info({ id: 'com.wasmnest.bad', name: 'Bad', state: { state: 'error' } }),
      info({ id: 'com.wasmnest.degraded', name: 'Degraded', state: { state: 'degraded' } }),
    ])
    const cfg = settings({ recoverSamples: 1 })
    let result = evaluateAlerts(createAlertState(), inputOf(1000, snap, [], errorRows), cfg)
    expect(result.transitions.map((t) => t.alert.id).sort()).toEqual([
      'plugin-state:com.wasmnest.bad',
      'plugin-state:com.wasmnest.degraded',
    ])
    expect(
      result.transitions.find((t) => t.alert.id === 'plugin-state:com.wasmnest.bad')?.alert.level,
    ).toBe('critical')
    expect(
      result.transitions.find((t) => t.alert.id === 'plugin-state:com.wasmnest.degraded')?.alert
        .level,
    ).toBe('warning')

    const healthyRows = mergePluginRows(snap, [
      info({ id: 'com.wasmnest.bad', name: 'Bad', state: { state: 'activated' } }),
      info({ id: 'com.wasmnest.degraded', name: 'Degraded', state: { state: 'activated' } }),
    ])
    result = evaluateAlerts(result.state, inputOf(2000, snap, [], healthyRows), cfg)
    expect(result.transitions.every((t) => t.type === 'resolve')).toBe(true)
  })
})

describe('evaluateAlerts（事件型：Trap / 任务池背压）', () => {
  it('Trap 增量立即升警并在窗口内累计，TTL 后解除', () => {
    const cfg = settings({ breachSamples: 3 })
    const empty = snapshot({})

    let result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, empty, [sample({ at: 0 }), sample({ at: 1000, trapsTotal: 1 })]),
      cfg,
    )
    expect(result.transitions[0].type).toBe('open')
    expect(result.transitions[0].alert.id).toBe('trap-activity:-')
    expect(result.transitions[0].alert.value).toBe(1)
    expect(result.transitions[0].alert.level).toBe('warning')

    // 新增 2 次：同一预警累计，不重复 open
    result = evaluateAlerts(
      result.state,
      inputOf(2000, empty, [
        sample({ at: 1000, trapsTotal: 1 }),
        sample({ at: 2000, trapsTotal: 3 }),
      ]),
      cfg,
    )
    expect(result.transitions).toEqual([])
    expect(result.state.entries['trap-activity:-'].alert.value).toBe(3)

    // 无新增：未到 TTL 保留
    result = evaluateAlerts(
      result.state,
      inputOf(2000 + EVENT_ALERT_TTL_MS - 1, empty, [
        sample({ at: 1000, trapsTotal: 3 }),
        sample({ at: 2000, trapsTotal: 3 }),
      ]),
      cfg,
    )
    expect(result.transitions).toEqual([])

    // 超过 TTL：解除
    result = evaluateAlerts(
      result.state,
      inputOf(2000 + EVENT_ALERT_TTL_MS, empty, [
        sample({ at: 1000, trapsTotal: 3 }),
        sample({ at: 2000, trapsTotal: 3 }),
      ]),
      cfg,
    )
    expect(result.transitions.map((t) => t.type)).toEqual(['resolve'])
  })

  it('任务池拒绝 / 丢弃增量 → 背压预警（含 secondary 丢弃数）', () => {
    const cfg = settings()
    const empty = snapshot({})
    const result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, empty, [
        sample({ at: 0, taskRejectedTotal: 0, taskDroppedTotal: 0 }),
        sample({ at: 1000, taskRejectedTotal: 2, taskDroppedTotal: 1 }),
      ]),
      cfg,
    )
    const alert = result.transitions.find((t) => t.alert.id === 'task-backpressure:-')?.alert
    expect(alert).toBeDefined()
    expect(alert?.value).toBe(2)
    expect(alert?.secondary).toBe(1)
    expect(alert?.level).toBe('warning')
  })

  it('采样缺 task 字段 → 不误报背压（缺失不是 0）', () => {
    const result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, snapshot({}), [sample({ at: 0 }), sample({ at: 1000 })]),
      settings(),
    )
    expect(result.transitions).toEqual([])
  })
})

describe('evaluateAlerts（计算负载）', () => {
  const empty = snapshot({})
  const rampSamples = (fuel: number) => [
    sample({ at: 0, fuelTotal: 0 }),
    sample({ at: 1000, fuelTotal: fuel }),
  ]

  it('阈值 0 = 关闭', () => {
    const result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, empty, rampSamples(1_000_000)),
      settings({ computeWarnFuelPerSecond: 0 }),
    )
    expect(result.transitions).toEqual([])
  })

  it('达到阈值按 level 去抖；2 倍阈值判 critical', () => {
    const cfg = settings({ computeWarnFuelPerSecond: 500, breachSamples: 2 })
    let result = evaluateAlerts(createAlertState(), inputOf(1000, empty, rampSamples(600)), cfg)
    expect(result.transitions).toEqual([])
    result = evaluateAlerts(result.state, inputOf(2000, empty, rampSamples(600)), cfg)
    expect(result.transitions[0].alert.id).toBe('compute-load:-')
    expect(result.transitions[0].alert.level).toBe('warning')

    result = evaluateAlerts(
      createAlertState(),
      inputOf(1000, empty, rampSamples(1200)),
      settings({ computeWarnFuelPerSecond: 500, breachSamples: 1 }),
    )
    expect(result.transitions[0].alert.level).toBe('critical')
  })
})

describe('buildObservations（观测派生）', () => {
  it('只输出越界项；无配额 / 无基线不输出', () => {
    const obs = buildObservations(inputOf(1000, memorySnapshot(300 * MIB)), settings())
    expect(obs.map((o) => o.id)).toEqual(['platform-memory:-'])
    expect(obs[0].mode).toBe('level')
  })
})

describe('alertMessage（文案）', () => {
  const t = (key: string, params?: Record<string, unknown>): string =>
    params && Object.keys(params).length > 0
      ? `${key}(${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')})`
      : key
  const ctx = { t, nameOf: (id: string) => `name:${id}` }

  const base = {
    id: 'platform-memory:-',
    rule: 'platform-memory' as const,
    level: 'warning' as const,
    value: 900,
    threshold: 1000,
    since: 0,
    updatedAt: 0,
  }

  it('平台内存规则给出合计与绝对阈值（不是配额比例）', () => {
    const text = alertMessage(base, ctx)
    expect(text.title).toBe('monitor.alerts.rule.platformMemory')
    expect(text.body).toContain('current=900 B')
    expect(text.body).toContain('threshold=1000 B')
    expect(alertRatio(base)).toBeNull()
  })

  it('单插件内存规则仍给出配额比例与绝对值', () => {
    const pluginAlert = {
      ...base,
      id: 'plugin-memory:a',
      rule: 'plugin-memory' as const,
      target: 'a',
    }
    const text = alertMessage(pluginAlert, ctx)
    expect(text.body).toContain('ratio=90.0%')
    expect(alertRatio(pluginAlert)).toBeCloseTo(0.9)
  })

  it('插件维度规则带应用名；状态规则翻译状态', () => {
    const plugin = alertMessage(
      { ...base, id: 'plugin-memory:a', rule: 'plugin-memory', target: 'a' },
      ctx,
    )
    expect(plugin.title).toBe('monitor.alerts.rule.pluginMemory(name=name:a)')

    const stateAlert = {
      ...base,
      id: 'plugin-state:a',
      rule: 'plugin-state' as const,
      target: 'a',
      state: 'degraded',
      value: 1,
      threshold: 1,
    }
    const state = alertMessage(stateAlert, ctx)
    expect(state.body).toBe('monitor.alerts.body.pluginState(state=monitor.state.degraded)')
    expect(alertRatio(stateAlert)).toBeNull()
  })

  it('Trap / 计算负载 / 背压文案', () => {
    expect(
      alertMessage({ ...base, id: 'trap-activity:-', rule: 'trap-activity', value: 3 }, ctx).body,
    ).toContain('n=3')
    expect(
      alertMessage(
        { ...base, id: 'compute-load:-', rule: 'compute-load', value: 1200, threshold: 500 },
        ctx,
      ).body,
    ).toContain('rate=1,200')
    expect(
      alertMessage(
        {
          ...base,
          id: 'task-backpressure:-',
          rule: 'task-backpressure',
          value: 2,
          secondary: 1,
        },
        ctx,
      ).body,
    ).toContain('dropped=1')
  })
})

describe('sortAlerts（排序）', () => {
  it('critical 在前，其次按插件名', () => {
    const rows = [{ id: 'b', name: 'Beta' } as PluginRow, { id: 'a', name: 'Alpha' } as PluginRow]
    const alerts = [
      {
        id: 'plugin-memory:b',
        rule: 'plugin-memory' as const,
        level: 'warning' as const,
        target: 'b',
        value: 1,
        threshold: 1,
        since: 0,
        updatedAt: 0,
      },
      {
        id: 'plugin-memory:a',
        rule: 'plugin-memory' as const,
        level: 'critical' as const,
        target: 'a',
        value: 1,
        threshold: 1,
        since: 0,
        updatedAt: 0,
      },
    ]
    expect(sortAlerts(alerts, rows).map((a) => a.id)).toEqual([
      'plugin-memory:a',
      'plugin-memory:b',
    ])
  })
})
