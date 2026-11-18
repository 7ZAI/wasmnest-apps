/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端独立挂载包，Tailwind 自编译（宿主不再扫描 wasm-apps 树）。
  // 设计 token（var(--bg-page) 等）由宿主文档根提供；SDK 组件类从 node_modules 扫描。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    // 纯文本处理模块含正则字符类（如 [-:|\\s]），Tailwind 扫描会把它误当任意值类并产出非法 CSS
    '!./src/preview/excerpt.ts',
    './node_modules/@binblink/wasmnest-plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
