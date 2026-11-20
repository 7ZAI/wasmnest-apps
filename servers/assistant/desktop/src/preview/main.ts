/**
 * 助手界面预览入口
 *
 * 复用真实 `mountApp`，注入预览用挂载环境。URL 参数：
 * `?state=chat|locked|panel|floatball|apps-unavailable&theme=light|dark&locale=zh-CN|en`
 */
import { mountApp, type AppMountEnv } from '../entry'
import { createMockInvoke } from './mock'
import '@wasmnest/desktop-styles/style.css'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'chat'
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN'

if (theme === 'dark') document.documentElement.classList.add('dark')

const storagePrefix = 'wasmnest-preview:assistant:'
const storage = {
  get: <T>(key: string): T | undefined => {
    try {
      const raw = localStorage.getItem(`${storagePrefix}${key}`)
      return raw === null ? undefined : (JSON.parse(raw) as T)
    } catch {
      return undefined
    }
  },
  set: (key: string, value: unknown): void => {
    try {
      localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value))
    } catch {
      // 存储不可用时保持内存态即可
    }
  },
  delete: (key: string): void => {
    try {
      localStorage.removeItem(`${storagePrefix}${key}`)
    } catch {
      // 同上
    }
  },
}

const appInvoke = createMockInvoke({ state })

if (state === 'panel' || state === 'floatball') {
  storage.set('nest.prefs', {
    viewMode: 'panel',
    panelOpen: state === 'panel',
    motionEnabled: true,
  })
} else if (state === 'chat') {
  storage.delete('nest.prefs')
}

const env: AppMountEnv = {
  appId: 'com.wasmnest.assistant',
  mountContract: '1',
  invoke: async <T = unknown>(command: string): Promise<T> => {
    if (command === 'get_app_settings') {
      return { ui: { terminal_font_size: 14, terminal_letter_spacing: 0 } } as T
    }
    throw new Error(`[preview] 宿主命令在浏览器不可用："${command}"`)
  },
  appInvoke: (command, ...args) => appInvoke(command, args[0]) as Promise<never>,
  appStorageGet: async <T = unknown>(key: string): Promise<T | undefined> => storage.get<T>(key),
  appStorageSet: async (key, value) => storage.set(key, value),
  appStorageDelete: async (key) => storage.delete(key),
  locale,
  theme,
  platform: 'desktop',
  initialRoute: '/',
  apps: state === 'apps-unavailable' ? null : undefined,
}

const root = document.getElementById('app')
if (!root) throw new Error('预览页缺少挂载根节点')

void mountApp(root, env).catch((error) => {
  root.textContent = `预览挂载失败：${error instanceof Error ? error.message : String(error)}`
})