/**
 * AI Chatbox 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本驱动界面做功能测试
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app ai-chatbox
 *
 * 判据纪律与 `agent-hub.spec.ts` 同：
 * - 不依赖机器状态（本机配没配供应商 / 有没有历史会话）；
 * - 文案断言跨语言（期望值取 app i18n 各语言取值域的并集）；
 * - 等状态不 sleep。
 */

import {
  attr,
  click,
  clickByData,
  count,
  exists,
  isDisabled,
  setValue,
  text,
  texts,
  visible,
  waitFor,
  waitForAttr,
  waitForEnabled,
  waitForHostReady,
  waitForTextEquals,
  waitForValue,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= ai-chatbox 的 plugin.json `name`） */
const APP_NAME = 'AI Chatbox'

/** 配置页可能停在设置/模板/表单任一级；逐级退回聊天区，避免用例互相污染 */
async function resetToChatView(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (await visible('provider-form')) {
      await click('chat-config-back')
      await waitGone('provider-form')
      continue
    }
    if (await visible('chat-config-templates')) {
      await click('chat-config-back')
      await waitGone('chat-config-templates')
      continue
    }
    if (await visible('chat-config-page')) {
      await click('chat-config-back')
      await waitGone('chat-config-page')
      continue
    }
    break
  }
  await waitGone('chat-config-page')
}

