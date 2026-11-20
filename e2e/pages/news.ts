/**
 * News 页面对象（桌面 E2E）
 *
 * 只放该 app 的语义动作（进应用、切视图、开设置、增删源 / 圈子）；spec 里只写
 * 「用户做了什么 + 看得见什么」。组件内部结构（`.news-*` class）不出现在这里，
 * 定位一律用 `data-testid` 与本应用自己声明的 `data-news-*` 状态位。
 *
 * 名称 / 时间的跨语言断言在这里集中：需要取值域时用 `labelSet`。
 */
import { browser } from '@wdio/globals'
import {
  attr,
  click,
  denyNetworkAuthIfPresent,
  exists,
  text,
  typeInto,
  visible,
  waitFor,
  waitForAttr,
  waitGone,
} from '../harness/driver'
import { clickAppCard, goHome, waitForAppRoute } from '../harness/shell'
import zhCN from '../../apps/news/desktop/src/i18n/zh-CN'
import en from '../../apps/news/desktop/src/i18n/en'

/** 应用显示名（= desktop/plugin.json `name`；主屏应用卡的定位依据） */
export const APP_NAME = 'News'

/** 插件 id（产物目录名 / 宿主诊断里的 id） */
export const PLUGIN_ID = 'com.wasmnest.news'

/** 四段视图 key（与 `FEED_VIEWS` 同序） */
export const VIEW_KEYS = ['today', 'circles', 'realtime', 'saved'] as const
export type ViewKey = (typeof VIEW_KEYS)[number]

/** 视图分段按钮（`role="tab"` + `aria-selected` 是选中态判据） */
export function viewTab(key: ViewKey): string {
  return `news-view-${key}`
}

/** 视图切换：点分段并等 `aria-selected` 翻转（等状态，不 sleep） */
export async function switchView(key: ViewKey): Promise<void> {
  await click(viewTab(key))
  await waitForAttr(viewTab(key), 'aria-selected', 'true')
}

/** 是否停在某个视图（读语义状态位，不读 class） */
export async function isViewSelected(key: ViewKey): Promise<boolean> {
  return (await attr(viewTab(key), 'aria-selected')) === 'true'
}

/**
 * 首屏补抓会为每个内置源各弹一次宿主网络授权询问（每源最多等 30s）
 *
 * 补抓由界面挂载后的 `news.refresh-stale` 驱动，此时应用已可用。E2E 一律「拒绝」：
 * 拒绝不落授权记录、请求立即失败，既不让用例卡在 30s 询问上，也不需要外网。
 * 用「连续 idleMs 内没有新弹窗」作为收敛判据（弹窗彼此间隔取决于串行抓取）。
 *
 * @returns 实际拒掉的弹窗数
 */
