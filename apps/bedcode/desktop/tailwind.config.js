/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端是独立挂载包，Tailwind 由本工程自编译（宿主不再扫描
  // wasm-apps 树）。content = 本 app src + 共享 SDK 组件（Select 等用同源工具类）。
  // 设计 token（var(--bg-page) 等）由宿主文档根提供（app 只在宿主窗口内运行）。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}
