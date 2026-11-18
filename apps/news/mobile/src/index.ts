/**
 * News 插件入口（移动端）— 宿主壳运行面
 *
 * activate：
 *   1. 注册 i18n 消息（key 自动加插件 id 前缀）
 *   2. 注入插件全局样式（宿主不加载插件 dist/style.css，运行时注入一次）
 *   3. 注册宿主壳运行面（卡片流 + 底栏四段）
 *   4. 注册设置二级页（宿主页头 + 返回）
 *
 * deactivate 对称停止激活期资源；样式保留（幂等）。
 */
import NewsView from './components/NewsView.vue'
import SettingsPage from './components/SettingsPage.vue'
import { messages } from './i18n'
import styles from './styles.css?inline'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import devMockSeed from './devMock'

// dev-shell 领域种子数据（SDK PluginDevMock 协议；真实宿主忽略）
export const devMock = devMockSeed

const STYLE_ID = 'news-plugin-style'

/** 激活期捕获的统一日志入口（deactivate 无 context 入参） */
let activeLogger: PluginContext['logger'] | null = null

export async function activate(context: PluginContext): Promise<void> {
  // 1. 注册 i18n 消息（必须在组件 setup 前完成，模板取文案才可用）
  for (const [locale, msgs] of Object.entries(messages)) {
    context.i18n.registerMessages(locale, msgs)
  }

  // 2. 注入插件样式（幂等，热重载不重复插入）
  if (!document.getElementById(STYLE_ID)) {
    const styleEl = document.createElement('style')
    styleEl.id = STYLE_ID
    styleEl.textContent = styles
    document.head.appendChild(styleEl)
  }

  // 3. 宿主壳运行面：独立页面（appId 由宿主代填）
  context.ui.registerSurface({ component: NewsView, accent: '#F59E0B' })

  // 4. 设置二级页：宿主页头（返回 + 标题 + 安全区），应用不自绘页头
  context.ui.registerRoute({
    id: 'settings',
    title: context.i18n.t('news.settings.title'),
    component: SettingsPage,
    header: true,
  })

  activeLogger = context.logger
  activeLogger.info('[News] plugin activated (mobile, skeleton)')
}

export async function deactivate(): Promise<void> {
  // 样式保留（幂等）；组件级监听已在卸载时清理；
  // 注册表 / 事件由宿主 loader 依据 context._disposables 统一摘除
  activeLogger?.info('[News] plugin deactivated')
  activeLogger = null
}