export async function drainNetworkPrompts(max = 12, idleMs = 1_200): Promise<number> {
  let denied = 0
  let lastSeen = Date.now()
  while (denied < max) {
    if (await denyNetworkAuthIfPresent()) {
      denied += 1
      lastSeen = Date.now()
      continue
    }
    if (Date.now() - lastSeen >= idleMs) break
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return denied
}

/**
 * 把应用归位到卡片流：收详情 / 关设置 / 回到今日
 *
 * 壳只 detach 不销毁实例：上一用例停在设置页或详情抽屉时，实例会把状态带回来。
 */
export async function ensureFeedView(): Promise<void> {
  if (await visible('news-detail')) {
    await click('news-detail-close')
    await waitGone('news-detail')
  }
  if (await visible('news-page-settings')) {
    await closeSettings()
  }
  if (!(await isViewSelected('today'))) {
    await switchView('today')
  }
  await waitFor('news-feed')
}

/** 打开 News：主屏 → 应用卡 → 归位卡片流 → 清掉首屏补抓引起的授权询问 */
export async function openNews(): Promise<void> {
  await goHome()
  await clickAppCard(APP_NAME)
  await waitForAppRoute(APP_NAME)
  await waitFor('news-view')
  await ensureFeedView()
  await drainNetworkPrompts()
}

/** 打开设置页（feed 与设置页互斥挂载） */
export async function openSettings(): Promise<void> {
  await click('news-open-settings')
  await waitFor('news-page-settings')
  await waitFor('news-settings')
}

/** 关闭设置页，回到卡片流 */
export async function closeSettings(): Promise<void> {
  await click('news-settings-close')
  await waitGone('news-page-settings')
  await waitFor('news-feed')
}

/** 设置页六个页签 */
export const SETTINGS_TABS = ['sources', 'circles', 'ai', 'log', 'data', 'about'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export function settingsTab(key: SettingsTab): string {
  return `news-settings-tab-${key}`
}

export function settingsPane(key: SettingsTab): string {
  return `news-settings-pane-${key}`
}

/** 切设置页签，等对应面板可见（旧面板随 v-if 卸载） */
export async function openSettingsTab(key: SettingsTab): Promise<void> {
  await click(settingsTab(key))
  await waitFor(settingsPane(key))
}

/** 阅读开关的 DOM 勾选态（`checked` 是 property，不是 attribute） */
export function readerEnabledState(): Promise<boolean> {
  return browser.execute(() => {
    const el = document.querySelector('[data-testid="news-reader-enabled"]') as HTMLInputElement | null
    return el ? el.checked : false
  })
}

/** 等阅读开关到达指定勾选态 */
export async function waitForReaderEnabled(
  expected: boolean,
  timeout = 10_000,
): Promise<void> {
  await browser.waitUntil(async () => (await readerEnabledState()) === expected, {
    timeout,
    interval: 120,
    timeoutMsg: `等待阅读开关 = ${expected} 超时`,
  })
}

/** 设置 → 数据 → 阅读区 */
export async function openReaderSettings(): Promise<void> {
  await openSettings()
  await openSettingsTab('data')
  await waitFor('news-reader-settings')
}

/** 点击阅读开关并等待状态翻转 */
export async function setReaderEnabled(enabled: boolean): Promise<void> {
  if ((await readerEnabledState()) === enabled) return
  await click('news-reader-enabled')
  await waitForReaderEnabled(enabled)
}

/** 授权类阅读失败后点「去设置」，等设置页可见 */
export async function openReaderSettingsFromFailure(): Promise<void> {
  await click('news-reader-open-settings')
  await waitFor('news-page-settings')
}

/** 阅读设置读取失败提示是否可见 */
export function readerSettingsWarningVisible(): Promise<boolean> {
  return visible('news-reader-settings-warning')
}

/**
 * 源行按名称定位，返回后端分配的源 id（= 行的 `data-news-source`）
 *
 * 源 id 由后端从 URL 派生，测试不预先知道；名称是用户输入，稳定可读。
 * 找不到返回 null（调用方用 `waitForSource` 等它出现，不 sleep）。
 */
export function sourceIdByName(name: string): Promise<string | null> {
  return browser.execute((needle: string) => {
    const rows = Array.from(document.querySelectorAll('[data-news-source]'))
    const hit = rows.find((el) => (el.textContent || '').includes(needle))
    return hit ? hit.getAttribute('data-news-source') : null
  }, name)
}

/** 等某个名称的源出现，返回其 id（超时点名当前列表，便于排障） */
export async function waitForSource(name: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const id = await sourceIdByName(name)
    if (id) return id
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`源列表里没有「${name}」；当前：${JSON.stringify(await sourceNames())}`)
}

/** 源列表当前名称（失败上下文 / 断言用） */
export function sourceNames(): Promise<string[]> {
  return browser.execute(() => {
    const rows = Array.from(document.querySelectorAll('[data-news-source]'))
    return rows.map((el) => (el.textContent || '').trim())
  })
}

/** 点某个源的某个动作（retry / edit / toggle / delete） */
export function clickSourceAction(
  id: string,
  action: 'retry' | 'edit' | 'toggle' | 'delete',
): Promise<boolean> {
  return click(`news-source-${action}-${id}`)
}

/** 等某个源进入指定启用态（`data-news-enabled` 是产品状态位） */
export async function waitForSourceEnabled(
  id: string,
  expected: boolean,
  timeout = 10_000,
): Promise<void> {
  await waitForAttr(`news-source-${id}`, 'data-news-enabled', String(expected), timeout)
}

/** 源最近一次错误分类的展示节点（`last_error_kind` 有值才渲染） */
export function sourceError(id: string): string {
  return `news-source-error-${id}`
}

/**
 * 打开宿主共享 Select 的下拉
 *
 * 下拉是宿主共享组件（不是原生 `<select>`）：testid 落在 `.form-group` 容器上，
 * 真正可点的是它内部的触发按钮，因此向内找第一个 button 再点。
 */
export async function openSelect(testid: string): Promise<void> {
  await browser.execute((t: string) => {
    const root = document.querySelector(`[data-testid="${t}"]`)
    const trigger = root?.querySelector('button') as HTMLButtonElement | null
    trigger?.click()
  }, testid)
}

/**
 * 在已打开的 Select 面板里按选项文案选中
 *
 * 面板 Teleport 到宿主文档（不在 testid 容器内），按文案精确匹配；
 * 多语言界面按候选集依次尝试（候选集来自 i18n 取值域，不锁单一语言）。
 */
export async function pickSelectOption(candidates: string[]): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const picked = await browser.execute((labels: string[]) => {
      const panels = Array.from(document.querySelectorAll('div.fixed')).filter((el) => {
        const style = window.getComputedStyle(el)
        return (
          style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0
        )
      })
      for (const panel of panels) {
        const items = Array.from(panel.querySelectorAll('li'))
        for (const label of labels) {
          const hit = items.find((li) => (li.textContent || '').trim() === label)
          if (hit) {
            ;(hit as HTMLElement).click()
            return true
          }
        }
      }
      return false
    }, candidates)
    if (picked) return
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`下拉里没有这些选项：${JSON.stringify(candidates)}`)
}

