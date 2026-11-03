import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * bedcode app 前端构建（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * - 入口 = `src/entry.ts`（`mountApp(root, env)` 挂载契约，宿主 useAppMount
 *   装载）；产物 = 单文件 `dist/index.js`（inline CSS），复制到
 *   `src-tauri/resources/plugins/desktop/<pluginId>/index.js` 由宿主运行时装载。
 * - **无外部化**：本包自带 vue / vue-router / pinia / vue-i18n / vue-sonner /
 *   xterm / loglevel 等全部依赖（不写 `window.__WASMNEST_SHARED__`）——独立包
 *   自足，跨仓（三仓拆分）可独立构建。
 * - 单产物契约（inlineDynamicImports）：与旧插件包同款，避免动态 import 分包
 *   导致入口缺失。
 * - i18n：消息（含 `mechanism.ts` 机制副本）构建期预编译成 `(ctx) => string`，
 *   配合 `vue-i18n` 运行时构建（丢弃消息编译器），产物不含 eval → 不需要 CSP
 *   `'unsafe-eval'`（安全审查 #50）。新增语言文件必须加进 include 清单。
 */
export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({
      include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts', 'src/i18n/mechanism.ts'],
    }),
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: [{ find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' }],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __INTLIFY_JIT_COMPILATION__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: true,
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'terser',
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
