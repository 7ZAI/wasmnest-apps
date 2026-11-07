/**
 * 会话状态判据单测（`useSessionCenter` 的三条纯函数）
 *
 * 背景：桌面端「运行中的会话」曾虚报三十余个。根因是 `session.list` 走
 * `view_json`，错误态出线为宿主 externally-tagged 对象 `{ "error": "…" }`
 * 而非字符串 `'error'`，裸比对 `status !== 'error'` 恒真 → 每条历史错误会话
 * 都被算成运行中。同时旧的宽口径把 `idle` / `stopping` 过渡态也算进计数，
 * 与后端 `list_running_sessions`（只认 running / starting / waitingInput）
 * 对不上账。
 *
 * 本用例钉住两条口径的分工，防止有人把它们合并回一条：
 * - `isRunningStatus` = 仍持有 PTY（操作语义：删除前是否先 close）
 * - `isRunningStatusCounted` = 真正运行中（**唯一**计数口径）
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeSessionStatus,
  isRunningStatus,
  isRunningStatusCounted,
  isViewableStatus,
} from '../composables/useSessionCenter'

describe('normalizeSessionStatus（线形状归一）', () => {
  it('字符串状态原样返回', () => {
    for (const s of ['idle', 'starting', 'running', 'waitingInput', 'stopping', 'stopped']) {
      expect(normalizeSessionStatus(s)).toBe(s)
    }
  })

  it('externally-tagged 错误态对象归一为字符串 error', () => {
    expect(normalizeSessionStatus({ error: 'host process restarted; run interrupted' })).toBe(
      'error',
    )
    // 无载荷错误态（SessionStatus::Error(None)）同样是对象
    expect(normalizeSessionStatus({ error: null })).toBe('error')
  })

  it('空值 / 异常值降级 idle（不抛、不误判为运行）', () => {
    expect(normalizeSessionStatus(undefined)).toBe('idle')
    expect(normalizeSessionStatus(null)).toBe('idle')
    expect(normalizeSessionStatus('')).toBe('idle')
    expect(normalizeSessionStatus(42)).toBe('idle')
    expect(normalizeSessionStatus({ foo: 'bar' })).toBe('idle')
  })
})

describe('isRunningStatus（仍持有 PTY：操作语义口径）', () => {
  it('错误态对象必须判为已终止', () => {
    expect(isRunningStatus({ error: 'pty closed' })).toBe(false)
    expect(isRunningStatus({ error: null })).toBe(false)
    expect(isRunningStatus('error')).toBe(false)
  })

  it('stopped 判为已终止，其余状态仍算活着', () => {
    expect(isRunningStatus('stopped')).toBe(false)
    for (const s of ['idle', 'starting', 'running', 'waitingInput', 'stopping']) {
      expect(isRunningStatus(s), s).toBe(true)
    }
  })
})

describe('isRunningStatusCounted（运行中计数口径）', () => {
  it('只认 running / starting / waitingInput（与后端 list_running_sessions 同源）', () => {
    for (const s of ['running', 'starting', 'waitingInput']) {
      expect(isRunningStatusCounted(s), s).toBe(true)
    }
  })

  it('idle / stopping / stopped / error / 错误态对象都不计入', () => {
    for (const s of ['idle', 'stopping', 'stopped', 'error']) {
      expect(isRunningStatusCounted(s), s).toBe(false)
    }
    expect(isRunningStatusCounted({ error: 'pty closed' })).toBe(false)
    expect(isRunningStatusCounted(null)).toBe(false)
  })

  it('计数口径 ⊆ 操作口径：计数的状态一定仍持有 PTY', () => {
    const all = [
      'idle',
      'starting',
      'running',
      'waitingInput',
      'stopping',
      'stopped',
      'error',
      { error: 'x' },
      null,
    ]
    for (const s of all) {
      if (isRunningStatusCounted(s)) expect(isRunningStatus(s), String(s)).toBe(true)
    }
  })
})

describe('isViewableStatus（终端窗口可看）', () => {
  it('仅 running / waitingInput 可看，错误态对象不可看', () => {
    expect(isViewableStatus('running')).toBe(true)
    expect(isViewableStatus('waitingInput')).toBe(true)
    for (const s of ['idle', 'starting', 'stopping', 'stopped', 'error']) {
      expect(isViewableStatus(s), s).toBe(false)
    }
    expect(isViewableStatus({ error: 'pty closed' })).toBe(false)
  })
})