/**
 * 新增一个 RSS 源（设置 → 源 → 添加 → 填名称 / 地址 → 保存）
 *
 * 只走本地写路径，不触网；返回新源 id。
 */
export async function addRssSource(name: string, url: string): Promise<string> {
  await click('news-add-source')
  await waitFor('news-source-form')
  await typeInto('news-source-name', name)
  await openSelect('news-source-kind')
  await pickSelectOption(labelSet('news.settings.sources.kind.rss'))
  await typeInto('news-source-url', url)
  await click('news-source-save')
  await waitGone('news-source-form')
  return waitForSource(name)
}

/** 圈子行按名称定位，返回圈子 id（行的 testid 后缀） */
export function circleIdByName(name: string): Promise<string | null> {
  return browser.execute((needle: string) => {
    const rows = Array.from(document.querySelectorAll('[data-testid^="news-circle-row-"]'))
    const hit = rows.find((el) => (el.textContent || '').includes(needle))
    if (!hit) return null
    const testid = hit.getAttribute('data-testid') || ''
    return testid.replace('news-circle-row-', '') || null
  }, name)
}

/** 等圈子出现并返回 id */
export async function waitForCircle(name: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const id = await circleIdByName(name)
    if (id) return id
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`圈子列表里没有「${name}」`)
}

/** 新增圈子（名称唯一性由后端 + 表单双重校验） */
export async function addCircle(name: string, weight = 1): Promise<string> {
  await click('news-add-circle')
  await waitFor('news-circle-form')
  await typeInto('news-circle-name', name)
  await typeInto('news-circle-weight', String(weight))
  await click('news-circle-save')
  await waitGone('news-circle-form')
  return waitForCircle(name)
}

/** 圈子视图里的筛选 chip（点它等 `aria-selected` 翻转） */
export function circleChip(id: string): string {
  return `news-chip-${id}`
}

export async function selectCircleChip(id: string): Promise<void> {
  await click(circleChip(id))
  await waitForAttr(circleChip(id), 'aria-selected', 'true')
}

/** 卡片流当前是否有条目（空态与列表是两种显性状态，不存在「无解释空白」） */
export async function feedState(): Promise<'cards' | 'empty' | 'loading'> {
  if (await visible('news-cards')) return 'cards'
  if (await visible('news-empty')) return 'empty'
  if (await exists('news-cards')) return 'cards'
  if (await exists('news-empty')) return 'empty'
  return 'loading'
}

/** 等卡片流落进显性状态（列表或空态） */
export async function waitForFeedState(timeout = 15_000): Promise<'cards' | 'empty'> {
  await browser.waitUntil(async () => (await feedState()) !== 'loading', {
    timeout,
    interval: 150,
    timeoutMsg: '卡片流既没有条目也没有空态（无解释空白）',
  })
  const state = await feedState()
  return state as 'cards' | 'empty'
}

/** 首个条目卡片的 testid（详情类用例的入口；无条目返回 null） */
export function firstItemTestId(): Promise<string | null> {
  return browser.execute(() => {
    const el = document.querySelector('[data-testid^="news-item-"]')
    return el ? el.getAttribute('data-testid') : null
  })
}

/** 条目卡片数（testid 带条目 id，只能按前缀数） */
export function itemCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll('[data-testid^="news-item-"]').length)
}

/** 等条目数至少 n（有条目的机器才走详情分支） */
export async function waitForItems(atLeast = 1, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => (await itemCount()) >= atLeast, {
    timeout,
    interval: 150,
    timeoutMsg: `卡片流条目数始终少于 ${atLeast}`,
  })
}

/** 跨语言文案取值域（文案断言只比对并集，不锁单一语言） */
export function labelSet(key: keyof typeof zhCN): string[] {
  const out: string[] = []
  for (const table of [zhCN, en] as Array<Record<string, unknown>>) {
    const value = table[key]
    if (typeof value === 'string') out.push(value)
  }
  return out
}

/** 元素文本非空（「有文案」类断言，不锁具体文案） */
export async function hasText(testid: string): Promise<boolean> {
  const value = await text(testid)
  return value !== null && value.trim().length > 0
}
