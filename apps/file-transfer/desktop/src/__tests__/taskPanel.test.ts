/**
 * TaskPanel 任务卡文案契约：上传批等待对端确认时的友好呈现
 *
 * 插件在接收策略 ask 的应答窗口内把发送批占位为 pending（首个进度事件推进
 * running）。本组断言卡面把 pending 的「上传」批渲染为等待确认提示，而不是
 * 排队/空进度，且不影响传输中任务卡。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskPanel from '../components/TaskPanel.vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { Task } from '../types'

const context = {
  i18n: {
    t: (key: string, params?: Record<string, unknown>): string =>
      i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {}),
  },
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'batch-1',
    direction: 'upload',
    peer: { deviceId: 'peer-1', name: '客厅电脑' },
    remotePath: 'report.pdf',
    size: 0,
    offset: 0,
    rateBps: 0,
    state: 'pending',
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    initiator: 'me',
    ...overrides,
  }
}

function mountPanel(tasks: Task[]) {
  return mount(TaskPanel, {
    props: {
      tasks,
      totalSpeed: 0,
      receiving: [],
      history: [],
      peerNames: {},
      downloadDir: '',
    },
    global: { provide: { pluginContext: context } },
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

afterEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

describe('TaskPanel — 上传批等待对端确认', () => {
  it('pending 上传卡显示「等待对方确认」与友好提示，隐藏空进度与大小行', () => {
    const wrapper = mountPanel([makeTask()])

    expect(wrapper.text()).toContain('等待对方确认')
    expect(wrapper.text()).toContain('正在等待对方确认，对方接受后将自动开始传输')
    expect(wrapper.text()).not.toContain('排队')
    expect(wrapper.find('.ft-pbar').exists()).toBe(false)
    expect(wrapper.find('.ft-task-meta').exists()).toBe(false)
    // 等待中仍可取消
    expect(wrapper.find('.ft-mini-btn[title="取消"]').exists()).toBe(true)
  })

  it('传输中的上传卡保持原有进度与元信息呈现', () => {
    const wrapper = mountPanel([
      makeTask({ state: 'transferring', size: 2048, offset: 1024, rateBps: 1024 }),
    ])

    expect(wrapper.text()).toContain('传输中')
    expect(wrapper.text()).not.toContain('等待对方确认')
    expect(wrapper.find('.ft-pbar').exists()).toBe(true)
    expect(wrapper.find('.ft-task-meta').exists()).toBe(true)
  })

  it('pending 的下载方向不套用等待确认文案（语义只属于本端发起的上传批）', () => {
    const wrapper = mountPanel([makeTask({ direction: 'download' })])

    expect(wrapper.text()).toContain('排队')
    expect(wrapper.text()).not.toContain('等待对方确认')
  })
})
