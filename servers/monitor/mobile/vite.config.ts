import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * Monitor（移动端）构建：SDK `wasmnestPlugin()`（vue / vue-i18n / pinia 外置为
 * 宿主全局）；产物入口 `src/index.ts`，宿主 loader 调 activate 注册运行面。
 *
 * SDK 的 vite 插件已在库模式下把全部 CSS（含本 app 的 SFC scoped 样式）内联进
 * 入口 chunk —— 宿主只 import index.js，不会加载 dist/style.css。
 *
 * i18n：消息构建期预编译成 `(ctx) => string`，注册进宿主实例后不再触发宿主的
 * 消息编译器（安全审查 #50：CSP 撤 'unsafe-eval'）。新增语言文件必须加进清单。
 */
export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({ include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'] }),
    wasmnestPlugin(),
  ],
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
