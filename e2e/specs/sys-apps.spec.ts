/**
 * 系统服务区（桌面端 · 真实宿主）
 *
 * 需求（应用仓 `.scratch/2026-10-22-monitor-system-service` §3）：应用管理页
 * 按 manifest `kind` 分组——L1/L2 = 系统服务（在前），L3 = 应用；系统服务
 * 不提供卸载；自启开关显示且缺省开（用户可关）。
 *
 * 判据纪律：
 * - 隔离插件目录里只有 monitor（`internal-business`）→ 服务区必然在场、应用区
 *   不渲染空标题；不断言本机其他应用。
 * - 只断结构 / 状态，不点自启开关（避免污染真实用户数据目录）。
 */
import { browser } from '@wdio/globals'
import { exists, text, visible, waitFor, waitForHostReady } from '../harness/driver'
import { expectEqual } from '../harness/expect'
import {
  GROUP_APPS,
  GROUP_SERVICES,
  INSTALL_BUTTON,
  SERVICE_APP_NAME,
  SYS_APPS_ROUTE,
  UNINSTALL_TEXTS,
  UPDATE_CHECK_TEXTS,
  UPDATE_LINE_PREFIX,
} from '../pages/sysApps'

describe('应用管理 · 系统服务区（桌面端 · 真实宿主）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await browser.execute((route: string) => {
      history.pushState(null, '', route)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, SYS_APPS_ROUTE)
    await waitFor(GROUP_SERVICES)
  })

  it('服务区渲染且只含 monitor；没有 L3 应用时不渲染应用区空标题', async () => {
    expectEqual(await visible(GROUP_SERVICES), true, '系统服务分区标题可见')
    expectEqual(
      (await text(GROUP_SERVICES)).trim().length > 0,
      true,
      '服务分区标题有文案（不是空分组）',
    )
    expectEqual(await exists(GROUP_APPS), false, '无业务应用时不渲染应用分区')
    expectEqual(
      (await browser.execute(() => document.body.innerText)).includes(SERVICE_APP_NAME),
      true,
      '服务卡片显示 monitor',
    )
  })

  it('系统服务不渲染卸载入口（随宿主分发）', async () => {
    const uninstallCount = await browser.execute((tokens: string[]) => {
      return Array.from(document.querySelectorAll('button')).filter((btn) => {
        const label = (btn.textContent || '').trim()
        return tokens.some((token) => label === token)
      }).length
    }, UNINSTALL_TEXTS)
    expectEqual(uninstallCount, 0, '服务卡片不得出现卸载按钮')
  })

  it('系统服务显示自启开关，且缺省开（D4：默认自启，用户可关）', async () => {
    const switches = await browser.execute(() => {
      const group = document.querySelector('[data-testid="sys-apps-group-services"]')
      if (!group) return null
      // 分组标题之后是服务卡片（ShellCard），自启开关是卡片内的第二个 switch
      const card = group.nextElementSibling
      if (!card) return null
      const all = Array.from(card.querySelectorAll('button[role="switch"]'))
      return all.map((el) => el.getAttribute('aria-checked'))
    })

    expectEqual(Array.isArray(switches) && switches!.length >= 2, true, '启用 / 自启两个开关在场')
    expectEqual(switches![1], 'true', '系统服务自启缺省开')
  })

  // ==================== 应用更新面（应用版本更新全链路） ====================

  it('非本地安装来源不渲染更新面（更新只对 user-installed 开放，与卸载同门槛）', async () => {
    // 隔离现场里 monitor 是 builtin + 系统服务——两类门槛都不该有更新面
    const updateNodeCount = await browser.execute((prefix: string) => {
      return Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`)).length
    }, UPDATE_LINE_PREFIX)
    expectEqual(updateNodeCount, 0, 'builtin / 服务应用不得出现更新面节点')
    const checkCount = await browser.execute((tokens: string[]) => {
      return Array.from(document.querySelectorAll('button')).filter((btn) => {
        const label = (btn.textContent || '').trim()
        return tokens.some((token) => label === token)
      }).length
    }, UPDATE_CHECK_TEXTS)
    expectEqual(checkCount, 0, '服务卡片不得出现检查更新按钮')
  })

  it('安装应用入口在场（本地 zip 链路）', async () => {
    expectEqual(await exists(INSTALL_BUTTON), true, '安装应用按钮渲染')
    const label = ((await text(INSTALL_BUTTON)) || '').trim()
    expectEqual(label.length > 0, true, '安装应用按钮有文案')
  })
})
