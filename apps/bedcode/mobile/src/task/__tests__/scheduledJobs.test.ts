/**
 * 定时任务前端契约测试（2026-10-27 排查）
 *
 * 定时链路里移动端唯一的「写入」动作是创建 job：本地时间 → UTC 字符串、
 * prompts 去空、config_id 透传。桌面端 create_job 对 trigger_at 做
 * "YYYY-MM-DD HH:MM:SS" UTC 严格校验，格式错会被直接拒绝，因此这三项
 * 都是跨端 wire 契约，不能只靠手测。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-SJ1 | dateToUtc | Date → UTC "YYYY-MM-DD HH:MM:SS"；空/非法 → '' |
 * | C-SJ2 | parsePrompts | JSON 数组取字符串项；损坏数据 → [] |
 * | C-SJ3 | submit | POST scheduled-jobs/create，body 只含非空 prompts、空 name 不下发 |
 * | C-SJ4 | submit 校验 | 缺配置/时间/prompts 时不发请求 |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installMockMobileApi, uninstallMockMobileApi } from '../../terminal/__tests__/testKit'
import { dateToUtc, parsePrompts, useScheduledJobs } from '../composables/useScheduledJobs'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

const BASE = '/api/plugin/com.wasmnest.bedcode'

function makeContext(): PluginContext {
  return {
    i18n: { t: (key: string) => key },
    dialogs: { showToast: vi.fn() },
    events: { on: () => ({ dispose() {} }) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
  } as unknown as PluginContext
}

let httpRequest: ReturnType<typeof vi.fn>

beforeEach(() => {
  httpRequest = vi.fn(async () => ({ code: 0, message: 'ok', data: { job_id: 'j1' } }))
  installMockMobileApi({ isConnected: true, isPaired: true, httpRequest })
})

afterEach(() => {
  uninstallMockMobileApi()
})

describe('C-SJ1 dateToUtc', () => {
  it('should_format_utc_without_iso_markers', () => {
    expect(dateToUtc(new Date('2026-10-27T10:30:45Z'))).toBe('2026-10-27 10:30:45')
  })

  it('should_return_empty_string_for_absent_or_invalid_date', () => {
    expect(dateToUtc(null)).toBe('')
    expect(dateToUtc(undefined)).toBe('')
    expect(dateToUtc(new Date('not-a-date'))).toBe('')
  })
})

describe('C-SJ2 parsePrompts', () => {
  it('should_parse_string_array_and_drop_non_strings', () => {
    expect(parsePrompts('["a", 1, "b", null]')).toEqual(['a', 'b'])
  })

  it('should_return_empty_array_for_corrupted_or_absent_column', () => {
    expect(parsePrompts(null)).toEqual([])
    expect(parsePrompts('')).toEqual([])
    expect(parsePrompts('{oops')).toEqual([])
    expect(parsePrompts('{"a":1}')).toEqual([])
  })
})

describe('C-SJ3 submit wire contract', () => {
  it('should_post_only_filled_prompts_and_utc_trigger_when_submit', async () => {
    const scheduled = useScheduledJobs(makeContext())
    const trigger = new Date('2026-11-01T08:05:00Z')
    scheduled.formConfigId.value = 'cfg-1'
    scheduled.formTriggerAt.value = trigger
    scheduled.formPrompts.value = ['  ls -la  ', '   ', 'npm test']

    await scheduled.submit()

    expect(httpRequest).toHaveBeenCalledWith(`${BASE}/scheduled-jobs/create`, {
      method: 'POST',
      body: {
        config_id: 'cfg-1',
        trigger_at: '2026-11-01 08:05:00',
        prompts: ['ls -la', 'npm test'],
      },
    })
    // 成功后关闭表单并重拉列表
    expect(scheduled.formOpen.value).toBe(false)
    expect(httpRequest).toHaveBeenCalledWith(`${BASE}/scheduled-jobs/list`)
  })
})

describe('C-SJ4 submit validation', () => {
  it('should_not_post_when_config_or_time_or_prompts_missing', async () => {
    const scheduled = useScheduledJobs(makeContext())

    // 缺配置
    scheduled.formTriggerAt.value = new Date('2026-11-01T08:05:00Z')
    scheduled.formPrompts.value = ['run']
    await scheduled.submit()

    // 缺时间
    scheduled.formConfigId.value = 'cfg-1'
    scheduled.formTriggerAt.value = null
    await scheduled.submit()

    // 缺 prompts（全是空白）
    scheduled.formTriggerAt.value = new Date('2026-11-01T08:05:00Z')
    scheduled.formPrompts.value = ['   ']
    await scheduled.submit()

    expect(httpRequest).not.toHaveBeenCalled()
  })
})
