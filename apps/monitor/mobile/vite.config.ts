import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'

/**
 * Monitor（移动端）构建：SDK `wasmnestPlugin()`（vue / vue-i18n / pinia 外置为
 * 宿主全局）；产物入口 `src/index.ts`，宿主 loader 调 activate 注册运行面。
 *
 * SDK 的 vite 插件已在库模式下把全部 CSS（含本 app 的 SFC scoped 样式）内联进
 * 入口 chunk —— 宿主只 import index.js，不会加载 dist/style.css。
 */
export default defineConfig({
  plugins: [vue(), wasmnestPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'terser',
  },
})
