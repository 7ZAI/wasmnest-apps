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
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      // 共享 TS 核（与 vite.config.ts 同口径，经别名引入本端 root 之外的 shared/）
      { find: /^@nest-shared\/(.*)$/, replacement: resolve(__dirname, '../shared/$1') },
      // pi 共享核裸导入（shared/ 无法沿目录树解析到本端 node_modules）；
      // 只覆盖共享核直接导入的两个包，传递依赖（pi-schema 等）不劫持。
      { find: /^@earendil-works\/pi-ai\/utils\/(.+)$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai/dist/utils/$1') },
      { find: /^@earendil-works\/pi-ai$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai') },
      { find: /^@earendil-works\/pi-agent-core$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-agent-core') },
    ],
  },
})
