import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * Nest 助手（移动端）构建：SDK `wasmnestPlugin()`（vue / vue-i18n / pinia 外置为
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
  resolve: {
    alias: [
      // 共享 TS 核（spec §5.1 D3）住应用级 `shared/`，在本端 vite root 之外；
      // 经别名解析为绝对路径引入（与桌面端同口径）。
      { find: /^@nest-shared\/(.*)$/, replacement: resolve(__dirname, '../shared/$1') },
      // pi 共享核（shared/ 在本端 vite root 之外，其裸导入无法沿目录树解析到
      // 本端 node_modules）：显式别名钉到本端安装位置，与桌面端同口径。
      // 只覆盖共享核直接导入的两个包；pi-schema / pi-telemetry 等传递依赖
      // 由 pi-ai 在 .pnpm 内自行解析，不能被别名劫持。
      { find: /^@earendil-works\/pi-ai\/utils\/(.+)$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai/dist/utils/$1') },
      { find: /^@earendil-works\/pi-ai$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai') },
      { find: /^@earendil-works\/pi-agent-core$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-agent-core') },
    ],
  },
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
