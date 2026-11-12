import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * ai-chatbox（移动端）独立测试（三仓拆分 §5-E7 收口：app 测试随源码住应用仓）。
 *
 * 原由移动宿主 vitest 统一驱动（app 源码在宿主仓内时），拆分后自足运行：
 * `@` 别名指向本 app src；Tauri core 替身在 setup.ts（Channel 构造依赖真实 WebView）。
 */
// 平台仓根（R1 兄弟布局；WASMNEST_PLATFORM_ROOT 可覆盖）：app 测试里少数用例要读
// 宿主运行时面（移动端 i18n 目录 `wasmnest-mobile/src/locales`），经 `@host` 别名指向。
const PLATFORM_ROOT =
  process.env.WASMNEST_PLATFORM_ROOT ?? resolve(__dirname, '../../../../wasmnest')

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@host': resolve(PLATFORM_ROOT, 'wasmnest-mobile/src'),
    },
  },
})