describe('AI Chatbox（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('chat-view')
    // 壳回主屏只 detach 不销毁实例：上一用例停在配置页会随实例带回来。
    // 统一先回到聊天态，保证用例起点一致（docs/E2E.md §6 用例隔离）。
    await resetToChatView()
    await waitFor('chat-sidebar')
  })

  it('聊天区渲染：对话列表与输入框就位', async () => {
    expectEqual(await visible('chat-view'), true, '聊天区可见')
    expectEqual(await visible('chat-sidebar'), true, '对话列表可见')
    expectEqual(await visible('chat-input'), true, '消息输入框可见')
    expectEqual(await exists('chat-settings'), true, '设置入口存在')
  })

  it('设置页可开可合：齿轮 → 配置页 → 返回聊天区', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')
    expectEqual(await visible('chat-config-back'), true, '配置页返回按钮可见')

    await click('chat-config-back')
    await waitGone('chat-config-page')
    expectEqual(await visible('chat-view'), true, '已回到聊天区')
  })

  it('供应商摘要可折叠可展开', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')

    expectEqual(await attr('provider-summary-toggle', 'aria-expanded'), 'true', '初始展开')
    await click('provider-summary-toggle')
    expectEqual(await attr('provider-summary-toggle', 'aria-expanded'), 'false', '已折叠')
    // 折叠体是 v-show（元素仍在 DOM，只是不可见）
    await waitGone('provider-summary-list')
    expectEqual(await exists('provider-summary-list'), true, '折叠体仍在 DOM')
    expectEqual(await visible('provider-summary-list'), false, '折叠体不可见')

    await click('provider-summary-toggle')
    expectEqual(await attr('provider-summary-toggle', 'aria-expanded'), 'true', '已展开')
  })

  it('添加供应商入口进入模板选择页，可返回设置页', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')

    await click('provider-summary-add')
    await waitFor('chat-config-templates')
    expectEqual(await visible('chat-config-templates'), true, '模板选择页可见')

    await click('chat-config-back')
    await waitGone('chat-config-templates')
    expectEqual(await visible('chat-config-page'), true, '已回到设置页')
  })

  it('对话列表侧栏可折叠可展开（状态写回前复原）', async () => {
    const before = await attr('chat-sidebar', 'data-collapsed')
    expectEqual(before !== null, true, '侧栏折叠态可读')
    expectEqual(await exists('chat-new-conversation'), before !== 'true', '展开态才有新建入口')

    await click('chat-toggle-sidebar')
    await waitForAttr('chat-sidebar', 'data-collapsed', before === 'true' ? 'false' : 'true')
    expectEqual(await exists('chat-new-conversation'), before === 'true', '折叠态隐藏新建入口')

    // 复原：侧栏折叠态是持久化设置，测试不该改变用户偏好
    await click('chat-toggle-sidebar')
    await waitForAttr('chat-sidebar', 'data-collapsed', before)
    expectEqual(await exists('chat-new-conversation'), before !== 'true', '复原后新建入口状态一致')
  })

  it('供应商模板：五张模板卡，DeepSeek 回填名称/URL/模型，Key 控制拉取与测试连接', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')
    await click('provider-summary-add')
    await waitFor('chat-config-templates')
    expectEqual(await count('chat-config-template'), 4, '四个内置供应商模板')
    expectEqual(await exists('chat-config-template-custom'), true, '自定义模板入口存在')

    await clickByData('chat-config-template', 'data-preset-id', 'deepseek')
    await waitFor('provider-form')
    await waitForValue('provider-form-name', 'DeepSeek')
    await waitForValue('provider-form-base-url', 'https://api.deepseek.com/v1')
    expectEqual(
      await texts('provider-form-model'),
      ['deepseek-chat', 'deepseek-reasoner'],
      '模型回填',
    )
    expectEqual(await isDisabled('provider-form-save'), true, '缺 Key 时保存禁用')
    expectEqual(await isDisabled('provider-form-fetch-models'), true, '无 Key 不可拉取模型')
    expectEqual(await isDisabled('provider-form-test-connection'), true, '无 Key 不可测试连接')

    await setValue('provider-form-api-key', 'e2e-test-key-placeholder')
    await waitForEnabled('provider-form-save')
    await waitForEnabled('provider-form-fetch-models')
    await waitForEnabled('provider-form-test-connection')
    expectEqual(await attr('provider-form-api-key', 'type'), 'password', 'Key 默认掩码')
    await click('provider-form-api-key-toggle')
    await waitForAttr('provider-form-api-key', 'type', 'text', 5_000)
    await click('provider-form-api-key-toggle')
    await waitForAttr('provider-form-api-key', 'type', 'password', 5_000)

    // 不保存、不发网络请求：逐级退回聊天区
    await resetToChatView()
    expectEqual(await visible('chat-view'), true, '已回到聊天区')
  })

  it('应用设置：代码字号步进后复原', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')
    const beforeText = await text('code-font-size')
    const size = Number(beforeText)
    expectEqual(Number.isInteger(size), true, '字号为整数')
    const increase = size < 18
    await click(increase ? 'code-font-size-increase' : 'code-font-size-decrease')
    await waitForTextEquals('code-font-size', String(size + (increase ? 1 : -1)))
    await click(increase ? 'code-font-size-decrease' : 'code-font-size-increase')
    await waitForTextEquals('code-font-size', String(size))
    await resetToChatView()
  })

  it('应用设置：思考模式控制推理强度行显隐并复原', async () => {
    await click('chat-settings')
    await waitFor('chat-config-page')
    const modes = ['default', 'enabled', 'disabled']
    const pressed = await Promise.all(
      modes.map(async (m) =>
        (await attr(`thinking-mode-${m}`, 'aria-pressed')) === 'true' ? m : null,
      ),
    )
    const original = pressed.find((m): m is string => m !== null) ?? 'default'

    await click('thinking-mode-enabled')
    await waitForAttr('thinking-mode-enabled', 'aria-pressed', 'true', 5_000)
    await waitFor('reasoning-effort-row')
    expectEqual(await visible('reasoning-effort-row'), true, '强制开启时显示推理强度')

    await click('thinking-mode-default')
    await waitForAttr('thinking-mode-default', 'aria-pressed', 'true', 5_000)
    await waitGone('reasoning-effort-row')

    if (original !== 'default') {
      await click(`thinking-mode-${original}`)
      await waitForAttr(`thinking-mode-${original}`, 'aria-pressed', 'true', 5_000)
    }
    await resetToChatView()
  })
})
