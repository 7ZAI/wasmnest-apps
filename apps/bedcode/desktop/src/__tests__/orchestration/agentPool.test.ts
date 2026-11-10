import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import i18n from '@/i18n'
import AgentPoolArea from '@/components/orchestration/AgentPoolArea.vue'
import AppSelectField from '@/components/ui/AppSelectField.vue'
import type { AgentOption, AgentProfileView } from '@/composables/orchestration/types'

const execute = vi.fn()

const PROFILE: AgentProfileView = {
  id: 'ap-frontend',
  name: '前端实现',
  cli: 'pi',
  model: 'anthropic/claude-sonnet-4.5',
  thinkingLevel: 'high',
  tags: ['frontend'],
  specialties: ['Vue', 'CSS'],
  description: '负责前端页面实现与联调。',
  enabled: true,
  ready: true,
  orchestratable: true,
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
}

const CLI_OPTIONS: AgentOption[] = [
  { id: 'pi', displayName: 'Pi', ready: true, orchestratable: true },
  { id: 'opencode', displayName: 'OpenCode', ready: false, orchestratable: true },
]

function makeContext(): PluginContext {
  const translate = (key: string, params?: Record<string, unknown>) => {
    // 池错误码必须返回「已注册」的文案，才能走到业务码映射分支
    if (key.startsWith('orchestration.pool.error.')) return `T:${key}`
    if (!params) return key
    return `${key}(${Object.entries(params)
      .map(([name, value]) => `${name}=${value}`)
      .join(',')})`
  }
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: translate, getI18n: () => ({ global: { t: translate } }) },
    commands: { execute },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  } as unknown as PluginContext
}

