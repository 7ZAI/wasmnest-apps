import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * Monitor app 前端构建（桌面挂载包形态）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`（inline
 * CSS），复制到宿主 resources 由宿主运行时装载。**无外部化**（不写
 * `window.__WASMNEST_SHARED__`），独立包自足。
 *
 * i18n：消息构建期预编译 + `vue-i18n` 运行时构建（丢弃消息编译器），产物不含
 * eval → 不需要 CSP `'unsafe-eval'`（安全审查 #50）。新增语言文件必须加进清单。
 */
export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({ include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'] }),
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: [
      // 共享 TS 核（spec §5.1 D3）住应用级 `shared/`，在本端 vite root 之外；
      // 经别名解析为绝对路径引入（不引平台仓、不新增 workspace）。
      { find: /^@nest-shared\/(.*)$/, replacement: resolve(__dirname, '../shared/$1') },
      // pi 共享核（shared/ 在本端 vite root 之外，其裸导入无法沿目录树解析到
      // 本端 node_modules）：显式别名钉到本端安装位置，构建 / 测试同口径。
      // 只覆盖共享核直接导入的两个包；pi-schema / pi-telemetry 等传递依赖
      // 由 pi-ai 在 .pnpm 内自行解析，不能被别名劫持（否则指向不存在的顶层路径）。
      { find: /^@earendil-works\/pi-ai\/utils\/(.+)$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai/dist/utils/$1') },
      { find: /^@earendil-works\/pi-ai$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-ai') },
      { find: /^@earendil-works\/pi-agent-core$/, replacement: resolve(__dirname, 'node_modules/@earendil-works/pi-agent-core') },
      { find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
    ],
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
