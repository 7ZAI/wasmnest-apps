import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

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
 */
export default defineConfig({
  plugins: [vue(), cssInjectedByJsPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
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
