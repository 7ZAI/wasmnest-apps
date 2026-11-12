import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/** Nest 助手（移动端）独立测试：`@` 别名指向本 app src */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // 共享 TS 核（与 vite.config.ts 同口径，经别名引入本端 root 之外的 shared/）
      '@nest-shared': resolve(__dirname, '../shared'),
    },
  },
})
