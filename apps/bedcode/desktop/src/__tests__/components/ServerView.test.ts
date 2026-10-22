/**
 * ServerView 端口保存行为契约（service-leases 后只读页）
 *
 * 启停 / 重启 / 自启动控件已随宿主命令退役：传输面由应用界面租约驱动
 * （打开应用界面即持有 net.transport，关闭最后一个界面即停播）。本页只保留
 * 状态、指标、端口与网络配置展示；端口修改下一次服务启动时生效。
 *
 * 契约清单：
 * - C1 端口未修改：点保存不触发任何调用
 * - C2 保存新端口：updatePort(新端口) + 「下次启动生效」toast，不弹重启确认
 * - C3 updatePort 失败：透出错误（showUserError），不提示成功
 * - C4 端口输入框回车同样触发保存（keyup.enter 绑定）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import ServerView from '@/views/ServerView.vue'

// ==================== mocks ====================

const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

/** useServer Mock 替身：ref 状态可被测试改写，updatePort 同步内存端口（同后台语义） */
function makeServerMocks(initialPort = 8765) {
  const status = ref<'running' | 'stopped'>('running')
  const port = ref(initialPort)
  const mocks = {
    status: status as any,
    port: port as any,
    localIps: ref<string[]>([]) as any,
    metrics: ref(null) as any,
    metricsHistory: ref([]) as any,
    networkConfig: ref(null) as any,
    loadStatus: vi.fn(async () => {}),
    updatePort: vi.fn(async (p: number) => {
      port.value = p
    }),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    loadNetworkConfig: vi.fn(async () => {}),
    resetNetworkConfig: vi.fn(async () => {
      port.value = 8765
      return { port: 8765 } as any
    }),
  }
  return { mocks, status, port }
}

vi.mock('@/composables/useServer', () => ({
  useServer: () => serverMocks.mocks,
}))

let serverMocks: ReturnType<typeof makeServerMocks>
beforeEach(() => {
  serverMocks = makeServerMocks()
  toastSuccess.mockClear()
})

// echarts / 图表太重，stub 掉
vi.mock('vue-echarts', () => ({ default: defineComponent({ name: 'VChartStub', render: () => h('div') }) }))
vi.mock('echarts/core', () => ({ use: vi.fn() }))
vi.mock('echarts/charts', () => ({ LineChart: {} }))
vi.mock('echarts/components', () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

/** 测试用最小 i18n 实例：只含断言所涉 key；缺失 key 回退为 key 本身 */
function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    messages: {
      'zh-CN': {
        desktop: {
          server: {
            portSave: '保存',
            portSavedDelayed: 'PORT_SAVED_DELAYED',
          },
        },
      },
    },
  })
}

function mountView() {
  return shallowMount(ServerView, {
    global: {
      plugins: [createTestI18n()],
      stubs: { VChart: true, PluginPageToolbar: true, echarts: true },
    },
  })
}

describe('ServerView 端口保存（只读页）', () => {
  it('C1 端口未修改时保存不触发任何调用', async () => {
    const wrapper = await mountView()
    await flushPromises()
    expect(serverMocks.mocks.updatePort).not.toHaveBeenCalled()
    await (wrapper.vm as any).handleSavePort()
    expect(serverMocks.mocks.updatePort).not.toHaveBeenCalled()
  })

  it('C2 保存新端口 → updatePort + 下次启动生效 toast', async () => {
    const wrapper = await mountView()
    await flushPromises()
    serverMocks.mocks.port.value = 8765
    ;(wrapper.vm as any).portInput = 9000
    await (wrapper.vm as any).handleSavePort()

    expect(serverMocks.mocks.updatePort).toHaveBeenCalledWith(9000)
    expect(toastSuccess).toHaveBeenCalledWith('PORT_SAVED_DELAYED')
  })

  it('C3 updatePort 失败 → 不提示成功，内存端口保持旧值', async () => {
    serverMocks.mocks.updatePort.mockRejectedValueOnce(new Error('persist failed'))
    const wrapper = await mountView()
    await flushPromises()
    ;(wrapper.vm as any).portInput = 9000
    await (wrapper.vm as any).handleSavePort()
    await flushPromises()

    expect(serverMocks.mocks.updatePort).toHaveBeenCalledWith(9000)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(serverMocks.mocks.port.value).toBe(8765)
  })

  it('C4 端口输入框回车触发保存（keyup.enter 绑定 handleSavePort）', async () => {
    const wrapper = await mountView()
    await flushPromises()
    ;(wrapper.vm as any).portInput = 9000
    const input = wrapper.find('input')
    await input.trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(serverMocks.mocks.updatePort).toHaveBeenCalledWith(9000)
  })
})
