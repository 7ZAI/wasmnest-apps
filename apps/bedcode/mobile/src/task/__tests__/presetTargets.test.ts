/**
 * 预设目标扩展（项目 × agent）的持久化契约
 *
 * 宿主 `PresetTask` 没有项目/agent 字段，应用侧用独立 localStorage 键记录；
 * 本用例锁三件事：读写往返、空目标清除、损坏数据不炸。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getPresetTarget, removePresetTarget, setPresetTarget } from '../presetTargets'

describe('presetTargets', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('set → get 往返同一目标', () => {
    setPresetTarget('p1', { projectId: 'proj-1', agentId: 'claude' })
    expect(getPresetTarget('p1')).toEqual({ projectId: 'proj-1', agentId: 'claude' })
  })

  it('空目标 / 缺字段按清除处理', () => {
    setPresetTarget('p1', { projectId: 'proj-1', agentId: 'claude' })
    setPresetTarget('p1', null)
    expect(getPresetTarget('p1')).toBeNull()
    setPresetTarget('p2', { projectId: 'proj-1', agentId: '' })
    expect(getPresetTarget('p2')).toBeNull()
  })

  it('removePresetTarget 只删指定预设', () => {
    setPresetTarget('p1', { projectId: 'proj-1', agentId: 'claude' })
    setPresetTarget('p2', { projectId: 'proj-2', agentId: 'pi' })
    removePresetTarget('p1')
    expect(getPresetTarget('p1')).toBeNull()
    expect(getPresetTarget('p2')).toEqual({ projectId: 'proj-2', agentId: 'pi' })
  })

  it('损坏的存储数据按空表处理，不抛错', () => {
    localStorage.setItem('bedcode.preset-targets', '{oops')
    expect(getPresetTarget('p1')).toBeNull()
    setPresetTarget('p1', { projectId: 'proj-1', agentId: 'claude' })
    expect(getPresetTarget('p1')).toEqual({ projectId: 'proj-1', agentId: 'claude' })
  })
})
