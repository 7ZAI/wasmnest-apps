/**
 * Agent Hub 页面对象（桌面端 · 宿主内挂载面）
 *
 * 只暴露「用户能做的事」与「用户能看见的东西」，不暴露组件内部结构——用例里出现
 * `.ah-view` / `.ah-tab` 这类 class 时说明抽象漏了。
 *
 * 锚点命名：`hub-tab-<分区>` / `panel-<分区>` / `cli-<字段>-<cliId>` / `overview-*`
 * （见 `docs/E2E.md` 的锚点约定）。
 */

import { browser } from '@wdio/globals'
import en from '../../apps/agent-hub/desktop/src/i18n/en'
import zhCN from '../../apps/agent-hub/desktop/src/i18n/zh-CN'
import { click, waitFor, waitGone } from '../harness/driver'

/** 六个分区（与 `AgentHubView.vue` 的 `HubTab` 同序） */
export type HubTab = 'overview' | 'install' | 'skills' | 'providers' | 'logs' | 'stats'

export const HUB_TABS: HubTab[] = ['overview', 'install', 'skills', 'providers', 'logs', 'stats']

/** 四个受管 CLI（与 `AgentHubView.vue` 的 `CLI_IDS` 同集） */
export const HUB_CLIS = ['claude', 'codex', 'opencode', 'pi'] as const

export type HubCli = (typeof HUB_CLIS)[number]

/** CLI 显示名（`CliCard.vue` 的 `NAMES` 表；非 i18n，语言无关） */
export const HUB_CLI_NAMES: Record<HubCli, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  pi: 'Pi',
}

/**
 * 某个 i18n key 在**所有语言**下的取值集合
 *
 * 断言文案时用它替代「写死一种语言」：宿主语言随用户设置变（zh-CN / en），写死中文的
 * 断言在英文环境下必红。跨语言取并集 = 文案契约与语言无关。
 */
export function labelSet(key: keyof typeof zhCN): string[] {
  const out: string[] = []
  for (const table of [zhCN, en] as Array<Record<string, unknown>>) {
    const value = table[key]
    if (typeof value === 'string') out.push(value)
  }
  return out
}

/** 切到某分区（点标签 → 等目标面板可见） */
export async function openTab(tab: HubTab): Promise<void> {
  const ok = await click(`hub-tab-${tab}`)
  if (!ok) throw new Error(`找不到分区标签：hub-tab-${tab}`)
  await waitFor(`panel-${tab}`)
}

/** 当前选中分区的 testid（读 `aria-selected`，不读 class） */
export async function selectedTab(): Promise<string | null> {
  return browser.execute(() => {
    const el = document.querySelector('[data-testid="hub-tabs"] [role="tab"][aria-selected="true"]')
    return el ? el.getAttribute('data-testid') : null
  })
}

/** CLI 卡片状态徽章文案 */
export async function cliBadge(cli: HubCli): Promise<string | null> {
  return browser.execute((id: string) => {
    const el = document.querySelector(`[data-testid="cli-badge-${id}"]`)
    return el ? (el.textContent || '').trim() : null
  }, cli)
}

/** 卸载按钮文案（两击确认会改文案） */
export async function cliUninstallLabel(cli: HubCli): Promise<string | null> {
  return browser.execute((id: string) => {
    const el = document.querySelector(`[data-testid="cli-uninstall-${id}"]`)
    return el ? (el.textContent || '').trim() : null
  }, cli)
}

/** 等某分区面板消失（退场过渡结束后） */
export async function expectTabClosed(tab: HubTab): Promise<void> {
  await waitGone(`panel-${tab}`)
}
