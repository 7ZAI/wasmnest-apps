import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * File Transfer app 前端构建（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`（inline
 * CSS），复制到 `src-tauri/resources/plugins/desktop/<pluginId>/index.js` 由宿主
 * 运行时装载。**无外部化**（不写 `window.__WASMNEST_SHARED__`），独立包自足。
 *
 * i18n：消息在构建期预编译成 `(ctx) => string`（`i18nPrecompile`），配合
 * `vue-i18n` 运行时构建，产物不含消息编译器 → 不需要 CSP `'unsafe-eval'`
 * （安全审查 #50）。新增语言文件必须加进下面 include 清单。
 */
export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({ include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'] }),
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: [{ find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' }],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // 消息已在构建期预编译 → 关掉 JIT 编译并丢弃消息编译器（产物里不再有 eval）
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
