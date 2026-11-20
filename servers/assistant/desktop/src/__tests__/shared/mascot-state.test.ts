import { describe, expect, it } from 'vitest'
import { deriveMascotState } from '@nest-shared/ui/mascot-state'

describe('deriveMascotState', () => {
  it('六种输入分别得到六种状态', () => {
    expect(deriveMascotState({})).toBe('idle')
    expect(deriveMascotState({ awaitingFirstToken: true })).toBe('thinking')
    expect(deriveMascotState({ streaming: true })).toBe('streaming')
    expect(deriveMascotState({ toolStates: ['running'] })).toBe('tooling')
    expect(deriveMascotState({ error: '连接失败' })).toBe('error')
    expect(deriveMascotState({ locked: true })).toBe('locked')
  })

  it('多个条件同时成立时按锁定 → 错误 → 工具 → 流式 → 思考取一个', () => {
    expect(
      deriveMascotState({
        locked: true,
        error: 'x',
        toolStates: ['running'],
        streaming: true,
        awaitingFirstToken: true,
      }),
    ).toBe('locked')

    expect(
      deriveMascotState({
        error: 'x',
        toolStates: ['running'],
        streaming: true,
      }),
    ).toBe('error')

    expect(deriveMascotState({ toolStates: ['awaiting'], streaming: true })).toBe('tooling')
    expect(deriveMascotState({ streaming: true, awaitingFirstToken: true })).toBe('streaming')
  })

  it('已结束或已拒绝的工具不触发工具态', () => {
    expect(deriveMascotState({ toolStates: ['done', 'rejected', 'stopped'] })).toBe('idle')
  })

  it('空错误字符串不触发错误态', () => {
    expect(deriveMascotState({ error: '' })).toBe('idle')
  })
})