function mountPool(profiles: AgentProfileView[], clis: AgentOption[] = CLI_OPTIONS) {
  execute.mockImplementation(async (command: string) => {
    switch (command) {
      case 'agent.profile.list':
        return { profiles }
      case 'agent.profile.options':
        return {
          cli: 'pi',
          installed: true,
          bridgeCapable: true,
          models: [{ value: 'anthropic/claude-sonnet-4.5', label: 'sonnet', source: 'catalog' }],
          thinkingLevels: ['low', 'high'],
        }
      default:
        throw new Error(`unexpected command: ${command}`)
    }
  })
  return mount(AgentPoolArea, {
    props: { agents: clis },
    global: {
      plugins: [i18n],
      provide: { pluginContext: makeContext() },
      stubs: { teleport: true },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AgentPoolArea', () => {
  it('渲染池成员：名称 / 职责 / 擅长 / 模型 / 思考等级', async () => {
    const wrapper = mountPool([PROFILE])
    await flushPromises()

    const card = wrapper.find('[data-testid="orchestration-pool-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('前端实现')
    expect(card.text()).toContain('负责前端页面实现与联调。')
    expect(card.text()).toContain('Vue')
    expect(card.text()).toContain('anthropic/claude-sonnet-4.5')
    expect(card.text()).toContain('orchestration.pool.thinkingChip(level=high)')
    wrapper.unmount()
  })

  it('空态与无可用 CLI 的提示互斥，并可显式刷新 CLI', async () => {
    const empty = mountPool([])
    await flushPromises()
    expect(empty.find('[data-testid="orchestration-pool-empty"]').exists()).toBe(true)
    empty.unmount()

    const noCli = mountPool(
      [],
      CLI_OPTIONS.map((cli) => ({ ...cli, ready: false })),
    )
    await flushPromises()
    expect(noCli.text()).toContain('orchestration.pool.noCli')
    expect(
      noCli.find('[data-testid="orchestration-pool-create"]').attributes('disabled'),
    ).toBeDefined()
    await noCli.find('[data-testid="orchestration-pool-refresh-cli"]').trigger('click')
    expect(noCli.emitted('refresh')).toHaveLength(1)
    noCli.unmount()
  })

  it('创建：提交归一后的输入，成功后重新拉取列表', async () => {
    const wrapper = mountPool([])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [PROFILE] }
      if (command === 'agent.profile.options') {
        return {
          cli: 'pi',
          installed: true,
          bridgeCapable: true,
          models: [],
          thinkingLevels: ['high'],
        }
      }
      if (command === 'agent.profile.create') return { profile: PROFILE }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-create"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="orchestration-pool-name"]').setValue('  前端实现  ')
    await wrapper
      .find('[data-testid="orchestration-pool-tags"]')
      .setValue('frontend, vue, frontend')
    await wrapper
      .find('[data-testid="orchestration-pool-specialties"]')
      .setValue('组件拆分, 样式还原')
    await wrapper
      .find('[data-testid="orchestration-pool-description"]')
      .setValue('  负责前端页面实现。  ')
    await wrapper.find('[data-testid="orchestration-pool-save"]').trigger('click')
    await flushPromises()

    const call = execute.mock.calls.find(([command]) => command === 'agent.profile.create')
    expect(call).toBeTruthy()
    expect(call?.[1]).toMatchObject({
      name: '前端实现',
      cli: 'pi',
      tags: ['frontend', 'vue'],
      specialties: ['组件拆分', '样式还原'],
      description: '负责前端页面实现。',
      enabled: true,
    })
    expect(
      execute.mock.calls.filter(([command]) => command === 'agent.profile.list').length,
    ).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('业务错误码映射到池文案，而不是回显原始 detail', async () => {
    const wrapper = mountPool([])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [] }
      if (command === 'agent.profile.options') {
        return { cli: 'pi', installed: true, bridgeCapable: true, models: [], thinkingLevels: [] }
      }
      if (command === 'agent.profile.create') {
        throw { code: 'profile-name-taken: 前端实现' }
      }
      throw new Error(`unexpected command: ${command}`)
    })
    await wrapper.find('[data-testid="orchestration-pool-create"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="orchestration-pool-name"]').setValue('前端实现')
    await wrapper.find('[data-testid="orchestration-pool-description"]').setValue('职责')
    await wrapper.find('[data-testid="orchestration-pool-save"]').trigger('click')
    await flushPromises()

    const error = wrapper.find('[data-testid="orchestration-pool-form-error"]')
    expect(error.text()).toContain('orchestration.pool.error.profile-name-taken')
    expect(error.text()).not.toContain('profile-name-taken:')
    wrapper.unmount()
  })

  it('删除需要二次确认，确认后调用删除并刷新', async () => {
    const wrapper = mountPool([PROFILE])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [PROFILE] }
      if (command === 'agent.profile.delete') return { deleted: true }
      if (command === 'agent.profile.options') {
        return { cli: 'pi', installed: true, bridgeCapable: true, models: [], thinkingLevels: [] }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-delete"]').trigger('click')
    expect(execute).not.toHaveBeenCalledWith('agent.profile.delete', expect.anything())
    await wrapper.find('[data-testid="orchestration-pool-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(execute).toHaveBeenCalledWith('agent.profile.delete', { id: PROFILE.id })
    wrapper.unmount()
  })

  it('编辑成员保留模型 / 思考等级，CLI 选项只请求一次（H6）', async () => {
    const wrapper = mountPool([PROFILE])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [PROFILE] }
      if (command === 'agent.profile.options') {
        return {
          cli: 'pi',
          installed: true,
          bridgeCapable: true,
          models: [{ value: PROFILE.model, label: PROFILE.model, source: 'catalog' }],
          thinkingLevels: ['low', 'high'],
        }
      }
      if (command === 'agent.profile.update') return { profile: PROFILE }
      throw new Error(`unexpected command: ${command}`)
    })
    execute.mockClear()

    await wrapper.find('[data-testid="orchestration-pool-edit"]').trigger('click')
    await flushPromises()

    const modelField = wrapper
      .findAllComponents(AppSelectField)
      .find((field) => field.props('testid') === 'orchestration-pool-model')
    expect(modelField).toBeTruthy()
    expect(modelField?.props('modelValue')).toBe(PROFILE.model)

    await wrapper.find('[data-testid="orchestration-pool-save"]').trigger('click')
    await flushPromises()

    const update = execute.mock.calls.find(([command]) => command === 'agent.profile.update')
    expect(update).toBeTruthy()
    expect(update?.[1]).toMatchObject({
      id: PROFILE.id,
      cli: 'pi',
      model: PROFILE.model,
      thinkingLevel: PROFILE.thinkingLevel,
    })
    expect(
      execute.mock.calls.filter(([command]) => command === 'agent.profile.options'),
    ).toHaveLength(1)
    wrapper.unmount()
  })

  it('模型下拉列出该 CLI 已适配的模型，选「自定义」切回手填', async () => {
    const wrapper = mountPool([PROFILE])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [PROFILE] }
      if (command === 'agent.profile.options') {
        return {
          cli: 'pi',
          installed: true,
          bridgeCapable: true,
          models: [
            { value: 'anthropic/claude-sonnet-4.5', label: 'sonnet', source: 'catalog' },
            { value: 'openai/gpt-5', label: 'gpt-5', source: 'catalog' },
          ],
          thinkingLevels: ['low', 'high'],
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-edit"]').trigger('click')
    await flushPromises()

    const modelField = wrapper
      .findAllComponents(AppSelectField)
      .find((field) => field.props('testid') === 'orchestration-pool-model')
    const values = (modelField?.props('options') as { value: string }[]).map(
      (option) => option.value,
    )
    expect(values).toEqual(['anthropic/claude-sonnet-4.5', 'openai/gpt-5', '__custom_model__'])

    await modelField?.vm.$emit('update:modelValue', '__custom_model__')
    await flushPromises()
    expect(wrapper.find('[data-testid="orchestration-pool-model"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="orchestration-pool-model-custom"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('目录为空（无枚举入口的 CLI）直接给自由输入', async () => {
    const wrapper = mountPool([])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [] }
      if (command === 'agent.profile.options') {
        return {
          cli: 'claude',
          installed: true,
          bridgeCapable: true,
          models: [],
          thinkingLevels: [],
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-create"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-pool-model"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="orchestration-pool-model-custom"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('无桥接 CLI 也能建成员：下拉标注、表单提示、保存可提交', async () => {
    const claude: AgentOption = {
      id: 'claude',
      displayName: 'Claude',
      ready: true,
      orchestratable: false,
    }
    const wrapper = mountPool([], [...CLI_OPTIONS, claude])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [] }
      if (command === 'agent.profile.options') {
        return {
          cli: 'claude',
          installed: true,
          bridgeCapable: false,
          models: [],
          thinkingLevels: ['high'],
        }
      }
      if (command === 'agent.profile.create') return { profile: { ...PROFILE, cli: 'claude' } }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-create"]').trigger('click')
    await flushPromises()

    // 默认仍优先可编排的 pi（opencode 未安装）
    const cliField = wrapper
      .findAllComponents(AppSelectField)
      .find((field) => field.props('testid') === 'orchestration-pool-cli')
    const options = cliField?.props('options') as { value: string; label: string }[]
    expect(options.map((option) => option.value)).toEqual(['pi', 'claude'])
    expect(options.find((option) => option.value === 'claude')?.label).toContain(
      'orchestration.pool.cliNoBridge',
    )

    await cliField?.vm.$emit('update:modelValue', 'claude')
    await flushPromises()
    expect(wrapper.find('[data-testid="orchestration-pool-bridge-hint"]').text()).toBe(
      'orchestration.pool.bridgeHint',
    )

    await wrapper.find('[data-testid="orchestration-pool-name"]').setValue('评审')
    await wrapper.find('[data-testid="orchestration-pool-description"]').setValue('只做只读评审')
    await wrapper.find('[data-testid="orchestration-pool-save"]').trigger('click')
    await flushPromises()

    const call = execute.mock.calls.find(([command]) => command === 'agent.profile.create')
    expect(call?.[1]).toMatchObject({ name: '评审', cli: 'claude' })
    wrapper.unmount()
  })

  it('卡片给无桥接成员标「不可编排」', async () => {
    const wrapper = mountPool([
      { ...PROFILE, cli: 'claude', orchestratable: false },
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-pool-no-bridge"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('删除失败提示落在确认弹窗内（M27）', async () => {
    const wrapper = mountPool([PROFILE])
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'agent.profile.list') return { profiles: [PROFILE] }
      if (command === 'agent.profile.delete') throw { code: 'profile-in-use: 已被计划引用' }
      throw new Error(`unexpected command: ${command}`)
    })

    await wrapper.find('[data-testid="orchestration-pool-delete"]').trigger('click')
    await wrapper.find('[data-testid="orchestration-pool-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-pool-delete-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="orchestration-pool-error"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
