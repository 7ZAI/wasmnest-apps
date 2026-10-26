import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * bedcode app 独立测试（桌面 UI 宿主修正 2026-10-17）
 *
 * app 前端是独立构建的挂载包 → 测试自足运行（`@` 别名指向本 app src；依赖经
 * pnpm workspace hoisting 解析）。宿主壳测试在 wasmnest-desktop/src/__tests__
 * 由宿主 vitest 运行，两边测试树互不交叉（防回接锁钉住）。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
