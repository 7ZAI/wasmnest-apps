/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端独立挂载包，Tailwind 自编译（宿主不再扫描 wasm-apps 树）
  //
  // SDK 路径必须同时写 node_modules 那条：app 默认吃发布物，SDK 源码在 node_modules 里；
  // `../../packages/...` 是平台仓 monorepo 布局，在本仓是空路径（只在 link:platform
  // 时才有意义）。漏掉 node_modules 那条会让 SDK 组件独有的类不被生成
  // （bedcode 踩过：Select 面板的 z-[60] 缺失，面板被压在弹窗下面）。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/@binblink/wasmnest-plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
