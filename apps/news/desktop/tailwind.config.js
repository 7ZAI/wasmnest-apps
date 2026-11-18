/** @type {import('tailwindcss').Config} */
export default {
  // 桌面挂载包自带依赖，Tailwind 类名自编译（宿主不扫描本仓）。
  // node_modules 那条必须保留：app 吃发布物时 SDK 源码在 node_modules 里。
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