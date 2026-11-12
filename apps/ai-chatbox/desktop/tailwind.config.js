/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端独立挂载包，Tailwind 自编译（宿主不再扫描 wasm-apps 树）
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
