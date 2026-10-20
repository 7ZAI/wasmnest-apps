/**
 * E2E 宿主壳层 —— 桌面宿主的「壳」交互（主屏 / 应用卡）
 *
 * 桌面 UI 宿主（方案 C 壳）的结构：**主屏**（应用网格 + 系统网格）→ 点应用卡 →
 * 挂载槽装载该 app 的独立前端整包（同一 webview 同一 document，非 iframe）→
 * 壳路由切到该 app 的路由前缀（agent-hub = `/hub`）。
 *
 * 所以 E2E 里「打开某个 app」= 主屏点应用卡，「回主屏」= 壳路由回 `/`。
 *
 * ## 选择器说明
 *
 * 壳元素**没有** `data-testid`（宿主仓未加），本层只依赖 **ARIA 语义**
 * （`role="list"` / `role="listitem"` / `aria-label`）+ 可见文本，不依赖内部 class
 * 名——class 名是实现细节，改样式就会碎。
 *
 * 「回主屏」用壳路由 `history.pushState` + `popstate`（与平台仓既有 smoke spec 同形）：
 * 壳标题栏的「主页」按钮没有稳定锚点，且它带本地化文案（`aria-label` 随语言变）。
 * 导航属于**前置步骤**而非被测对象，用路由直达更稳；被测对象（app 内部交互）一律走
 * 真实点击。
 */

import { browser } from '@wdio/globals'
import { DEFAULT_TIMEOUT } from './driver'

/** 主屏上的一个应用卡（显示名 + 状态文案） */
export interface HomeAppCard {
  /** 应用显示名（= plugin.json 的 name） */
  name: string
  /** 状态文案（未启动 / 运行中 / 待授权 …，宿主 i18n） */
  status: string
}

/** 主屏应用网格里的卡片列表（第一个 `role="list"` = 应用网格，系统网格在其后） */
export async function homeAppCards(): Promise<HomeAppCard[]> {
  return browser.execute(() => {
    const grid = document.querySelector('[role="list"]')
    if (!grid) return []
    const items = Array.from(grid.querySelectorAll('[role="listitem"]'))
    const out: Array<{ name: string; status: string }> = []
    for (const item of items) {
      const aria = item.getAttribute('aria-label') || ''
      const sep = aria.indexOf('，')
      const status = sep >= 0 ? aria.slice(sep + 1) : ''
      const name = sep >= 0 ? aria.slice(0, sep) : (item.textContent || '').trim()
      out.push({ name, status })
    }
    return out
  })
}

/** 主屏是否已渲染（应用网格出现） */
export async function waitForHome(timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.waitUntil(async () => (await homeAppCards()).length > 0, {
    timeout,
    interval: 150,
    timeoutMsg: '宿主主屏未渲染（应用网格为空）',
  })
}

/** 回主屏（壳路由 '/'） */
export async function goHome(timeout = DEFAULT_TIMEOUT): Promise<void> {
  await browser.execute(() => {
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await waitForHome(timeout)
}

/**
 * 点主屏应用卡，打开该 app
 *
 * @param displayName 应用显示名（= plugin.json 的 name，如 `Agent Hub`）
 * @throws 找不到卡片时抛错（fail-visible：静默跳过会把「应用没装上」伪装成「用例通过」）
 */
export async function openApp(displayName: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  const clicked = await browser.execute((name: string) => {
    const grid = document.querySelector('[role="list"]')
    if (!grid) return false
    const items = Array.from(grid.querySelectorAll('[role="listitem"]'))
    const hit = items.find((el) => {
      const label = el.getAttribute('aria-label') || ''
      const nm = (el.querySelector('.nm')?.textContent || label.split('，')[0] || '').trim()
      return nm === name || label.startsWith(name + '，')
    }) as HTMLElement | undefined
    if (!hit) return false
    hit.click()
    return true
  }, displayName)

  if (!clicked) {
    const cards = await homeAppCards()
    throw new Error(`主屏找不到应用卡「${displayName}」。当前主屏卡片：${JSON.stringify(cards)}`)
  }
  await browser.waitUntil(
    async () => {
      const href = await browser.execute(() => window.location.pathname)
      return typeof href === 'string' && href !== '/' && href !== ''
    },
    {
      timeout,
      interval: 150,
      timeoutMsg: `点开「${displayName}」后壳路由未离开主屏（应用可能装载失败）`,
    },
  )
}

/** 当前壳路由路径 */
export async function currentRoute(): Promise<string> {
  return browser.execute(() => window.location.pathname)
}
