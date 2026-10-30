/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端是独立挂载包，Tailwind 由本工程自编译（宿主不再扫描
  // wasm-apps 树）。content = 本 app src + 共享 SDK 组件（Select 等用同源工具类）。
  // 设计 token（var(--bg-page) 等）由宿主文档根提供（app 只在宿主窗口内运行）。
  //
  // **SDK 路径必须同时写 node_modules 那条**：app 默认吃发布物
  // （`@binblink/wasmnest-plugin-sdk-desktop`），源码在 node_modules 里；只写
  // `../../packages/...`（平台仓 monorepo 布局）在本仓是空路径，SDK 组件独有的
  // 类不会被生成——实测漏掉的是 Select 面板的 `z-[60]`，面板被弹窗的 `z-50`
  // 压在下面（下拉看不见，但 DOM 与状态都正常）。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/@binblink/wasmnest-plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}
