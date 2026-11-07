import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * file-transfer（移动端）独立测试。
 *
 * 纯函数 / composable 层用例（宿主命令错误文案、设置映射等），不需要真宿主；
 * 真 wasm + 真权限门的端到端验证走 `node scripts/e2e-mobile.mjs --app file-transfer`。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    // node 环境足够：本 app 的用例是纯函数/映射层，不渲染组件。
    // 需要 DOM 的用例（组件交互）再加 happy-dom 依赖并改这里。
    environment: 'node',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
