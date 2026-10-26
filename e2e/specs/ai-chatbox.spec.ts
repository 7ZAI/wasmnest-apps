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
  exists,
  text,
  visible,
  waitFor,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= ai-chatbox 的 plugin.json `name`） */
const APP_NAME = 'AI Chatbox'

describe('AI Chatbox（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('chat-view')
    // 壳回主屏只 detach 不销毁实例：上一用例停在配置页会随实例带回来。
    // 统一先回到聊天态，保证用例起点一致（docs/E2E.md §6 用例隔离）。
    if (await visible('chat-config-page')) {
      await click('chat-config-back')
      await waitGone('chat-config-page')
    }
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

    await click('chat-toggle-sidebar')
    await waitFor('chat-sidebar')
    expectEqual(
      await attr('chat-sidebar', 'data-collapsed'),
      before === 'true' ? 'false' : 'true',
      '折叠态已翻转',
    )

    // 复原：侧栏折叠态是持久化设置，测试不该改变用户偏好
    await click('chat-toggle-sidebar')
    await waitFor('chat-sidebar')
    expectEqual(await attr('chat-sidebar', 'data-collapsed'), before, '折叠态已复原')
  })
})
